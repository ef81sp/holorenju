/**
 * 探索結果の型定義とPV抽出
 *
 * Minimax探索の結果を表す型とPrincipal Variation抽出ロジック
 */

import type { BoardState, Position } from "@/types/game";

import { checkFive, copyBoard } from "@/logic/renjuRules";

import { applyMove, getOppositeColor } from "../core/boardUtils";
import { evaluateStonePatterns, PATTERN_SCORES } from "../evaluation";
import { analyzeJumpPatterns } from "../evaluation/jumpPatterns";
import { detectOpponentThreats } from "../evaluation/threatDetection";
import { TranspositionTable } from "../transpositionTable";
import { updateHash } from "../zobrist";

/**
 * 候補手のスコア情報
 */
export interface MoveScoreEntry {
  /** 着手位置 */
  move: Position;
  /** 評価スコア */
  score: number;
  /** Principal Variation（予想手順） */
  pv?: Position[];
  /** PV末端の盤面（評価内訳計算用） */
  pvLeafBoard?: BoardState;
  /** PV末端での手番（評価内訳計算用） */
  pvLeafColor?: "black" | "white";
}

/**
 * PV抽出結果
 */
export interface PVExtractionResult {
  /** Principal Variation（予想手順） */
  pv: Position[];
  /** PV末端の盤面 */
  leafBoard: BoardState;
  /** PV末端での手番 */
  leafColor: "black" | "white";
}

/**
 * ランダム選択情報
 */
export interface RandomSelectionResult {
  /** ランダム選択が発生したか */
  wasRandom: boolean;
  /** 選択された手の元の順位（1始まり） */
  originalRank: number;
  /** 選択対象の候補数 */
  candidateCount: number;
}

/**
 * Minimax探索結果
 */
export interface MinimaxResult {
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
  /** 候補手のスコアリスト（ソート済み） */
  candidates?: MoveScoreEntry[];
  /** ランダム選択情報 */
  randomSelection?: RandomSelectionResult;
}

/**
 * 深度別の最善手情報
 */
export interface DepthHistoryEntry {
  /** 探索深度 */
  depth: number;
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
}

/**
 * Iterative Deepening結果
 */
export interface IterativeDeepingResult extends MinimaxResult {
  /** 実際に完了した探索深度 */
  completedDepth: number;
  /** 時間切れで中断したか */
  interrupted: boolean;
  /** 経過時間（ミリ秒） */
  elapsedTime: number;
  /** 深度別の最善手履歴 */
  depthHistory?: DepthHistoryEntry[];
  /** 候補手が1つだけの強制手か（スコアは参考値） */
  forcedMove?: boolean;
}

/**
 * PVの手が必須防御ルールに違反していないかチェック
 *
 * 相手の脅威（活四・止め四・活三）を無視する手はPVとして不正
 *
 * @param board 現在の盤面（手を打つ前）
 * @param move 検証する手
 * @param color 手番の色
 * @returns 手が妥当ならtrue
 */
export function isValidPVMove(
  board: BoardState,
  move: Position,
  color: "black" | "white",
): boolean {
  // 五連が作れるなら常にOK
  if (checkFive(board, move.row, move.col, color)) {
    return true;
  }

  const opponentColor = getOppositeColor(color);
  const threats = detectOpponentThreats(board, opponentColor);

  // 仮想的に石を置いてパターンを評価（活四・四三の判定用）
  const testBoard = copyBoard(board);
  const testRow = testBoard[move.row];
  if (testRow) {
    testRow[move.col] = color;
  }
  const attackScore = evaluateStonePatterns(
    testBoard,
    move.row,
    move.col,
    color,
  );
  const hasMyOpenFour = attackScore >= PATTERN_SCORES.OPEN_FOUR;

  // 四三の判定
  const jumpResult = analyzeJumpPatterns(testBoard, move.row, move.col, color);
  const hasFourThree = jumpResult.hasFour && jumpResult.hasValidOpenThree;
  const canWinFirst = hasMyOpenFour || hasFourThree;

  // 相手の活四を止めない手は不正（例外: 自分の活四のみ）
  if (threats.openFours.length > 0 && !hasMyOpenFour) {
    const isDefending = threats.openFours.some(
      (p) => p.row === move.row && p.col === move.col,
    );
    if (!isDefending) {
      return false;
    }
  }

  // 相手の止め四を止めない手は不正（例外: 自分の活四のみ）
  if (
    threats.fours.length > 0 &&
    threats.openFours.length === 0 &&
    !hasMyOpenFour
  ) {
    const isDefending = threats.fours.some(
      (p) => p.row === move.row && p.col === move.col,
    );
    if (!isDefending) {
      return false;
    }
  }

  // 相手の活三を止めない手は不正（例外: 活四・四三で先に勝てる場合）
  if (
    threats.openThrees.length > 0 &&
    threats.openFours.length === 0 &&
    threats.fours.length === 0 &&
    !canWinFirst
  ) {
    const isDefending = threats.openThrees.some(
      (p) => p.row === move.row && p.col === move.col,
    );
    if (!isDefending) {
      return false;
    }
  }

  return true;
}

/**
 * TranspositionTableからPrincipal Variation（予想手順）を抽出
 *
 * TTに保存されたbestMoveを辿って、予想される手順を復元する。
 * 各手は必須防御ルールに対して検証され、違反する手でPVを打ち切る。
 *
 * @param board 現在の盤面
 * @param startHash 開始盤面のハッシュ
 * @param firstMove 最初の手（候補手）
 * @param color 最初の手番の色
 * @param tt TranspositionTable
 * @param maxLength 最大手数（デフォルト: 10）
 * @returns PV抽出結果（予想手順、末端盤面、末端での手番）
 */
export function extractPV(
  board: BoardState,
  startHash: bigint,
  firstMove: Position,
  color: "black" | "white",
  tt: TranspositionTable,
  maxLength = 10,
): PVExtractionResult {
  const pv: Position[] = [firstMove];
  let currentBoard = applyMove(board, firstMove, color);
  let currentHash = updateHash(startHash, firstMove.row, firstMove.col, color);
  let currentColor: "black" | "white" = getOppositeColor(color);

  // TTエントリを辿ってPVを復元
  for (let i = 1; i < maxLength; i++) {
    const entry = tt.probe(currentHash);
    if (!entry?.bestMove) {
      break;
    }

    const move = entry.bestMove;

    // 盤面の有効性チェック
    if (currentBoard[move.row]?.[move.col] !== null) {
      break;
    }

    // 必須防御ルール検証: 脅威を無視する手でPVを打ち切り
    if (!isValidPVMove(currentBoard, move, currentColor)) {
      break;
    }

    pv.push(move);
    currentBoard = applyMove(currentBoard, move, currentColor);
    currentHash = updateHash(currentHash, move.row, move.col, currentColor);
    currentColor = getOppositeColor(currentColor);
  }

  return {
    pv,
    leafBoard: currentBoard,
    leafColor: currentColor,
  };
}
