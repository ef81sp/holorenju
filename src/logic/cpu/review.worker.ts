/**
 * 振り返り評価用 Web Worker
 *
 * 1手を受け取り、その局面でhard準拠の探索を実行して評価結果を返す
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import ReviewWorker from './review.worker?worker'
 */

import type { ScoreBreakdown } from "@/types/cpu";
import type { Position } from "@/types/game";
import type {
  ForcedLossType,
  ForcedWinBranch,
  ForcedWinType,
  FullEvalResult,
  LightEvalResult,
  ReviewCandidate,
  ReviewEvalRequest,
  VCTCheckResult,
} from "@/types/review";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import type { MoveScoreEntry } from "./search/results";

import { countStones } from "./core/boardUtils";
import {
  detectOpponentThreats,
  evaluatePositionWithBreakdown,
  evaluateBoardWithBreakdown,
  PATTERN_SCORES,
} from "./evaluation";
import { findMiseTargets } from "./evaluation/miseTactics";
import { verifyCandidates, findSafeBest } from "./review/candidateVerification";
import { buildDoubleMiseBranches } from "./review/doubleMiseBranches";
import { evaluatePlayedForcedWin } from "./review/evaluatePlayedMove";
import {
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./review/forcedLossCheck";
import { detectForcedWin } from "./review/forcedWinDetection";
import { verifyCandidatePVs } from "./review/pvVerification";
import {
  REVIEW_PROFILE_FAST,
  REVIEW_PROFILE_PRECISE,
  REVIEW_REDUCED_NODES,
  REVIEW_SEARCH_PARAMS,
  REVIEW_VCT_OPTIONS_WITH_BRANCHES,
} from "./review/reviewConstants";
import { findBestMoveIterativeWithTT } from "./search/minimax";
import { findVCFSequence, type VCFSequenceResult } from "./search/vcf";
import {
  findVCTSequence,
  VCT_STONE_THRESHOLD,
  type VCTBranch,
} from "./search/vct";
import { globalTT } from "./transpositionTable";

/** VCF初手を候補リストの先頭に追加/更新する */
function promoteVcfCandidate(
  board: import("@/types/game").BoardState,
  candidates: ReviewCandidate[],
  reVcf: VCFSequenceResult,
  color: "black" | "white",
): void {
  const vcfIdx = candidates.findIndex(
    (c) =>
      c.position.row === reVcf.firstMove.row &&
      c.position.col === reVcf.firstMove.col,
  );
  if (vcfIdx >= 0) {
    const [entry] = candidates.splice(vcfIdx, 1);
    if (entry) {
      entry.searchScore = PATTERN_SCORES.FIVE;
      entry.principalVariation = reVcf.sequence;
      candidates.unshift(entry);
      return;
    }
  }
  const { score, breakdown } = evaluatePositionWithBreakdown(
    board,
    reVcf.firstMove.row,
    reVcf.firstMove.col,
    color,
    REVIEW_SEARCH_PARAMS.evaluationOptions,
  );
  candidates.unshift({
    position: reVcf.firstMove,
    score: Math.round(score),
    searchScore: PATTERN_SCORES.FIVE,
    breakdown: breakdown as ScoreBreakdown,
    principalVariation: reVcf.sequence,
  });
}

interface DemotionContext {
  board: import("@/types/game").BoardState;
  candidates: ReviewCandidate[];
  color: "black" | "white";
  forcedWinType: ForcedWinType | undefined;
  bestMove: Position;
  bestScore: number;
  fwBestLoss?: import("@/types/review").ForcedLossResult;
}

/** 降格時のVCF再探索とフォールバック処理 */
function handleDemotion(ctx: DemotionContext): {
  forcedWinType: ForcedWinType | undefined;
  finalBestMove: Position;
  finalBestScore: number;
  forcedWinBranches: ForcedWinBranch[] | undefined;
  fwForcedLossType?: ForcedLossType;
  fwForcedLossSequence?: Position[];
  clearDoubleMise: boolean;
} {
  const safeBest = findSafeBest(ctx.candidates);
  if (!safeBest) {
    return {
      forcedWinType: ctx.forcedWinType,
      finalBestMove: ctx.bestMove,
      finalBestScore: ctx.bestScore,
      forcedWinBranches: undefined,
      fwForcedLossType: ctx.fwBestLoss?.type,
      fwForcedLossSequence: ctx.fwBestLoss?.sequence,
      clearDoubleMise: false,
    };
  }

  // 両ミセ降格時: maxDepth制限されていたVCFのフル再探索
  const reVcf =
    ctx.forcedWinType === "double-mise"
      ? findVCFSequence(ctx.board, ctx.color, REVIEW_VCF_OPTIONS)
      : null;

  if (reVcf) {
    promoteVcfCandidate(ctx.board, ctx.candidates, reVcf, ctx.color);
    return {
      forcedWinType: "vcf",
      finalBestMove: reVcf.firstMove,
      finalBestScore: PATTERN_SCORES.FIVE,
      forcedWinBranches: undefined,
      clearDoubleMise: true,
    };
  }

  return {
    forcedWinType: undefined,
    finalBestMove: safeBest.position,
    finalBestScore: safeBest.searchScore,
    forcedWinBranches: undefined,
    clearDoubleMise: true,
  };
}

self.onmessage = (event: MessageEvent<ReviewEvalRequest>) => {
  const {
    moveHistory,
    moveIndex,
    playerFirst: _playerFirst,
    isLightEval,
    vctCheckOnly,
    skipStoneThreshold,
    candidatePosition,
    preciseAnalysis,
  } = event.data;

  const profile = preciseAnalysis
    ? REVIEW_PROFILE_PRECISE
    : REVIEW_PROFILE_FAST;

  // 高速モード時は TT をクリア（main 相当の決定論性）
  if (profile.clearTT) {
    globalTT.clear();
  }

  try {
    const moves = moveHistory.trim().split(/\s+/);

    // Phase 2/3: VCTチェックのみ実行
    if (vctCheckOnly) {
      // candidatePosition 指定時: 実際の着手の代わりに候補手を置いた盤面を構築
      const boardRecord = candidatePosition
        ? moves.slice(0, moveIndex).join(" ")
        : moves.slice(0, moveIndex + 1).join(" ");
      const { board: boardAfter } = createBoardFromRecord(boardRecord);
      const color = moveIndex % 2 === 0 ? "black" : "white";
      if (candidatePosition) {
        const row = boardAfter[candidatePosition.row];
        if (row) {
          row[candidatePosition.col] = color;
        }
      }
      const opponentColor = color === "black" ? "white" : "black";
      const stoneCountAfter = countStones(boardAfter);

      // 自分に四があれば相手はVCT不可
      const selfThreats = detectOpponentThreats(boardAfter, color);
      const selfHasFour =
        selfThreats.fours.length > 0 || selfThreats.openFours.length > 0;

      let forcedLossType: ForcedLossType | undefined = undefined;
      let forcedLossSequence: Position[] | undefined = undefined;
      if (
        !selfHasFour &&
        (skipStoneThreshold || stoneCountAfter >= VCT_STONE_THRESHOLD)
      ) {
        const oppVCT = findVCTSequence(
          boardAfter,
          opponentColor,
          FORCED_LOSS_VCT_OPTIONS,
        );
        if (oppVCT) {
          forcedLossType = oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct";
          forcedLossSequence = oppVCT.sequence;
        }
      }

      const response: VCTCheckResult = {
        mode: "vctCheck",
        moveIndex,
        forcedLossType,
        forcedLossSequence,
      };
      self.postMessage(response);
      return;
    }

    // moveIndex時点の盤面を再構築（moveIndex手目の前の局面）
    const { board, nextColor } = createBoardFromRecord(
      moves.slice(0, moveIndex).join(" "),
    );

    const color = nextColor as "black" | "white";

    // 相手の脅威チェック（VCF/VCT探索より先に実行）
    const opponentColor = color === "black" ? "white" : "black";
    const opponentThreats = detectOpponentThreats(board, opponentColor);
    const opponentHasFour =
      opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

    // 強制勝ち検出（VCF/VCT/両ミセ/Mise-VCF）
    let { forcedWin, forcedWinType, doubleMiseMoves, doubleMiseBestMove } =
      detectForcedWin(board, color, opponentHasFour, Boolean(isLightEval));

    // 軽量評価モード（コンピュータ手用）: 強制勝ち検出のみ
    if (isLightEval) {
      const response: LightEvalResult = {
        mode: "lightEval",
        moveIndex,
        bestMove: forcedWin?.firstMove ??
          doubleMiseBestMove ?? { row: 7, col: 7 },
        forcedWinType,
      };
      self.postMessage(response);
      return;
    }

    // 相手の必勝手順検出（プレイヤー手用）
    // プレイヤーの手を打った後の局面で相手のVCF/VCT等を探す
    let forcedLossType: ForcedLossType | undefined = undefined;
    let forcedLossSequence: Position[] | undefined = undefined;
    let needsVCTCheck = false;
    if (moves[moveIndex]) {
      const { board: boardAfter } = createBoardFromRecord(
        moves.slice(0, moveIndex + 1).join(" "),
      );
      const stoneCountAfter = countStones(boardAfter);

      // 着手後の局面で、自分の四があるか（相手はVCF/VCTどころではない）
      const selfThreatsAfter = detectOpponentThreats(boardAfter, color);
      const selfHasFourAfter =
        selfThreatsAfter.fours.length > 0 ||
        selfThreatsAfter.openFours.length > 0;

      if (!selfHasFourAfter) {
        const loss = checkForcedLoss(
          boardAfter,
          opponentColor,
          stoneCountAfter,
          {
            vcfOptions: REVIEW_VCF_OPTIONS,
            miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
            vctOptions: FORCED_LOSS_VCT_OPTIONS,
            skipVCT: true,
          },
        );
        if (loss) {
          forcedLossType = loss.type;
          forcedLossSequence = loss.sequence;
        } else {
          // Phase 2 で VCT を深くチェック（石数閾値なし）
          // 振り返りでは正確性優先、Phase 2 は単一ワーカー逐次実行
          needsVCTCheck = true;
        }
      }
    }

    // 通常探索（候補手比較データ用）
    // 確定局面（被追詰/必勝）ではノード数を削減（候補表示のみに使用、精密モードのみ）
    const hasForcedWin = Boolean(forcedWin || doubleMiseBestMove);
    const effectiveMaxNodes =
      profile.enablePVVerification && (forcedLossType || hasForcedWin)
        ? REVIEW_REDUCED_NODES
        : profile.maxNodes;

    const result = findBestMoveIterativeWithTT({
      board,
      color,
      maxDepth: REVIEW_SEARCH_PARAMS.depth,
      randomFactor: 0, // 決定論的
      evaluationOptions: REVIEW_SEARCH_PARAMS.evaluationOptions,
      maxNodes: effectiveMaxNodes,
      timeLimit: profile.timeLimit,
      absoluteTimeLimit: profile.absoluteTimeLimit,
      aspirationWidths: profile.aspirationWidths,
      collectPV: true,
    });

    // minimax が FIVE を返したが VCF/VCT 未検出
    // 石数 < VCT_STONE_THRESHOLD(14) の序盤ではVCT探索がスキップされるため、
    // ここで閾値を無視してVCT探索を実行し、必勝手順を取得する
    if (
      !forcedWin &&
      !doubleMiseBestMove &&
      result.score >= PATTERN_SCORES.FIVE - 1 &&
      !opponentHasFour
    ) {
      const vctRetry = findVCTSequence(
        board,
        color,
        REVIEW_VCT_OPTIONS_WITH_BRANCHES,
      );
      if (vctRetry) {
        forcedWin = vctRetry;
        forcedWinType = vctRetry.isForbiddenTrap ? "forbidden-trap" : "vct";
      }
      // VCT でも未検出なら forcedWin は設定しない（「必勝」ラベル非表示）
    }

    // 候補手エントリから内訳付きデータを構築するヘルパー
    const buildCandidate = (entry: MoveScoreEntry): ReviewCandidate => {
      const { score: breakdownScore, breakdown } =
        evaluatePositionWithBreakdown(
          board,
          entry.move.row,
          entry.move.col,
          color,
          REVIEW_SEARCH_PARAMS.evaluationOptions,
        );

      const leafEvaluation =
        entry.pvLeafBoard && entry.pvLeafColor
          ? evaluateBoardWithBreakdown(entry.pvLeafBoard, color)
          : undefined;

      return {
        position: entry.move,
        score: Math.round(breakdownScore),
        searchScore: entry.score,
        breakdown: breakdown as ScoreBreakdown,
        principalVariation: entry.pv,
        leafEvaluation,
      };
    };

    // 実際の手の座標を解析
    const playedMoveStr = moves[moveIndex];
    let playedRow = -1;
    let playedCol = -1;

    if (playedMoveStr) {
      playedCol = playedMoveStr.charCodeAt(0) - "A".charCodeAt(0);
      const playedRowNum = parseInt(playedMoveStr.slice(1), 10);
      playedRow = 15 - playedRowNum;
    }

    // 両ミセ見逃し検出（forcedWinType が double-mise の場合のみ）
    // 1手四三など上位の勝ち筋がある場合は両ミセ見逃しを表示しない
    let missedDoubleMise: Position[] | undefined = undefined;
    if (
      forcedWinType === "double-mise" &&
      doubleMiseMoves.length > 0 &&
      playedRow >= 0
    ) {
      const playedIsDoubleMise = doubleMiseMoves.some(
        (m) => m.row === playedRow && m.col === playedCol,
      );
      if (!playedIsDoubleMise) {
        missedDoubleMise = doubleMiseMoves;
      }
    }

    // VCT/VCF検出時のスコア・候補手オーバーライド
    if (forcedWin) {
      const bestScore = PATTERN_SCORES.FIVE;
      const bestMove = forcedWin.firstMove;

      // 実際の手のスコア判定
      const { playedScore, playedForcedWinSequence } = evaluatePlayedForcedWin(
        board,
        color,
        playedRow,
        playedCol,
        bestMove,
        bestScore,
        result,
        countStones(board) < VCT_STONE_THRESHOLD,
        doubleMiseMoves,
      );

      // 両ミセターゲット算出（四三を作る位置）
      // PV構築とレスポンスの両方で使うため、候補手構築前に算出
      let doubleMiseTargets: Position[] | undefined = undefined;
      if (doubleMiseBestMove) {
        const dmRow = board[doubleMiseBestMove.row];
        if (dmRow) {
          dmRow[doubleMiseBestMove.col] = color;
          doubleMiseTargets = findMiseTargets(
            board,
            doubleMiseBestMove.row,
            doubleMiseBestMove.col,
            color,
          );
          dmRow[doubleMiseBestMove.col] = null;
        }
      }

      // 候補手リスト構築
      const candidates: ReviewCandidate[] = [];

      // 追い詰め開始手をFIVEスコアで追加
      const { score: fwBreakdownScore, breakdown: fwBreakdown } =
        evaluatePositionWithBreakdown(
          board,
          bestMove.row,
          bestMove.col,
          color,
          REVIEW_SEARCH_PARAMS.evaluationOptions,
        );
      // 両ミセ: targets から読み筋を構築（sequence が1手しかないため）
      // [両ミセ手, 相手がtarget[0]を防御, 自分がtarget[1]で四三完成]
      let bestPV: Position[] = forcedWin.sequence;
      if (
        forcedWinType === "double-mise" &&
        doubleMiseTargets &&
        doubleMiseTargets.length >= 2 &&
        doubleMiseTargets[0] &&
        doubleMiseTargets[1]
      ) {
        bestPV = [bestMove, doubleMiseTargets[0], doubleMiseTargets[1]];
      }

      candidates.push({
        position: bestMove,
        score: Math.round(fwBreakdownScore),
        searchScore: PATTERN_SCORES.FIVE,
        breakdown: fwBreakdown as ScoreBreakdown,
        principalVariation: bestPV,
      });

      // minimaxの候補手をマージ
      // forcedWin.firstMoveがFIVEスコアの最善手として確定済みのため、
      // 他候補のVCTチェックはランキングに影響しないため省略
      const minimaxCandidates = (result.candidates ?? [])
        .slice(0, 5)
        .filter(
          (e) => !(e.move.row === bestMove.row && e.move.col === bestMove.col),
        )
        .map(buildCandidate);
      candidates.push(...minimaxCandidates);

      // 実際の手の追い詰めシーケンスを候補に反映
      if (playedForcedWinSequence && playedRow >= 0) {
        const existingIdx = candidates.findIndex(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        );
        if (existingIdx >= 0 && candidates[existingIdx]) {
          // minimax 候補の PV を追い詰めシーケンスで上書き
          candidates[existingIdx] = {
            ...candidates[existingIdx],
            principalVariation: playedForcedWinSequence,
            searchScore: PATTERN_SCORES.FIVE,
          };
        } else {
          // 候補に存在しない → 追い詰め候補として追加
          const { score: pScore, breakdown: pBreakdown } =
            evaluatePositionWithBreakdown(
              board,
              playedRow,
              playedCol,
              color,
              REVIEW_SEARCH_PARAMS.evaluationOptions,
            );
          candidates.push({
            position: { row: playedRow, col: playedCol },
            score: Math.round(pScore),
            searchScore: PATTERN_SCORES.FIVE,
            breakdown: pBreakdown as ScoreBreakdown,
            principalVariation: playedForcedWinSequence,
          });
        }
      } else if (
        playedRow >= 0 &&
        !candidates.some(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        )
      ) {
        // 既存のminimax候補フォールバック
        const playedEntry = result.candidates?.find(
          (c) => c.move.row === playedRow && c.move.col === playedCol,
        );
        if (playedEntry) {
          candidates.push(buildCandidate(playedEntry));
        }
      }

      // 分岐情報の構築
      let forcedWinBranches: ForcedWinBranch[] | undefined = undefined;

      if (
        forcedWinType === "double-mise" &&
        doubleMiseTargets &&
        doubleMiseTargets.length >= 2
      ) {
        forcedWinBranches = buildDoubleMiseBranches(
          board,
          bestMove,
          color,
          opponentColor,
          doubleMiseTargets,
        );
      } else {
        // VCT分岐情報の変換（VCTSequenceResultのみbranches有）
        const rawBranches =
          "branches" in forcedWin
            ? (forcedWin.branches as VCTBranch[] | undefined)
            : undefined;
        forcedWinBranches = rawBranches?.map((b) => ({
          defenseIndex: b.defenseIndex,
          defenseMove: b.defenseMove,
          continuation: b.continuation,
        }));
      }

      // forcedWin初手の事後検証: 相手に強制勝ちを許さないか確認
      // VCF系は初手が四なので checkCandidateForcedLoss 内で即スキップ（コスト≒0）
      const stoneCountFW = countStones(board);
      const fwBudget =
        profile.verifyCandidatesBudget === "dynamic"
          ? Math.max(1000, Math.min(5000, 25_000))
          : profile.verifyCandidatesBudget;
      const { demotedBest: fwDemoted, bestLoss: fwBestLoss } = verifyCandidates(
        board,
        candidates,
        color,
        opponentColor,
        stoneCountFW,
        fwBudget,
      );

      // PV事後検証: 安全な候補のPV内の後続手に追詰がないかチェック
      if (profile.enablePVVerification) {
        verifyCandidatePVs(
          board,
          candidates,
          color,
          opponentColor,
          stoneCountFW,
          Infinity,
        );
      }

      // 打たれた手の候補エントリにforcedLossTypeを反映
      // forcedWinパスでも、実際の手が被必勝を許す場合にフラグを付ける
      if (forcedLossType && playedRow >= 0) {
        const playedCand = candidates.find(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        );
        if (playedCand && !playedCand.opponentForcedWin) {
          playedCand.opponentForcedWin = forcedLossType;
        }
      }

      let finalBestMove = bestMove;
      let finalBestScore: number = bestScore;
      let fwForcedLossType: ForcedLossType | undefined =
        forcedLossType ?? undefined;
      let fwForcedLossSequence: Position[] | undefined =
        forcedLossSequence ?? undefined;
      // verifyCandidates または PV検証で最善手が降格された場合
      if (fwDemoted || candidates[0]?.opponentForcedWin) {
        const dm = handleDemotion({
          board,
          candidates,
          color,
          forcedWinType,
          bestMove,
          bestScore,
          fwBestLoss: fwBestLoss ?? undefined,
        });
        ({ forcedWinType } = dm);
        ({ finalBestMove } = dm);
        ({ finalBestScore } = dm);
        ({ forcedWinBranches } = dm);
        if (dm.fwForcedLossType) {
          ({ fwForcedLossType } = dm);
          ({ fwForcedLossSequence } = dm);
        }
        if (dm.clearDoubleMise) {
          missedDoubleMise = undefined;
          doubleMiseTargets = undefined;
        }
      }

      const response: FullEvalResult = {
        mode: "fullEval",
        moveIndex,
        bestMove: finalBestMove,
        bestScore: finalBestScore,
        playedScore,
        candidates,
        completedDepth: result.completedDepth,
        forcedWinType,
        forcedWinBranches,
        forcedLossType: fwForcedLossType,
        forcedLossSequence: fwForcedLossSequence,
        missedDoubleMise,
        doubleMiseTargets,
        needsVCTCheck: needsVCTCheck || undefined,
      };

      self.postMessage(response);
    } else {
      // 通常の評価フロー（VCT/VCFなし）
      let playedScore = result.score;

      if (playedRow >= 0 && result.candidates) {
        const played = result.candidates.find(
          (c) => c.move.row === playedRow && c.move.col === playedCol,
        );
        if (played) {
          playedScore = played.score;
        } else {
          playedScore = result.score - 2000;
        }
      }

      const candidates = (result.candidates ?? [])
        .slice(0, 5)
        .map(buildCandidate);

      if (
        playedRow >= 0 &&
        !candidates.some(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        )
      ) {
        const allCandidates = result.candidates ?? [];
        const playedEntry = allCandidates.find(
          (c) => c.move.row === playedRow && c.move.col === playedCol,
        );
        if (playedEntry) {
          candidates.push(buildCandidate(playedEntry));
        }
      }

      // 候補手の事後検証: 相手に強制勝ちを許す手を検出
      const stoneCount = countStones(board);
      const normalBudget =
        profile.verifyCandidatesBudget === "dynamic"
          ? Math.max(1000, Math.min(5000, 25_000 - (result.elapsedTime ?? 0)))
          : profile.verifyCandidatesBudget;
      const { demotedBest, bestLoss } = verifyCandidates(
        board,
        candidates,
        color,
        opponentColor,
        stoneCount,
        normalBudget,
      );

      // PV事後検証: 安全な候補のPV内の後続手に追詰がないかチェック
      if (profile.enablePVVerification) {
        verifyCandidatePVs(
          board,
          candidates,
          color,
          opponentColor,
          stoneCount,
          Infinity,
        );
      }

      // 打たれた手の候補エントリにforcedLossTypeを反映
      if (forcedLossType && playedRow >= 0) {
        const playedCand = candidates.find(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        );
        if (playedCand && !playedCand.opponentForcedWin) {
          playedCand.opponentForcedWin = forcedLossType;
        }
      }

      let finalBestMove = result.position;
      let finalBestScore = result.score;
      let finalForcedLossType = forcedLossType;
      let finalForcedLossSequence = forcedLossSequence;
      // verifyCandidates または PV検証で最善手が降格された場合
      const bestDemoted =
        demotedBest || Boolean(candidates[0]?.opponentForcedWin);
      if (bestDemoted) {
        const safeBest = findSafeBest(candidates);
        if (safeBest) {
          finalBestMove = safeBest.position;
          finalBestScore = safeBest.searchScore;
        } else if (bestLoss && !finalForcedLossType) {
          // 全候補が被必勝 → 局面自体が被必勝
          finalForcedLossType = bestLoss.type;
          finalForcedLossSequence = bestLoss.sequence;
        }
      }

      const response: FullEvalResult = {
        mode: "fullEval",
        moveIndex,
        bestMove: finalBestMove,
        bestScore: finalBestScore,
        playedScore,
        candidates,
        completedDepth: result.completedDepth,
        forcedLossType: finalForcedLossType,
        forcedLossSequence: finalForcedLossSequence,
        missedDoubleMise,
        needsVCTCheck: needsVCTCheck || undefined,
      };

      self.postMessage(response);
    }
  } catch (error) {
    console.error("Review Worker error:", error);
    // エラー時はデフォルト結果を返す
    const response: FullEvalResult = {
      mode: "fullEval",
      moveIndex,
      bestMove: { row: 7, col: 7 },
      bestScore: 0,
      playedScore: 0,
      candidates: [],
      completedDepth: 0,
    };
    self.postMessage(response);
  }
};

export type {
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
};
