/**
 * 連珠の開局（珠型）ロジック
 *
 * 連珠では最初の3手に定型パターン（珠型）があり、
 * 黒は1手目に天元、3手目に定められた26種類のパターンから選択する。
 * 白は2手目に天元の周囲8マスのいずれかに置く。
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE, TENGEN } from "@/constants";

import { countStones, selectRandom } from "./core/boardUtils";

// TENGENをre-exportして後方互換性を維持
export { TENGEN } from "@/constants";

/**
 * 2手目の方向タイプ
 * - diagonal: 斜め（直打ち）
 * - orthogonal: 縦横（間打ち）
 */
type SecondMoveType = "diagonal" | "orthogonal";

/**
 * 2手目の候補位置（天元からのオフセット）
 * 8方向すべてをカバー
 */
const SECOND_MOVE_OFFSETS: { dr: number; dc: number; type: SecondMoveType }[] =
  [
    // 斜め（直打ち）
    { dr: -1, dc: -1, type: "diagonal" },
    { dr: -1, dc: 1, type: "diagonal" },
    { dr: 1, dc: -1, type: "diagonal" },
    { dr: 1, dc: 1, type: "diagonal" },
    // 縦横（間打ち）
    { dr: -1, dc: 0, type: "orthogonal" },
    { dr: 1, dc: 0, type: "orthogonal" },
    { dr: 0, dc: -1, type: "orthogonal" },
    { dr: 0, dc: 1, type: "orthogonal" },
  ];

/**
 * 珠型パターン定義
 *
 * 各珠型は天元(7,7)と白の位置を基準にした、黒3手目の相対座標で定義。
 * 座標は白が(8,8)（右下斜め）に置いた場合を基準として記述し、
 * 実際の白の位置に応じて回転・反転して使用する。
 *
 * 参考: 連珠の26珠型（直打ち13種 + 間打ち13種）
 */

/**
 * 直打ち（斜め）の珠型パターン
 * 白が天元の斜め（例: 8,8）に置いた場合の黒3手目候補
 * 座標は天元(0,0)を基準とした相対座標
 */
interface JushuPattern {
  name: string;
  /** 天元からの相対座標 (dr, dc) */
  offset: { dr: number; dc: number };
}

/**
 * 直打ち（斜め）の珠型
 * 白が右下(+1,+1)に置いた場合を基準
 */
const DIAGONAL_PATTERNS: JushuPattern[] = [
  // 寒星: 白と反対側の斜め
  { name: "寒星", offset: { dr: -1, dc: -1 } },
  // 花月: 天元から縦方向
  { name: "花月", offset: { dr: -1, dc: 0 } },
  // 雨月: 天元から縦方向遠め
  { name: "雨月", offset: { dr: -2, dc: 0 } },
  // 金星: 天元から斜め遠め
  { name: "金星", offset: { dr: -2, dc: -1 } },
  // 松月: 白と反対側の斜め遠め
  { name: "松月", offset: { dr: -2, dc: -2 } },
  // 丘月: 天元から横方向
  { name: "丘月", offset: { dr: 0, dc: -1 } },
  // 新月: 天元から横方向遠め
  { name: "新月", offset: { dr: 0, dc: -2 } },
  // 瑞星: 天元から縦方向（白側）
  { name: "瑞星", offset: { dr: 1, dc: 0 } },
  // 山月: 天元から縦方向遠め（白側）
  { name: "山月", offset: { dr: 2, dc: 0 } },
  // 遊星: 白と同じ斜め方向
  { name: "遊星", offset: { dr: 1, dc: 1 } },
  // 彗星: 白と同じ斜め方向遠め
  { name: "彗星", offset: { dr: 2, dc: 2 } },
  // 残月: 天元から横方向（白側）
  { name: "残月", offset: { dr: 0, dc: 1 } },
  // 明星: 天元から横方向遠め（白側）
  { name: "明星", offset: { dr: 0, dc: 2 } },
];

/**
 * 間打ち（縦横）の珠型
 * 白が下(+1,0)に置いた場合を基準
 */
const ORTHOGONAL_PATTERNS: JushuPattern[] = [
  // 瑞星: 白と反対側
  { name: "瑞星", offset: { dr: -1, dc: 0 } },
  // 山月: 白と反対側遠め
  { name: "山月", offset: { dr: -2, dc: 0 } },
  // 溪月: 斜め方向
  { name: "溪月", offset: { dr: -1, dc: -1 } },
  // 寒星: 斜め方向遠め
  { name: "寒星", offset: { dr: -2, dc: -2 } },
  // 水月: 横方向
  { name: "水月", offset: { dr: 0, dc: -1 } },
  // 流星: 横方向遠め
  { name: "流星", offset: { dr: 0, dc: -2 } },
  // 雲月: 斜め方向（白側の縦と横の間）
  { name: "雲月", offset: { dr: 1, dc: -1 } },
  // 浦月: 横方向（白と反対の縦軸側）
  { name: "浦月", offset: { dr: -1, dc: 1 } },
  // 峡月: 斜め方向遠め（白と反対側寄り）
  { name: "峡月", offset: { dr: -2, dc: 1 } },
  // 岩月: 白と同じ方向
  { name: "岩月", offset: { dr: 1, dc: 0 } },
  // 銀月: 白と同じ方向遠め
  { name: "銀月", offset: { dr: 2, dc: 0 } },
  // 名月: 斜め（白側）
  { name: "名月", offset: { dr: 1, dc: 1 } },
  // 恒星: 斜め遠め（白側）
  { name: "恒星", offset: { dr: 2, dc: 2 } },
];

/**
 * 開局フェーズかどうかを判定
 *
 * @param moveCount 現在の手数
 * @returns 開局フェーズ（1〜3手目）ならtrue
 */
export function isOpeningPhase(moveCount: number): boolean {
  return moveCount < 3;
}

/**
 * 天元に石があるかチェック
 */
function hasStoneatTengen(board: BoardState): boolean {
  return board[TENGEN.row]?.[TENGEN.col] !== null;
}

/**
 * 白の2手目の位置を取得
 * 天元の周囲8マスから白石を探す
 */
function findSecondMovePosition(
  board: BoardState,
): { position: Position; type: SecondMoveType } | null {
  for (const offset of SECOND_MOVE_OFFSETS) {
    const row = TENGEN.row + offset.dr;
    const col = TENGEN.col + offset.dc;
    if (board[row]?.[col] === "white") {
      return {
        position: { row, col },
        type: offset.type,
      };
    }
  }
  return null;
}

/**
 * 座標を回転・反転して実際の位置を計算
 *
 * @param baseOffset 基準となるオフセット（パターン定義）
 * @param whiteOffset 実際の白の位置のオフセット（天元からの相対座標）
 * @param type 2手目のタイプ（斜めか縦横か）
 * @returns 変換後の絶対座標
 */
function transformOffset(
  baseOffset: { dr: number; dc: number },
  whiteOffset: { dr: number; dc: number },
  type: SecondMoveType,
): Position {
  let dr = 0;
  let dc = 0;

  if (type === "diagonal") {
    // 斜めの場合: 白の位置に合わせて回転
    // 基準は白が(+1,+1)の場合
    // 実際の白の位置に応じて座標を変換

    // 符号を合わせる変換
    const signRow = whiteOffset.dr > 0 ? 1 : -1;
    const signCol = whiteOffset.dc > 0 ? 1 : -1;

    dr = baseOffset.dr * signRow;
    dc = baseOffset.dc * signCol;
  } else if (whiteOffset.dr === 0) {
    // 縦横の場合: 白の位置に合わせて回転
    // 基準は白が(+1,0)の場合
    // 横方向に白がある場合
    // 90度回転: (dr, dc) -> (dc, dr)
    const sign = whiteOffset.dc > 0 ? 1 : -1;
    dr = baseOffset.dc;
    dc = baseOffset.dr * sign;
  } else {
    // 縦方向に白がある場合
    const sign = whiteOffset.dr > 0 ? 1 : -1;
    dr = baseOffset.dr * sign;
    ({ dc } = baseOffset);
  }

  return {
    row: TENGEN.row + dr,
    col: TENGEN.col + dc,
  };
}

/**
 * 位置が盤面内かチェック
 */
function isValidPosition(pos: Position): boolean {
  return (
    pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE
  );
}

/**
 * 位置が空きマスかチェック
 */
function isEmpty(board: BoardState, pos: Position): boolean {
  return board[pos.row]?.[pos.col] === null;
}

/**
 * 開局の手を取得
 *
 * @param board 現在の盤面
 * @param color 手番の色
 * @returns 開局の手、または開局フェーズ外ならnull
 */
export function getOpeningMove(
  board: BoardState,
  color: "black" | "white",
): Position | null {
  const stoneCount = countStones(board);

  // 1手目（黒）: 天元に置く
  if (stoneCount === 0 && color === "black") {
    return { ...TENGEN };
  }

  // 2手目（白）: 天元の周囲8マスからランダムに選択
  if (stoneCount === 1 && color === "white") {
    if (!hasStoneatTengen(board)) {
      // 黒が天元以外に置いた場合は通常のCPU処理
      return null;
    }

    // 8方向からランダムに選択
    const validOffsets = SECOND_MOVE_OFFSETS.filter((offset) => {
      const row = TENGEN.row + offset.dr;
      const col = TENGEN.col + offset.dc;
      return isEmpty(board, { row, col });
    });

    const selected = selectRandom(validOffsets);
    if (!selected) {
      return null;
    }

    return {
      row: TENGEN.row + selected.dr,
      col: TENGEN.col + selected.dc,
    };
  }

  // 3手目（黒）: 珠型パターンからランダムに選択
  if (stoneCount === 2 && color === "black") {
    if (!hasStoneatTengen(board)) {
      // 黒が天元以外に置いた場合は通常のCPU処理
      return null;
    }

    const secondMove = findSecondMovePosition(board);
    if (!secondMove) {
      // 白が天元周囲以外に置いた場合は通常のCPU処理
      return null;
    }

    // 白の位置に応じたパターンを選択
    const patterns =
      secondMove.type === "diagonal" ? DIAGONAL_PATTERNS : ORTHOGONAL_PATTERNS;

    // 白の位置のオフセット
    const whiteOffset = {
      dr: secondMove.position.row - TENGEN.row,
      dc: secondMove.position.col - TENGEN.col,
    };

    // 有効なパターン（盤面内かつ空きマス）をフィルタリング
    const validPositions: Position[] = [];

    for (const pattern of patterns) {
      const pos = transformOffset(pattern.offset, whiteOffset, secondMove.type);
      if (isValidPosition(pos) && isEmpty(board, pos)) {
        validPositions.push(pos);
      }
    }

    // ランダムに選択
    return selectRandom(validPositions) ?? null;
  }

  // 4手目以降は通常のCPU処理
  return null;
}

/**
 * 開局パターンの情報を取得（デバッグ・表示用）
 *
 * @param board 現在の盤面
 * @returns 珠型の名前、またはnull
 */
export function getOpeningPatternInfo(
  board: BoardState,
): { name: string; type: SecondMoveType } | null {
  const stoneCount = countStones(board);

  if (stoneCount < 3) {
    return null;
  }

  // 天元の黒石をチェック
  if (board[TENGEN.row]?.[TENGEN.col] !== "black") {
    return null;
  }

  // 白の2手目を探す
  const secondMove = findSecondMovePosition(board);
  if (!secondMove) {
    return null;
  }

  // 黒の3手目を探す
  const patterns =
    secondMove.type === "diagonal" ? DIAGONAL_PATTERNS : ORTHOGONAL_PATTERNS;

  const whiteOffset = {
    dr: secondMove.position.row - TENGEN.row,
    dc: secondMove.position.col - TENGEN.col,
  };

  for (const pattern of patterns) {
    const pos = transformOffset(pattern.offset, whiteOffset, secondMove.type);
    if (isValidPosition(pos) && board[pos.row]?.[pos.col] === "black") {
      return { name: pattern.name, type: secondMove.type };
    }
  }

  return null;
}

/**
 * 珠型の評価値
 * 正の値は黒有利、負の値は白有利
 * 研究に基づく定石評価を参考に設定
 */
export const JUSHU_EVALUATION: Record<string, number> = {
  // 黒必勝
  花月: 500,
  浦月: 500,

  // 黒有利
  疎星: 300,
  流星: 300,
  金星: 250,
  松月: 250,

  // 黒やや有利
  溪月: 100,
  峡月: 100,
  雲月: 100,
  名月: 100,

  // 互角
  瑞星: 0,
  遊星: 0,
  彗星: 0,
  水月: 0,

  // 白やや有利
  山月: -100,
  岩月: -100,
  銀月: -100,

  // 白有利
  寒星: -200,
  残月: -200,
  明星: -200,
  雨月: -200,
  丘月: -200,
  新月: -200,
  恒星: -200,
};

/**
 * 開局評価ボーナスを取得
 *
 * @param board 盤面
 * @param color 評価する視点
 * @returns 評価ボーナス（黒視点で計算、白の場合は符号反転）
 */
export function getOpeningEvaluation(
  board: BoardState,
  color: "black" | "white",
): number {
  // 開局フェーズ外（3手未満 or 10手超）なら0
  const stoneCount = countStones(board);
  if (stoneCount < 3 || stoneCount > 10) {
    return 0;
  }

  // 珠型を判定
  const patternInfo = getOpeningPatternInfo(board);
  if (!patternInfo) {
    return 0;
  }

  const evaluation = JUSHU_EVALUATION[patternInfo.name] ?? 0;

  // 白視点なら符号反転
  return color === "black" ? evaluation : -evaluation;
}
