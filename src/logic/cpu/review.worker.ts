/**
 * 振り返り評価用 Web Worker
 *
 * 1手を受け取り、その局面でhard準拠の探索を実行して評価結果を返す
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import ReviewWorker from './review.worker?worker'
 */

import type { BoardState, Position } from "@/types/game";
import type {
  ForcedLossResult,
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
import { DIFFICULTY_PARAMS, type ScoreBreakdown } from "@/types/cpu";

import type { MoveScoreEntry } from "./search/results";

import { countStones } from "./core/boardUtils";
import {
  detectOpponentThreats,
  evaluatePositionWithBreakdown,
  evaluateBoardWithBreakdown,
  PATTERN_SCORES,
} from "./evaluation";
import { findMiseTargets } from "./evaluation/miseTactics";
import { findDoubleMiseMoves } from "./evaluation/tactics";
import { createsFourThree } from "./evaluation/winningPatterns";
import {
  checkCandidateForcedLoss,
  checkForcedLoss,
  CANDIDATE_VERIFY_VCF_OPTIONS,
  CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
  CANDIDATE_VERIFY_VCT_OPTIONS,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./review/forcedLossCheck";
import { findBestMoveIterativeWithTT } from "./search/minimax";
import { findMiseVCFSequence } from "./search/miseVcf";
import { findVCFSequence, findVCFSequenceFromFirstMove } from "./search/vcf";
import {
  findVCTSequence,
  findVCTSequenceFromFirstMove,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
  type VCTBranch,
  type VCTSearchOptions,
} from "./search/vct";

/** 振り返り専用の探索パラメータ（hardから分離し深度を引き上げ） */
const REVIEW_SEARCH_PARAMS = {
  depth: 8,
  timeLimit: 15_000,
  maxNodes: 2_000_000,
  absoluteTimeLimit: 20_000,
  evaluationOptions: DIFFICULTY_PARAMS.hard.evaluationOptions,
} as const;

/** 振り返り用VCT探索パラメータ（forcedWin表示用、分岐収集あり） */
const REVIEW_VCT_OPTIONS_WITH_BRANCHES: VCTSearchOptions = {
  maxDepth: 6,
  timeLimit: 3000,
  vcfOptions: {
    maxDepth: 16,
    timeLimit: 3000,
  },
  collectBranches: true,
};

/**
 * 実際に打った手が追い詰め開始手かチェックし、スコアとシーケンスを返す
 */
function evaluatePlayedForcedWin(
  board: BoardState,
  color: "black" | "white",
  playedRow: number,
  playedCol: number,
  bestMove: Position,
  bestScore: number,
  result: { candidates?: MoveScoreEntry[]; score: number },
  skipVctThresholdCheck?: boolean,
  doubleMiseMoves?: Position[],
): { playedScore: number; playedForcedWinSequence: Position[] | undefined } {
  if (
    playedRow < 0 ||
    (playedRow === bestMove.row && playedCol === bestMove.col)
  ) {
    return { playedScore: bestScore, playedForcedWinSequence: undefined };
  }

  const playedPos = { row: playedRow, col: playedCol };

  // 両ミセ手チェック（VCFより前に）
  if (
    doubleMiseMoves?.some((m) => m.row === playedRow && m.col === playedCol)
  ) {
    return {
      playedScore: PATTERN_SCORES.FIVE,
      playedForcedWinSequence: undefined,
    };
  }

  // VCF シーケンス取得を試行
  const vcfFromPlayed = findVCFSequenceFromFirstMove(
    board,
    playedPos,
    color,
    REVIEW_VCF_OPTIONS,
  );
  if (vcfFromPlayed) {
    return {
      playedScore: PATTERN_SCORES.FIVE,
      playedForcedWinSequence: vcfFromPlayed.sequence,
    };
  }

  // VCT シーケンス取得を試行
  if (skipVctThresholdCheck || countStones(board) >= VCT_STONE_THRESHOLD) {
    const vctFromPlayed = findVCTSequenceFromFirstMove(
      board,
      playedPos,
      color,
      REVIEW_VCT_OPTIONS_WITH_BRANCHES,
    );
    if (vctFromPlayed) {
      return {
        playedScore: PATTERN_SCORES.FIVE,
        playedForcedWinSequence: vctFromPlayed.sequence,
      };
    }
    // VCT開始手だがシーケンス取得失敗（カウンター脅威の実装差）
    if (
      isVCTFirstMove(board, playedPos, color, REVIEW_VCT_OPTIONS_WITH_BRANCHES)
    ) {
      return {
        playedScore: PATTERN_SCORES.FIVE,
        playedForcedWinSequence: undefined,
      };
    }
  }

  // minimax候補から探す
  const minimaxEntry = result.candidates?.find(
    (c) => c.move.row === playedRow && c.move.col === playedCol,
  );
  return {
    playedScore: minimaxEntry?.score ?? result.score - 2000,
    playedForcedWinSequence: undefined,
  };
}

/**
 * 両ミセの分岐情報を構築
 *
 * Main PV: [bestMove, targets[0], targets[1]]
 * 各分岐: opponent が targets[i] (i≥1) を防御 → self が surviving target で四三完成
 */
function buildDoubleMiseBranches(
  board: BoardState,
  bestMove: Position,
  color: "black" | "white",
  opponentColor: "black" | "white",
  targets: Position[],
): ForcedWinBranch[] | undefined {
  const bmRow = board[bestMove.row];
  if (!bmRow) {
    return undefined;
  }

  bmRow[bestMove.col] = color;
  const branches: ForcedWinBranch[] = [];

  for (let i = 1; i < targets.length; i++) {
    const defense = targets[i];
    if (!defense) {
      continue;
    }
    const surviving = findSurvivingTarget(
      board,
      defense,
      i,
      targets,
      color,
      opponentColor,
    );
    if (surviving) {
      branches.push({
        defenseIndex: 1,
        defenseMove: defense,
        continuation: [surviving],
      });
    }
  }

  bmRow[bestMove.col] = null;
  return branches.length > 0 ? branches : undefined;
}

/**
 * 防御手を仮配置し、残りのターゲットで四三が成立するものを探す
 */
function findSurvivingTarget(
  board: BoardState,
  defense: Position,
  defenseIdx: number,
  targets: Position[],
  color: "black" | "white",
  opponentColor: "black" | "white",
): Position | undefined {
  const defRow = board[defense.row];
  if (!defRow) {
    return undefined;
  }

  defRow[defense.col] = opponentColor;

  let result: Position | undefined = undefined;
  for (let j = 0; j < targets.length; j++) {
    if (j === defenseIdx) {
      continue;
    }
    const target = targets[j];
    if (target && createsFourThree(board, target.row, target.col, color)) {
      result = target;
      break;
    }
  }

  defRow[defense.col] = null;
  return result;
}

/**
 * 候補手リストを事後検証し、相手に強制勝ちを許す手にフラグを付ける
 *
 * 最善手（index 0）から順に検証し、安全な手が見つかった時点で打ち切る。
 * @returns demotedBest - 最善手が降格されたか
 */
function verifyCandidates(
  board: BoardState,
  candidates: ReviewCandidate[],
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  timeBudgetMs: number,
): { demotedBest: boolean; bestLoss?: ForcedLossResult } {
  const deadline = performance.now() + timeBudgetMs;
  let demotedBest = false;
  let bestLoss: ForcedLossResult | undefined = undefined;

  for (let i = 0; i < candidates.length; i++) {
    if (performance.now() > deadline) {
      break;
    }
    const cand = candidates[i];
    if (!cand) {
      continue;
    }

    const loss = checkCandidateForcedLoss(
      board,
      cand.position,
      color,
      opponentColor,
      stoneCount,
      {
        vcfOptions: CANDIDATE_VERIFY_VCF_OPTIONS,
        miseVcfOptions: CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
        vctOptions: CANDIDATE_VERIFY_VCT_OPTIONS,
      },
    );

    if (loss) {
      cand.opponentForcedWin = loss.type;
      if (i === 0) {
        demotedBest = true;
        bestLoss = loss;
      }
    } else {
      // 安全な手を発見 → 以降の検証不要
      break;
    }
  }

  return { demotedBest, bestLoss };
}

/**
 * 候補手を安全度→スコア順にソートし、最上位の安全な候補を返す
 */
function findSafeBest(
  candidates: ReviewCandidate[],
): ReviewCandidate | undefined {
  candidates.sort((a, b) => {
    const aUnsafe = a.opponentForcedWin ? 1 : 0;
    const bUnsafe = b.opponentForcedWin ? 1 : 0;
    if (aUnsafe !== bUnsafe) {
      return aUnsafe - bUnsafe;
    }
    return b.searchScore - a.searchScore;
  });
  return candidates.find((c) => !c.opponentForcedWin);
}

self.onmessage = (event: MessageEvent<ReviewEvalRequest>) => {
  const {
    moveHistory,
    moveIndex,
    playerFirst: _playerFirst,
    isLightEval,
    vctCheckOnly,
  } = event.data;

  const workerStartTime = performance.now();

  try {
    const moves = moveHistory.trim().split(/\s+/);

    // Phase 2: VCTチェックのみ実行
    if (vctCheckOnly) {
      const { board: boardAfter } = createBoardFromRecord(
        moves.slice(0, moveIndex + 1).join(" "),
      );
      const color = moveIndex % 2 === 0 ? "black" : "white";
      const opponentColor = color === "black" ? "white" : "black";
      const stoneCountAfter = countStones(boardAfter);

      // 自分に四があれば相手はVCT不可
      const selfThreats = detectOpponentThreats(boardAfter, color);
      const selfHasFour =
        selfThreats.fours.length > 0 || selfThreats.openFours.length > 0;

      let forcedLossType: ForcedLossType | undefined = undefined;
      let forcedLossSequence: Position[] | undefined = undefined;
      if (!selfHasFour && stoneCountAfter >= VCT_STONE_THRESHOLD) {
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

    // 両ミセ検出（VCF探索より前に1回だけ呼ぶ、~5ms）
    const doubleMiseMoves =
      !isLightEval && !opponentHasFour ? findDoubleMiseMoves(board, color) : [];
    const doubleMiseBestMove =
      doubleMiseMoves.length > 0 ? (doubleMiseMoves[0] ?? null) : null;

    // 拡張VCF/VCT探索（高速パス）
    // 相手の四がある場合はVCF/VCTをスキップ（四を止めなければ即負け）
    // 両ミセがある場合: maxDepth 2 で1手四三を検出（四三はVCF的に3手=depth 2）
    // 両ミセがない場合: 通常のVCF全探索
    const vcfResult = opponentHasFour
      ? null
      : findVCFSequence(
          board,
          color,
          doubleMiseBestMove
            ? { ...REVIEW_VCF_OPTIONS, maxDepth: 2 }
            : REVIEW_VCF_OPTIONS,
        );

    // 1手四三: VCFの初手が四三を作る場合、両ミセより優先
    // （VCF sequence ≤ 1 は即五/活四、≤ 3 かつ初手が四三なら1手四三）
    const isImmediateFourThree =
      vcfResult &&
      (vcfResult.sequence.length <= 1 ||
        (doubleMiseBestMove &&
          createsFourThree(
            board,
            vcfResult.firstMove.row,
            vcfResult.firstMove.col,
            color,
          )));

    // Mise-VCF検出（VCFも両ミセもない場合のみ）
    const miseVcfResult =
      !vcfResult && !doubleMiseBestMove && !opponentHasFour
        ? findMiseVCFSequence(board, color, REVIEW_MISE_VCF_OPTIONS)
        : null;

    // forcedWin 構築（優先順: 1手四三 > 両ミセ ≥ 長VCF > Mise-VCF > VCT）
    let forcedWin: {
      firstMove: Position;
      sequence: Position[];
      isForbiddenTrap: boolean;
      branches?: unknown;
    } | null = null;
    if (isImmediateFourThree) {
      forcedWin = vcfResult;
    } else if (doubleMiseBestMove) {
      forcedWin = {
        firstMove: doubleMiseBestMove,
        sequence: [doubleMiseBestMove],
        isForbiddenTrap: false,
      };
    } else {
      forcedWin =
        vcfResult ??
        miseVcfResult ??
        (countStones(board) >= VCT_STONE_THRESHOLD && !opponentHasFour
          ? findVCTSequence(board, color, REVIEW_VCT_OPTIONS_WITH_BRANCHES)
          : null);
    }

    // forcedWinType 判定
    let forcedWinType: ForcedWinType | undefined = undefined;
    if (forcedWin?.isForbiddenTrap) {
      forcedWinType = "forbidden-trap";
    } else if (isImmediateFourThree) {
      forcedWinType = "vcf";
    } else if (doubleMiseBestMove) {
      forcedWinType = "double-mise";
    } else if (vcfResult) {
      forcedWinType = "vcf";
    } else if (miseVcfResult) {
      forcedWinType = "mise-vcf";
    } else if (forcedWin) {
      forcedWinType = "vct";
    }

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
        } else if (stoneCountAfter >= VCT_STONE_THRESHOLD) {
          needsVCTCheck = true;
        }
      }
    }

    // 通常探索（候補手比較データ用）
    const result = findBestMoveIterativeWithTT(
      board,
      color,
      REVIEW_SEARCH_PARAMS.depth,
      REVIEW_SEARCH_PARAMS.timeLimit,
      0, // randomFactor: 0（決定論的）
      REVIEW_SEARCH_PARAMS.evaluationOptions,
      REVIEW_SEARCH_PARAMS.maxNodes,
      REVIEW_SEARCH_PARAMS.absoluteTimeLimit,
    );

    // minimax が FIVE を返したが VCF/VCT 未検出
    // 石数 < VCT_STONE_THRESHOLD(14) の序盤ではVCT探索がスキップされるため、
    // ここで閾値を無視してVCT探索を実行し、必勝手順を取得する
    if (
      !forcedWin &&
      !doubleMiseBestMove &&
      result.score >= PATTERN_SCORES.FIVE &&
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
      const elapsedFW = performance.now() - workerStartTime;
      const timeBudgetFW = Math.max(1000, Math.min(5000, 25_000 - elapsedFW));
      const { demotedBest: fwDemoted, bestLoss: fwBestLoss } = verifyCandidates(
        board,
        candidates,
        color,
        opponentColor,
        stoneCountFW,
        timeBudgetFW,
      );

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
      if (fwDemoted) {
        const safeBest = findSafeBest(candidates);
        if (safeBest) {
          finalBestMove = safeBest.position;
          finalBestScore = safeBest.searchScore;
        } else if (fwBestLoss) {
          // 全候補が被必勝 → 局面自体が被必勝
          fwForcedLossType = fwBestLoss.type;
          fwForcedLossSequence = fwBestLoss.sequence;
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
      const elapsed = performance.now() - workerStartTime;
      const timeBudget = Math.max(1000, Math.min(5000, 25_000 - elapsed));
      const { demotedBest, bestLoss } = verifyCandidates(
        board,
        candidates,
        color,
        opponentColor,
        stoneCount,
        timeBudget,
      );

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
      if (demotedBest) {
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
