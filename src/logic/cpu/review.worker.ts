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
  ForcedWinBranch,
  ReviewCandidate,
  ReviewEvalRequest,
  ReviewWorkerResult,
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
import { findBestMoveIterativeWithTT } from "./search/minimax";
import {
  findMiseVCFSequence,
  type MiseVCFSearchOptions,
} from "./search/miseVcf";
import {
  findVCFSequence,
  findVCFSequenceFromFirstMove,
  type VCFSearchOptions,
} from "./search/vcf";
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

/** 振り返り用VCT探索パラメータ */
const REVIEW_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 6,
  timeLimit: 3000,
  vcfOptions: {
    maxDepth: 16,
    timeLimit: 3000,
  },
  collectBranches: true,
};

/** 振り返り用VCF探索パラメータ */
const REVIEW_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 16,
  timeLimit: 1500,
};

/** 振り返り用Mise-VCF探索パラメータ */
const REVIEW_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 12, timeLimit: 300 },
  timeLimit: 500,
};

type ForcedLossType =
  | "vcf"
  | "vct"
  | "forbidden-trap"
  | "mise-vcf"
  | "double-mise";

interface ForcedLossResult {
  type: ForcedLossType;
  sequence: Position[];
}

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
      REVIEW_VCT_OPTIONS,
    );
    if (vctFromPlayed) {
      return {
        playedScore: PATTERN_SCORES.FIVE,
        playedForcedWinSequence: vctFromPlayed.sequence,
      };
    }
    // VCT開始手だがシーケンス取得失敗（カウンター脅威の実装差）
    if (isVCTFirstMove(board, playedPos, color, REVIEW_VCT_OPTIONS)) {
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
 * 相手の必勝手順（VCF→Mise-VCF→VCT）を検出する
 */
function checkForcedLoss(
  boardAfter: BoardState,
  opponentColor: "black" | "white",
  stoneCountAfter: number,
): ForcedLossResult | undefined {
  // 両ミセ（最速: ~5ms。見つかればVCF探索をスキップ）
  const oppDM = findDoubleMiseMoves(boardAfter, opponentColor);
  if (oppDM.length > 0 && oppDM[0]) {
    return { type: "double-mise", sequence: [oppDM[0]] };
  }

  const oppVCF = findVCFSequence(boardAfter, opponentColor, REVIEW_VCF_OPTIONS);
  if (oppVCF) {
    return {
      type: oppVCF.isForbiddenTrap ? "forbidden-trap" : "vcf",
      sequence: oppVCF.sequence,
    };
  }

  const oppMise = findMiseVCFSequence(
    boardAfter,
    opponentColor,
    REVIEW_MISE_VCF_OPTIONS,
  );
  if (oppMise) {
    return { type: "mise-vcf", sequence: oppMise.sequence };
  }

  if (stoneCountAfter >= VCT_STONE_THRESHOLD) {
    const oppVCT = findVCTSequence(
      boardAfter,
      opponentColor,
      REVIEW_VCT_OPTIONS,
    );
    if (oppVCT) {
      return {
        type: oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct",
        sequence: oppVCT.sequence,
      };
    }
  }

  return undefined;
}

self.onmessage = (event: MessageEvent<ReviewEvalRequest>) => {
  const {
    moveHistory,
    moveIndex,
    playerFirst: _playerFirst,
    isLightEval,
  } = event.data;

  try {
    const moves = moveHistory.trim().split(/\s+/);

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
          ? findVCTSequence(board, color, REVIEW_VCT_OPTIONS)
          : null);
    }

    // forcedWinType 判定
    let forcedWinType:
      | "vcf"
      | "vct"
      | "forbidden-trap"
      | "mise-vcf"
      | "double-mise"
      | undefined = undefined;
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
      const response: ReviewWorkerResult = {
        moveIndex,
        bestMove: forcedWin?.firstMove ??
          doubleMiseBestMove ?? { row: 7, col: 7 },
        bestScore: 0,
        playedScore: 0,
        candidates: [],
        completedDepth: 0,
        forcedWinType,
        isLightEval: true,
      };
      self.postMessage(response);
      return;
    }

    // 相手の必勝手順検出（プレイヤー手用）
    // プレイヤーの手を打った後の局面で相手のVCF/VCT等を探す
    let forcedLossType: ForcedLossType | undefined = undefined;
    let forcedLossSequence: Position[] | undefined = undefined;
    if (!forcedWin && moves[moveIndex]) {
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
        );
        if (loss) {
          forcedLossType = loss.type;
          forcedLossSequence = loss.sequence;
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
      const vctRetry = findVCTSequence(board, color, REVIEW_VCT_OPTIONS);
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
      candidates.push({
        position: bestMove,
        score: Math.round(fwBreakdownScore),
        searchScore: PATTERN_SCORES.FIVE,
        breakdown: fwBreakdown as ScoreBreakdown,
        principalVariation: forcedWin.sequence,
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

      // VCT分岐情報の変換（VCTSequenceResultのみbranches有）
      const rawBranches =
        "branches" in forcedWin
          ? (forcedWin.branches as VCTBranch[] | undefined)
          : undefined;
      const forcedWinBranches: ForcedWinBranch[] | undefined = rawBranches?.map(
        (b) => ({
          defenseIndex: b.defenseIndex,
          defenseMove: b.defenseMove,
          continuation: b.continuation,
        }),
      );

      // 両ミセターゲット算出（四三を作る位置）
      let doubleMiseTargets: Position[] | undefined = undefined;
      if (doubleMiseBestMove) {
        const row = board[doubleMiseBestMove.row];
        if (row) {
          row[doubleMiseBestMove.col] = color;
          doubleMiseTargets = findMiseTargets(
            board,
            doubleMiseBestMove.row,
            doubleMiseBestMove.col,
            color,
          );
          row[doubleMiseBestMove.col] = null;
        }
      }

      const response: ReviewWorkerResult = {
        moveIndex,
        bestMove,
        bestScore,
        playedScore,
        candidates,
        completedDepth: result.completedDepth,
        forcedWinType,
        forcedWinBranches,
        missedDoubleMise,
        doubleMiseTargets,
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

      const response: ReviewWorkerResult = {
        moveIndex,
        bestMove: result.position,
        bestScore: result.score,
        playedScore,
        candidates,
        completedDepth: result.completedDepth,
        forcedLossType,
        forcedLossSequence,
        missedDoubleMise,
      };

      self.postMessage(response);
    }
  } catch (error) {
    console.error("Review Worker error:", error);
    // エラー時はデフォルト結果を返す
    const response: ReviewWorkerResult = {
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

export type { ReviewEvalRequest, ReviewWorkerResult };
