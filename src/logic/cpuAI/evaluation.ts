/**
 * 盤面評価関数
 *
 * 独自のパターンカウント関数を使用してスコアリングを行う
 */

import type { BoardState, StoneColor } from "@/types/game";

import {
  checkFive,
  checkForbiddenMove,
  checkJumpFour,
  checkJumpThree,
  copyBoard,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
  isValidPosition,
} from "@/logic/renjuRules";

import { countStones } from "./core/boardUtils";
import { DIRECTION_INDICES, DIRECTIONS } from "./core/constants";
import { hasVCF } from "./vcf";
import { hasVCT, VCT_STONE_THRESHOLD } from "./vct";

/**
 * パターンスコア定数
 */
/**
 * 評価オプション
 * 重い評価処理を難易度に応じて有効/無効化する
 */
export interface EvaluationOptions {
  /** フクミ手（VCF）評価を有効にするか */
  enableFukumi: boolean;
  /** ミセ手評価を有効にするか */
  enableMise: boolean;
  /** 禁手追い込み評価を有効にするか */
  enableForbiddenTrap: boolean;
  /** 複数方向脅威ボーナスを有効にするか */
  enableMultiThreat: boolean;
  /** カウンターフォー（防御しながら四を作る）を有効にするか */
  enableCounterFour: boolean;
  /** VCT（三・四連続勝ち）探索を有効にするか */
  enableVCT: boolean;
  /** 必須防御ルールを有効にするか（相手の活四・活三を止めない手を除外） */
  enableMandatoryDefense: boolean;
  /** 単発四の低評価を有効にするか（後続脅威がない四にペナルティ） */
  enableSingleFourPenalty: boolean;
  /** 事前計算された脅威情報（最適化用、ルートノードで計算して渡す） */
  precomputedThreats?: ThreatInfo;
}

/**
 * デフォルトの評価オプション（全て無効 = 高速モード）
 */
export const DEFAULT_EVAL_OPTIONS: EvaluationOptions = {
  enableFukumi: false,
  enableMise: false,
  enableForbiddenTrap: false,
  enableMultiThreat: false,
  enableCounterFour: false,
  enableVCT: false,
  enableMandatoryDefense: false,
  enableSingleFourPenalty: false,
};

/**
 * 全機能有効の評価オプション
 */
export const FULL_EVAL_OPTIONS: EvaluationOptions = {
  enableFukumi: true,
  enableMise: true,
  enableForbiddenTrap: true,
  enableMultiThreat: true,
  enableCounterFour: true,
  enableVCT: true,
  enableMandatoryDefense: true,
  enableSingleFourPenalty: true,
};

export const PATTERN_SCORES = {
  /** 五連（勝利） */
  FIVE: 100000,
  /** 活四（両端開） */
  OPEN_FOUR: 10000,
  /** 禁手追い込み強（四の防御点が禁手） */
  FORBIDDEN_TRAP_STRONG: 8000,
  /** 四三同時作成ボーナス */
  FOUR_THREE_BONUS: 5000,
  /** フクミ手ボーナス（次にVCFがある手） */
  FUKUMI_BONUS: 1500,
  /** 禁手追い込みセットアップ（活三の延長点が禁手） */
  FORBIDDEN_TRAP_SETUP: 1500,
  /** ミセ手ボーナス（次に四三を作れる手） */
  MISE_BONUS: 1000,
  /** 止め四（片端開） */
  FOUR: 1000,
  /** 活三（両端開） */
  OPEN_THREE: 1000,
  /** 止め三（片端開） */
  THREE: 100,
  /** 活二 */
  OPEN_TWO: 50,
  /** 止め二 */
  TWO: 10,
  /** 中央寄りボーナス */
  CENTER_BONUS: 5,
  /** 禁じ手誘導ボーナス（白番・旧定数、後方互換） */
  FORBIDDEN_TRAP: 100,
  /** 複数方向脅威ボーナス（2方向以上の脅威に追加） */
  MULTI_THREAT_BONUS: 500,
  /** VCT（三・四連続勝ち）ボーナス */
  VCT_BONUS: 8000,
  /** カウンターフォー倍率 */
  COUNTER_FOUR_MULTIPLIER: 1.5,
  /** 斜め方向ボーナス係数（斜め連は隣接空き点が多く効率が良い） */
  DIAGONAL_BONUS_MULTIPLIER: 1.05,
} as const;

/**
 * 端の状態
 */
type EndState = "empty" | "opponent" | "edge";

/**
 * 方向パターン分析結果
 */
interface DirectionPattern {
  /** 連続する石の数 */
  count: number;
  /** 正方向の端の状態 */
  end1: EndState;
  /** 負方向の端の状態 */
  end2: EndState;
}

/**
 * 指定方向に連続する同色石をカウントし、端の状態を確認
 *
 * @param board 盤面
 * @param row 起点行
 * @param col 起点列
 * @param dr 行方向
 * @param dc 列方向
 * @param color 石の色
 * @returns 連続数と端の状態
 */
function countInDirection(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { count: number; endState: EndState } {
  let count = 0;
  let r = row + dr;
  let c = col + dc;

  // 同色石をカウント
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  // 端の状態を確認
  let endState: EndState = "opponent";
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    endState = "empty";
  } else if (!isValidPosition(r, c)) {
    endState = "edge";
  }

  return { count, endState };
}

/**
 * 指定位置から指定方向のパターンを分析
 *
 * @param board 盤面
 * @param row 起点行
 * @param col 起点列
 * @param dr 行方向
 * @param dc 列方向
 * @param color 石の色
 * @returns パターン分析結果
 */
function analyzeDirection(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): DirectionPattern {
  // 正方向
  const pos = countInDirection(board, row, col, dr, dc, color);
  // 負方向
  const neg = countInDirection(board, row, col, -dr, -dc, color);

  return {
    count: pos.count + neg.count + 1, // +1は起点自身
    end1: pos.endState,
    end2: neg.endState,
  };
}

/**
 * パターンからスコアを計算
 *
 * @param pattern パターン分析結果
 * @returns スコア
 */
function getPatternScore(pattern: DirectionPattern): number {
  const { count, end1, end2 } = pattern;
  const bothOpen = end1 === "empty" && end2 === "empty";
  const oneOpen = end1 === "empty" || end2 === "empty";

  switch (count) {
    case 5:
      return PATTERN_SCORES.FIVE;
    case 4:
      if (bothOpen) {
        return PATTERN_SCORES.OPEN_FOUR;
      }
      if (oneOpen) {
        return PATTERN_SCORES.FOUR;
      }
      return 0; // 両端塞がり
    case 3:
      if (bothOpen) {
        return PATTERN_SCORES.OPEN_THREE;
      }
      if (oneOpen) {
        return PATTERN_SCORES.THREE;
      }
      return 0;
    case 2:
      if (bothOpen) {
        return PATTERN_SCORES.OPEN_TWO;
      }
      if (oneOpen) {
        return PATTERN_SCORES.TWO;
      }
      return 0;
    default:
      // 6以上は長連（黒の禁手だが白には有利）
      if (count >= 6) {
        return PATTERN_SCORES.FIVE;
      }
      return 0;
  }
}

/**
 * 中央からの距離に基づくボーナスを計算
 * 中央（7,7）に近いほど高いスコア
 */
function getCenterBonus(row: number, col: number): number {
  const centerRow = 7;
  const centerCol = 7;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);
  // 最大距離は14（角から中央）、距離が近いほど高スコア
  return Math.max(0, PATTERN_SCORES.CENTER_BONUS * (14 - distance)) / 14;
}

/**
 * 跳びパターンの分析結果
 */
interface JumpPatternResult {
  /** 跳び四がある（連続四 or 跳び四） */
  hasFour: boolean;
  /** 跳び四の数（連続四は含まない） */
  jumpFourCount: number;
  /** 活跳び四がある（両端が空いている跳び四は存在しないので連続四のみ） */
  hasOpenFour: boolean;
  /** 跳び三がある */
  hasJumpThree: boolean;
  /** 有効な活三がある（連続三・跳び三ともにウソの三でない） */
  hasValidOpenThree: boolean;
}

/**
 * 連続三が有効（ウソの三でない）かをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param dirIndex renjuRules.tsのDIRECTIONSに対応する方向インデックス
 * @returns 三が有効ならtrue
 */
function isValidConsecutiveThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
): boolean {
  const straightFourPoints = getConsecutiveThreeStraightFourPoints(
    board,
    row,
    col,
    dirIndex,
  );

  if (straightFourPoints.length === 0) {
    return false;
  }

  for (const pos of straightFourPoints) {
    const result = checkForbiddenMove(board, pos.row, pos.col);
    if (!result.isForbidden) {
      return true;
    }
  }
  return false;
}

/**
 * 跳び三が有効（ウソの三でない）かをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param dirIndex renjuRules.tsのDIRECTIONSに対応する方向インデックス
 * @returns 三が有効ならtrue
 */
function isValidJumpThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
): boolean {
  const straightFourPoints = getJumpThreeStraightFourPoints(
    board,
    row,
    col,
    dirIndex,
  );

  if (straightFourPoints.length === 0) {
    return false;
  }

  for (const pos of straightFourPoints) {
    const result = checkForbiddenMove(board, pos.row, pos.col);
    if (!result.isForbidden) {
      return true;
    }
  }
  return false;
}

/**
 * 跳びパターン（跳び三・跳び四）を分析
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 跳びパターンの分析結果
 */
function analyzeJumpPatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): JumpPatternResult {
  const result: JumpPatternResult = {
    hasFour: false,
    jumpFourCount: 0,
    hasOpenFour: false,
    hasJumpThree: false,
    hasValidOpenThree: false,
  };

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    // 連続パターンを先にチェック（DIRECTIONSの順に）
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 連続四をチェック
    if (pattern.count === 4) {
      result.hasFour = true;
      if (pattern.end1 === "empty" && pattern.end2 === "empty") {
        result.hasOpenFour = true;
      }
    }

    // 連続三をチェック（活三）
    if (pattern.count === 3) {
      if (pattern.end1 === "empty" && pattern.end2 === "empty") {
        if (
          color === "white" ||
          isValidConsecutiveThree(board, row, col, dirIndex)
        ) {
          result.hasValidOpenThree = true;
        }
      }
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, color)
    ) {
      result.hasFour = true;
      result.jumpFourCount++;
      // 跳び四は両端開の形がないので、常に止め四扱い
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      result.hasJumpThree = true;
      // 白番ならウソの三チェック不要、黒番なら達四点が禁点でないかチェック
      if (color === "white" || isValidJumpThree(board, row, col, dirIndex)) {
        result.hasValidOpenThree = true;
      }
    }
  }

  return result;
}

/**
 * 複数方向に脅威（活三以上）がある数をカウント
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 脅威がある方向数
 */
function countThreatDirections(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  let threatCount = 0;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 活四 or 止め四
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      threatCount++;
      continue;
    }

    // 活三
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      // 黒の場合はウソの三かどうかチェック
      if (
        color === "white" ||
        isValidConsecutiveThree(board, row, col, dirIndex)
      ) {
        threatCount++;
        continue;
      }
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, color)
    ) {
      threatCount++;
      continue;
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      if (color === "white" || isValidJumpThree(board, row, col, dirIndex)) {
        threatCount++;
      }
    }
  }

  return threatCount;
}

/**
 * 複数方向脅威ボーナスを計算
 *
 * @param threatCount 脅威がある方向数
 * @returns ボーナススコア
 */
function evaluateMultiThreat(threatCount: number): number {
  return threatCount >= 2
    ? PATTERN_SCORES.MULTI_THREAT_BONUS * (threatCount - 1)
    : 0;
}

/**
 * 白の三三・四四パターンをチェック
 * 白には禁手がないため、三三・四四は即勝利となる
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @returns 三三または四四なら true
 */
function checkWhiteWinningPattern(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  let openThreeCount = 0;
  let fourCount = 0;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, "white");

    // 活三カウント
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      openThreeCount++;
    }

    // 四カウント（活四・止め四両方）
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      fourCount++;
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, "white")
    ) {
      openThreeCount++;
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, "white")
    ) {
      fourCount++;
    }
  }

  // 三三（活三2つ以上）または四四（四2つ以上）なら即勝利
  return openThreeCount >= 2 || fourCount >= 2;
}

/**
 * 禁手追い込み評価
 * 白が四や活三を作った時、黒の防御位置が禁手なら高評価
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @returns 禁手追い込みスコア
 */
function evaluateForbiddenTrap(
  board: BoardState,
  row: number,
  col: number,
): number {
  let trapScore = 0;

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(board, row, col, dr, dc, "white");

    // 四を作った場合
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      // 黒の止め位置を特定
      const defensePositions = getDefensePositions(board, row, col, dr, dc);

      // すべての防御位置が禁手ならば白の勝利確定
      let allForbidden = defensePositions.length > 0;
      for (const pos of defensePositions) {
        const forbiddenResult = checkForbiddenMove(board, pos.row, pos.col);
        if (!forbiddenResult.isForbidden) {
          allForbidden = false;
          break;
        }
      }

      if (allForbidden && defensePositions.length > 0) {
        trapScore += PATTERN_SCORES.FORBIDDEN_TRAP_STRONG;
      }
    }

    // 活三を作った場合（次に四になる）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      // 両端の位置をチェック（活三の延長点）
      const extensionPoints = getExtensionPoints(board, row, col, dr, dc);

      for (const pos of extensionPoints) {
        const forbiddenResult = checkForbiddenMove(board, pos.row, pos.col);
        if (forbiddenResult.isForbidden) {
          // 禁手への誘導セットアップ
          trapScore += PATTERN_SCORES.FORBIDDEN_TRAP_SETUP;
        }
      }
    }
  }

  return trapScore;
}

/**
 * 四に対する防御位置を取得
 */
function getDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

/**
 * 活三の延長点を取得（両端の空きマス）
 */
function getExtensionPoints(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

/**
 * ミセ手判定
 * 次の手で四三が作れる位置かどうかをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns ミセ手ならtrue
 */
function isMiseMove(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // この手の後、周囲に四三が作れる位置があるかチェック
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }
      const nr = row + dr;
      const nc = col + dc;
      if (!isValidPosition(nr, nc)) {
        continue;
      }
      if (board[nr]?.[nc] !== null) {
        continue;
      }

      // 黒の禁手チェック
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, nr, nc);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // この位置で四三が作れるか
      if (createsFourThree(board, nr, nc, color)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 指定位置に石を置くと四三ができるかチェック
 */
function createsFourThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // 仮想的に石を置く
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 四と有効な活三を同時に作るかチェック
  const jumpResult = analyzeJumpPatterns(testBoard, row, col, color);
  return jumpResult.hasFour && jumpResult.hasValidOpenThree;
}

/**
 * フクミ手判定
 * 次の手でVCF（四追い勝ち）があるかどうかをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param color 石の色
 * @returns フクミ手ならtrue
 */
function isFukumiMove(board: BoardState, color: "black" | "white"): boolean {
  return hasVCF(board, color);
}

/**
 * 相手の脅威情報
 */
export interface ThreatInfo {
  /** 活四の防御位置（両端空き = 防御不可） */
  openFours: { row: number; col: number }[];
  /** 止め四の防御位置（片側空き = 1点で防御可） */
  fours: { row: number; col: number }[];
  /** 活三の防御位置 */
  openThrees: { row: number; col: number }[];
}

/**
 * 相手の脅威（活四・活三）を検出
 *
 * @param board 盤面
 * @param opponentColor 相手の色
 * @returns 脅威情報（活四・活三の防御位置）
 */
export function detectOpponentThreats(
  board: BoardState,
  opponentColor: "black" | "white",
): ThreatInfo {
  const result: ThreatInfo = {
    openFours: [],
    fours: [],
    openThrees: [],
  };

  // 相手の石を全て走査
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      if (board[row]?.[col] !== opponentColor) {
        continue;
      }

      // 各方向をチェック
      for (const [dr, dc] of DIRECTIONS) {
        const pattern = analyzeDirection(
          board,
          row,
          col,
          dr,
          dc,
          opponentColor,
        );

        // 活四をチェック（両端が空いている4連）
        if (
          pattern.count === 4 &&
          pattern.end1 === "empty" &&
          pattern.end2 === "empty"
        ) {
          // 両端の防御位置を追加
          const defensePositions = getOpenFourDefensePositions(
            board,
            row,
            col,
            dr,
            dc,
            opponentColor,
          );
          for (const pos of defensePositions) {
            // 重複チェック
            if (
              !result.openFours.some(
                (p) => p.row === pos.row && p.col === pos.col,
              )
            ) {
              result.openFours.push(pos);
            }
          }
        }

        // 止め四をチェック（片側だけ空いている4連）
        if (
          pattern.count === 4 &&
          ((pattern.end1 === "empty" && pattern.end2 !== "empty") ||
            (pattern.end1 !== "empty" && pattern.end2 === "empty"))
        ) {
          // 空いている側の防御位置を追加（止め四は1点のみ）
          const defensePositions = getOpenFourDefensePositions(
            board,
            row,
            col,
            dr,
            dc,
            opponentColor,
          );
          for (const pos of defensePositions) {
            // 重複チェック
            if (
              !result.fours.some((p) => p.row === pos.row && p.col === pos.col)
            ) {
              result.fours.push(pos);
            }
          }
        }

        // 活三をチェック（両端が空いている3連）
        if (
          pattern.count === 3 &&
          pattern.end1 === "empty" &&
          pattern.end2 === "empty"
        ) {
          // 両端の防御位置を追加
          const defensePositions = getOpenThreeDefensePositions(
            board,
            row,
            col,
            dr,
            dc,
            opponentColor,
          );
          for (const pos of defensePositions) {
            // 重複チェック
            if (
              !result.openThrees.some(
                (p) => p.row === pos.row && p.col === pos.col,
              )
            ) {
              result.openThrees.push(pos);
            }
          }
        }

        // 跳び三をチェック（連続3石以外のパターン）
        if (pattern.count < 3) {
          const jumpDefensePositions = detectJumpThreePattern(
            board,
            row,
            col,
            dr,
            dc,
            opponentColor,
          );
          for (const pos of jumpDefensePositions) {
            // 重複チェック
            if (
              !result.openThrees.some(
                (p) => p.row === pos.row && p.col === pos.col,
              )
            ) {
              result.openThrees.push(pos);
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * 活四の防御位置を取得（両端の空きマス）
 */
function getOpenFourDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端を探す
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端を探す
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

/**
 * 活三の防御位置を取得（両端の空きマス）
 */
function getOpenThreeDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { row: number; col: number }[] {
  // 活四と同じロジック（両端の空きマス）
  return getOpenFourDefensePositions(board, row, col, dr, dc, color);
}

/**
 * 跳び三パターンを検出して防御位置を返す
 *
 * 跳び三パターン:
 * - ・●●・●・ (空白, 2石, 空白, 1石, 空白)
 * - ・●・●●・ (空白, 1石, 空白, 2石, 空白)
 *
 * @param board 盤面
 * @param row 起点行
 * @param col 起点列
 * @param dr 行方向
 * @param dc 列方向
 * @param color 石の色
 * @returns 防御位置の配列（跳びの空きマスと両端）
 */
function detectJumpThreePattern(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // パターン1: ・●●・●・ (起点が2石の先頭)
  // 位置: [row-dr, col-dc]=空, [row]=色, [row+dr]=色, [row+2dr]=空, [row+3dr]=色, [row+4dr]=空
  const p1_before = { row: row - dr, col: col - dc };
  const p1_second = { row: row + dr, col: col + dc };
  const p1_gap = { row: row + 2 * dr, col: col + 2 * dc };
  const p1_third = { row: row + 3 * dr, col: col + 3 * dc };
  const p1_after = { row: row + 4 * dr, col: col + 4 * dc };

  if (
    isValidPosition(p1_before.row, p1_before.col) &&
    board[p1_before.row]?.[p1_before.col] === null &&
    isValidPosition(p1_second.row, p1_second.col) &&
    board[p1_second.row]?.[p1_second.col] === color &&
    isValidPosition(p1_gap.row, p1_gap.col) &&
    board[p1_gap.row]?.[p1_gap.col] === null &&
    isValidPosition(p1_third.row, p1_third.col) &&
    board[p1_third.row]?.[p1_third.col] === color &&
    isValidPosition(p1_after.row, p1_after.col) &&
    board[p1_after.row]?.[p1_after.col] === null
  ) {
    // 防御位置: 間の空きマスと両端（どれが最善かは探索で決める）
    positions.push(p1_gap, p1_before, p1_after);
  }

  // パターン2: ・●・●●・ (起点が1石)
  // 位置: [row-dr]=空, [row]=色, [row+dr]=空, [row+2dr]=色, [row+3dr]=色, [row+4dr]=空
  const p2_before = { row: row - dr, col: col - dc };
  const p2_gap = { row: row + dr, col: col + dc };
  const p2_second = { row: row + 2 * dr, col: col + 2 * dc };
  const p2_third = { row: row + 3 * dr, col: col + 3 * dc };
  const p2_after = { row: row + 4 * dr, col: col + 4 * dc };

  if (
    isValidPosition(p2_before.row, p2_before.col) &&
    board[p2_before.row]?.[p2_before.col] === null &&
    isValidPosition(p2_gap.row, p2_gap.col) &&
    board[p2_gap.row]?.[p2_gap.col] === null &&
    isValidPosition(p2_second.row, p2_second.col) &&
    board[p2_second.row]?.[p2_second.col] === color &&
    isValidPosition(p2_third.row, p2_third.col) &&
    board[p2_third.row]?.[p2_third.col] === color &&
    isValidPosition(p2_after.row, p2_after.col) &&
    board[p2_after.row]?.[p2_after.col] === null
  ) {
    // 防御位置: 間の空きマスと両端（どれが最善かは探索で決める）
    positions.push(p2_gap, p2_before, p2_after);
  }

  return positions;
}

/** 単発四ペナルティ倍率（30%に減額） */
const SINGLE_FOUR_PENALTY_MULTIPLIER = 0.3;

/**
 * 四を置いた後に後続脅威があるかチェック
 *
 * @param board 盤面（四を置いた状態）
 * @param row 四を置いた行
 * @param col 四を置いた列
 * @param color 石の色
 * @returns 後続脅威があればtrue
 */
function hasFollowUpThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const opponentColor = color === "black" ? "white" : "black";

  // 四の防御位置を見つける
  // 各方向で四を形成しているかチェック
  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 四を形成している場合
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      // 防御位置を取得
      const defensePositions: { row: number; col: number }[] = [];

      // 正方向の端
      let r = row + dr;
      let c = col + dc;
      while (isValidPosition(r, c) && board[r]?.[c] === color) {
        r += dr;
        c += dc;
      }
      if (isValidPosition(r, c) && board[r]?.[c] === null) {
        defensePositions.push({ row: r, col: c });
      }

      // 負方向の端
      r = row - dr;
      c = col - dc;
      while (isValidPosition(r, c) && board[r]?.[c] === color) {
        r -= dr;
        c -= dc;
      }
      if (isValidPosition(r, c) && board[r]?.[c] === null) {
        defensePositions.push({ row: r, col: c });
      }

      // 各防御位置について、相手が防御した後も脅威があるかチェック
      for (const defensePos of defensePositions) {
        // 相手が防御した盤面を作成
        const defendedBoard = copyBoard(board);
        const defendedRow = defendedBoard[defensePos.row];
        if (defendedRow) {
          defendedRow[defensePos.col] = opponentColor;
        }

        // 防御後、自分が四または活三を作れる位置があるかチェック
        // 防御位置の周囲を探索
        for (let searchDr = -1; searchDr <= 1; searchDr++) {
          for (let searchDc = -1; searchDc <= 1; searchDc++) {
            if (searchDr === 0 && searchDc === 0) {
              continue;
            }
            const newRow = defensePos.row + searchDr;
            const newCol = defensePos.col + searchDc;

            if (!isValidPosition(newRow, newCol)) {
              continue;
            }
            if (defendedBoard[newRow]?.[newCol] !== null) {
              continue;
            }

            // この位置で四または活三を作れるかチェック
            const testBoard = copyBoard(defendedBoard);
            const testRow = testBoard[newRow];
            if (testRow) {
              testRow[newCol] = color;
            }

            const jumpResult = analyzeJumpPatterns(
              testBoard,
              newRow,
              newCol,
              color,
            );

            // 四または活三を作れる
            if (jumpResult.hasFour || jumpResult.hasValidOpenThree) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * 跳びパターンからスコアを計算
 *
 * @param jumpResult 跳びパターンの分析結果
 * @returns スコア
 */
function getJumpPatternScore(jumpResult: JumpPatternResult): number {
  let score = 0;

  // 跳び四のスコア（連続四はanalyzeDirectionでカウント済みなので、跳び四のみ）
  // 跳び四は止め四と同等のスコア（FOURスコア）
  score += jumpResult.jumpFourCount * PATTERN_SCORES.FOUR;

  // 有効な活跳び三のスコア（hasValidOpenThreeは連続三・跳び三両方を含むが、
  // 連続三のスコアはanalyzeDirectionでカウント済みなので、跳び三のみ追加）
  if (jumpResult.hasJumpThree && jumpResult.hasValidOpenThree) {
    score += PATTERN_SCORES.OPEN_THREE;
  }

  return score;
}

/**
 * 指定位置の石について全方向のパターンスコアを計算
 * 連続パターンと跳びパターンの両方を評価
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @returns 全方向のスコア合計
 */
export function evaluateStonePatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  let score = 0;

  // 連続パターンのスコア
  // DIRECTIONSのインデックス: 0=横, 1=縦, 2=右下斜め, 3=右上斜め
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    let dirScore = getPatternScore(pattern);

    // 斜め方向（インデックス2,3）にボーナスを適用
    if ((i === 2 || i === 3) && dirScore > 0) {
      dirScore *= PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER;
    }

    score += dirScore;
  }

  // 跳びパターンのスコア
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  score += getJumpPatternScore(jumpResult);

  return score;
}

/**
 * 指定位置に石を置いた場合の評価スコアを計算
 *
 * @param board 現在の盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @param options 評価オプション（省略時はデフォルト=高速モード）
 * @returns 評価スコア
 */
export function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  options: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
): number {
  if (color === null) {
    return 0;
  }

  // 五連チェック（最優先）
  if (checkFive(board, row, col, color)) {
    return PATTERN_SCORES.FIVE;
  }

  // 仮想的に石を置いた盤面でパターンを評価
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 白の三三・四四チェック（白には禁手がないため即勝利）
  if (color === "white" && checkWhiteWinningPattern(testBoard, row, col)) {
    return PATTERN_SCORES.FIVE;
  }

  // 攻撃スコア: 自分のパターン
  const attackScore = evaluateStonePatterns(testBoard, row, col, color);

  // 四三ボーナス: 四と有効な活三を同時に作る手
  const jumpResult = analyzeJumpPatterns(testBoard, row, col, color);
  let fourThreeBonus = 0;
  if (jumpResult.hasFour && jumpResult.hasValidOpenThree) {
    fourThreeBonus = PATTERN_SCORES.FOUR_THREE_BONUS;
  }

  // 必須防御ルール: 相手の活四・活三を止めない手は除外
  if (options.enableMandatoryDefense) {
    const opponentColor = color === "black" ? "white" : "black";
    // 事前計算された脅威情報があればそれを使用（最適化）
    const threats =
      options.precomputedThreats ?? detectOpponentThreats(board, opponentColor);

    // 自分が先に勝てるかチェック（活四、四三、またはフクミ手）
    const canWinFirst =
      attackScore >= PATTERN_SCORES.OPEN_FOUR ||
      fourThreeBonus > 0 ||
      (options.enableFukumi && isFukumiMove(testBoard, color));

    // 相手の活四を止めない手は除外
    if (threats.openFours.length > 0 && !canWinFirst) {
      const isDefendingOpenFour = threats.openFours.some(
        (p) => p.row === row && p.col === col,
      );
      if (!isDefendingOpenFour) {
        return -Infinity;
      }
    }

    // 相手の活三を止めない手は除外（活四がある場合は活四優先）
    if (
      threats.openThrees.length > 0 &&
      threats.openFours.length === 0 &&
      !canWinFirst
    ) {
      const isDefendingOpenThree = threats.openThrees.some(
        (p) => p.row === row && p.col === col,
      );
      if (!isDefendingOpenThree) {
        return -Infinity;
      }
    }
  }

  // 禁手追い込みボーナス（白番のみ、オプションで有効時のみ）
  let forbiddenTrapBonus = 0;
  if (options.enableForbiddenTrap && color === "white") {
    forbiddenTrapBonus = evaluateForbiddenTrap(testBoard, row, col);
  }

  // ミセ手ボーナス: 次に四三を作れる手（オプションで有効時のみ）
  let miseBonus = 0;
  if (options.enableMise && isMiseMove(testBoard, row, col, color)) {
    miseBonus = PATTERN_SCORES.MISE_BONUS;
  }

  // フクミ手ボーナス: 次にVCF（四追い勝ち）がある手（オプションで有効時のみ）
  // 計算コストが高いので、既に高スコアの場合はスキップ
  let fukumiBonus = 0;
  if (
    options.enableFukumi &&
    attackScore < PATTERN_SCORES.OPEN_FOUR &&
    isFukumiMove(testBoard, color)
  ) {
    fukumiBonus = PATTERN_SCORES.FUKUMI_BONUS;
  }

  // 複数方向脅威ボーナス: 2方向以上で脅威を作る手（オプションで有効時のみ）
  let multiThreatBonus = 0;
  if (options.enableMultiThreat) {
    const threatCount = countThreatDirections(testBoard, row, col, color);
    multiThreatBonus = evaluateMultiThreat(threatCount);
  }

  // VCTボーナス: 三・四連続勝ちがある手（オプションで有効時のみ、終盤のみ）
  // 計算コストが高いので、既にOPEN_FOUR以上の手はスキップ
  let vctBonus = 0;
  if (
    options.enableVCT &&
    attackScore < PATTERN_SCORES.OPEN_FOUR &&
    countStones(board) >= VCT_STONE_THRESHOLD &&
    hasVCT(testBoard, color)
  ) {
    vctBonus = PATTERN_SCORES.VCT_BONUS;
  }

  // 単発四ペナルティ: 四を作るが四三ではなく、後続脅威もない場合
  let singleFourPenalty = 0;
  if (options.enableSingleFourPenalty) {
    // 四を作るが四三ではない場合
    if (jumpResult.hasFour && !jumpResult.hasValidOpenThree) {
      // 後続脅威がない場合のみペナルティ
      if (!hasFollowUpThreat(testBoard, row, col, color)) {
        // FOURスコアにペナルティ適用（30%に減額 = 70%減）
        const fourCount =
          jumpResult.jumpFourCount > 0 ? jumpResult.jumpFourCount : 1;
        singleFourPenalty =
          PATTERN_SCORES.FOUR *
          fourCount *
          (1 - SINGLE_FOUR_PENALTY_MULTIPLIER);
      }
    }
  }

  // 防御スコア: 相手の脅威をブロック
  const opponentColor = color === "black" ? "white" : "black";
  let defenseScore = 0;

  // この位置に相手が置いた場合のスコアを計算（ブロック価値）
  const opponentTestBoard = copyBoard(board);
  const opponentTestRow = opponentTestBoard[row];
  if (opponentTestRow) {
    opponentTestRow[col] = opponentColor;
  }
  const opponentPatternScore = evaluateStonePatterns(
    opponentTestBoard,
    row,
    col,
    opponentColor,
  );

  // 相手の活三・活四をブロックする手は高評価
  // ブロック価値は相手のスコアの50%
  defenseScore = opponentPatternScore * 0.5;

  // カウンターフォー: 防御しながら四を作る手（オプションで有効時のみ）
  // 自分が四以上を作り、相手が活三以上を持っていた場合、防御スコアを1.5倍
  if (options.enableCounterFour) {
    if (
      attackScore >= PATTERN_SCORES.FOUR &&
      opponentPatternScore >= PATTERN_SCORES.OPEN_THREE
    ) {
      defenseScore *= PATTERN_SCORES.COUNTER_FOUR_MULTIPLIER;
    }
  }

  // 中央ボーナスを追加
  const centerBonus = getCenterBonus(row, col);

  return (
    attackScore +
    defenseScore +
    centerBonus +
    fourThreeBonus +
    forbiddenTrapBonus +
    miseBonus +
    fukumiBonus +
    multiThreatBonus +
    vctBonus -
    singleFourPenalty
  );
}

/**
 * 盤面全体の評価スコアを計算
 *
 * @param board 盤面
 * @param perspective 評価する視点（黒/白）
 * @returns 評価スコア（正:perspective有利、負:相手有利）
 */
export function evaluateBoard(
  board: BoardState,
  perspective: "black" | "white",
): number {
  const opponentColor = perspective === "black" ? "white" : "black";
  let myScore = 0;
  let opponentScore = 0;

  // 全ての石について評価
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }

      const patternScore = evaluateStonePatterns(board, row, col, stone);

      if (stone === perspective) {
        myScore += patternScore;
      } else if (stone === opponentColor) {
        opponentScore += patternScore;
      }
    }
  }

  return myScore - opponentScore;
}
