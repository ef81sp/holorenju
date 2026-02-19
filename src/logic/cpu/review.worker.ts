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
import { findBestMoveIterativeWithTT } from "./search/minimax";
import {
  findMiseVCFSequence,
  type MiseVCFSearchOptions,
} from "./search/miseVcf";
import { findVCFSequence, type VCFSearchOptions } from "./search/vcf";
import {
  findVCTSequence,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
  type VCTBranch,
  type VCTSearchOptions,
} from "./search/vct";

/** 振り返り用パラメータ（hard準拠） */
const REVIEW_TIME_LIMIT = DIFFICULTY_PARAMS.hard.timeLimit;
const REVIEW_MAX_NODES = DIFFICULTY_PARAMS.hard.maxNodes;

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

type ForcedLossType = "vcf" | "vct" | "forbidden-trap" | "mise-vcf";

interface ForcedLossResult {
  type: ForcedLossType;
  sequence: Position[];
}

/**
 * 相手の必勝手順（VCF→Mise-VCF→VCT）を検出する
 */
function checkForcedLoss(
  boardAfter: BoardState,
  opponentColor: "black" | "white",
  stoneCountAfter: number,
): ForcedLossResult | undefined {
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
    const hardParams = DIFFICULTY_PARAMS.hard;

    // 相手の脅威チェック（VCF/VCT探索より先に実行）
    const opponentColor = color === "black" ? "white" : "black";
    const opponentThreats = detectOpponentThreats(board, opponentColor);
    const opponentHasFour =
      opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

    // 拡張VCF/VCT探索（高速パス）
    // 相手の四がある場合はVCF/VCTをスキップ（四を止めなければ即負け）
    const vcfResult = opponentHasFour
      ? null
      : findVCFSequence(board, color, REVIEW_VCF_OPTIONS);

    // Mise-VCF検出（VCFが見つからない場合のみ）
    const miseVcfResult =
      !vcfResult && !opponentHasFour
        ? findMiseVCFSequence(board, color, REVIEW_MISE_VCF_OPTIONS)
        : null;

    const forcedWin =
      vcfResult ??
      miseVcfResult ??
      (countStones(board) >= VCT_STONE_THRESHOLD && !opponentHasFour
        ? findVCTSequence(board, color, REVIEW_VCT_OPTIONS)
        : null);
    let forcedWinType:
      | "vcf"
      | "vct"
      | "forbidden-trap"
      | "mise-vcf"
      | undefined = undefined;
    if (forcedWin?.isForbiddenTrap) {
      forcedWinType = "forbidden-trap";
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
        bestMove: forcedWin?.firstMove ?? { row: 7, col: 7 },
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
      hardParams.depth,
      REVIEW_TIME_LIMIT,
      0, // randomFactor: 0（決定論的）
      hardParams.evaluationOptions,
      REVIEW_MAX_NODES,
    );

    // 候補手エントリから内訳付きデータを構築するヘルパー
    const buildCandidate = (entry: MoveScoreEntry): ReviewCandidate => {
      const { score: breakdownScore, breakdown } =
        evaluatePositionWithBreakdown(
          board,
          entry.move.row,
          entry.move.col,
          color,
          hardParams.evaluationOptions,
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

    // VCT/VCF検出時のスコア・候補手オーバーライド
    if (forcedWin) {
      const bestScore = PATTERN_SCORES.FIVE;
      const bestMove = forcedWin.firstMove;

      // 実際の手のスコア判定
      let playedScore: number = bestScore;
      if (
        playedRow >= 0 &&
        !(playedRow === bestMove.row && playedCol === bestMove.col)
      ) {
        // 別の追い詰め開始手かチェック
        if (
          countStones(board) >= VCT_STONE_THRESHOLD &&
          isVCTFirstMove(
            board,
            { row: playedRow, col: playedCol },
            color,
            REVIEW_VCT_OPTIONS,
          )
        ) {
          playedScore = PATTERN_SCORES.FIVE;
        } else {
          // minimax候補から探す
          const minimaxEntry = result.candidates?.find(
            (c) => c.move.row === playedRow && c.move.col === playedCol,
          );
          playedScore = minimaxEntry?.score ?? result.score - 2000;
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
          hardParams.evaluationOptions,
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

      // 実際の手が候補に入っていなければ追加
      if (
        playedRow >= 0 &&
        !candidates.some(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        )
      ) {
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

      const response: ReviewWorkerResult = {
        moveIndex,
        bestMove,
        bestScore,
        playedScore,
        candidates,
        completedDepth: result.completedDepth,
        forcedWinType,
        forcedWinBranches,
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
