/**
 * 詰み木（`ForcedWinNode`）の構造的な不変条件を検査するテスト用ユーティリティ
 *
 * issue #115（長連にしかならない跳び四で受けを 1 点に絞っていた）のように、
 * 「脅威の分類」と「受け点の列挙」の基準がずれると、探索木には
 * *受けの強制の仕方が攻め手の実力と釣り合わないノード* が現れる。
 * 手順そのものを固定するのではなく、その釣り合いを不変条件として検査する。
 *
 * ## 検査する不変条件
 *
 * 1. **四でない**攻め手が受けを 1 点に強制しているとき、その 1 点は
 *    **攻め手側の長連点であってはならない**。
 *    受けが 1 点になるのは「四の五点を止める」場合であり、埋めると 6 連になる点は
 *    そもそも五点ではないので、そこを唯一の受けとして強制するのは
 *    分類（`classifyThreat` は長連補正済み）と食い違う＝ issue #115 の不整合。
 * 2. 受けが 0 点（＝防御不可・終端）の攻め手ノードは五か達四でなければならない
 *    （zig/src/vct.zig `hasVCT` の「防御不可 → 脅威が成立していれば勝ち」に対応）。
 *
 * ## 適用範囲の注意
 *
 * - **四の攻め手を 1. の対象から外しているのは意図的**である。四なのに受けが
 *   長連点になる別系統の不具合（VCF 経路の `quiescence.getFourDefensePosition` が
 *   `threats.findJumpGapPosition` の返す最初のギャップを検証せずに使う）が
 *   **未修正で残っており（issue #121）**、この局面にも実在する:
 *   `21.K7 22.M7 23.N8 24.O8 25.J8` で 8 行目は `G8 H8 _ J8 K8 L8 _ N8`。
 *   J8 は M8 側の跳び四なので四であること自体は正しいが、受けとして I8
 *   （埋めると G8..L8 の 6 連）が強制されている。#121 の修正は VCF 全体に
 *   影響するため本 issue のスコープ外とし、ここでは #115 の系統だけを検査する。
 * - **「受けが 1 点 ⇒ 四」という、より強い不変条件は成り立たない。**
 *   `findVCTSequenceRecursive` は、受け手自身がカウンター脅威を作る場合
 *   （`checkDefenseCounterThreat` が win/four/three）を VCF 経路で処理し、
 *   その受けを木の `defenses` に記録しない。つまり記録された受けは
 *   `getThreatDefensePositions` の結果の**部分集合**であり、三の攻め手でも
 *   記録上 1 点だけになりうる。だから 1. は「長連点でない」に限定してある。
 * - 守り手が黒の場合、受け点から黒の禁手が除外されるため受けはさらに減る。
 *   長連点の判定も攻め手＝黒を前提にしているので、この検査は
 *   **攻め手が黒（＝守り手が白）の木でのみ有効**であり、ヘルパー側で assert する。
 * - 四の判定に `createsFour`（wasm の `vct.classifyThreat`）を使うため、この検査は
 *   ある意味で自己参照的である。**真のアンカーは座標を明示した Zig 単体テスト**
 *   （`zig/src/vct.zig` の issue #115 テスト）で、こちらは探索木全体への波及を
 *   広く押さえる補助と位置づける。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinNode } from "@/types/review";

import { formatMove } from "@/logic/gameRecordParser";
import { checkFive } from "@/logic/renjuRules/core";

import { createsFour } from "../wasm/threatAdapter";

const BOARD_SIZE = 15;
const OVERLINE_LENGTH = 6;
const DIRECTIONS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** 石の色（`StoneColor` は空点を表す null を含むため、ここでは実色のみを扱う） */
type PlayerColor = "black" | "white";

function setStone(
  board: BoardState,
  pos: Position,
  color: PlayerColor | null,
): void {
  const row = board[pos.row];
  if (row) {
    row[pos.col] = color;
  }
}

function countRun(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: PlayerColor,
): number {
  let count = 0;
  for (let step = 1; step < OVERLINE_LENGTH + 1; step++) {
    const r = row + dr * step;
    const c = col + dc * step;
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      break;
    }
    if (board[r]?.[c] !== color) {
      break;
    }
    count++;
  }
  return count;
}

/** color がそこに打つと 6 連以上（長連）になる空点かどうか */
function isOverlinePoint(
  board: BoardState,
  pos: Position,
  color: PlayerColor,
): boolean {
  return DIRECTIONS.some(([dr, dc]) => {
    const forward = countRun(board, pos.row, pos.col, dr ?? 0, dc ?? 0, color);
    const backward = countRun(
      board,
      pos.row,
      pos.col,
      -(dr ?? 0),
      -(dc ?? 0),
      color,
    );
    return 1 + forward + backward >= OVERLINE_LENGTH;
  });
}

/** color がそこに打つと五になる空点の数（黒の長連点は checkFive が偽なので数えない） */
function countFivePoints(board: BoardState, color: PlayerColor): number {
  let count = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const boardRow = board[row];
      if (!boardRow || boardRow[col]) {
        continue;
      }
      boardRow[col] = color;
      const isFive = checkFive(board, row, col, color);
      boardRow[col] = null;
      if (isFive) {
        count++;
      }
    }
  }
  return count;
}

function walk(
  node: ForcedWinNode | undefined,
  board: BoardState,
  attacker: PlayerColor,
  ply: number,
  path: string[],
  out: string[],
): void {
  if (!node) {
    return;
  }
  const move = node.attackerMove;
  setStone(board, move, attacker);
  const line = [...path, `${ply}.${formatMove(move)}`];

  if (node.defenses.length === 1) {
    const [defense] = node.defenses;
    if (
      defense &&
      !createsFour(board, move.row, move.col, attacker) &&
      isOverlinePoint(board, defense.defenderMove, attacker)
    ) {
      out.push(
        `${line.join(" ")}: 四でないのに受けが ${formatMove(defense.defenderMove)} の1点に強制されている（そこは攻め手の長連点で五にできない）`,
      );
    }
  } else if (node.defenses.length === 0) {
    // 終端＝防御不可。五そのものか、五点が 2 つ以上ある達四のはず。
    const isFive = checkFive(board, move.row, move.col, attacker);
    if (!isFive && countFivePoints(board, attacker) < 2) {
      out.push(`${line.join(" ")}: 終端（防御不可）なのに五でも達四でもない`);
    }
  }

  const defender: PlayerColor = attacker === "black" ? "white" : "black";
  for (const defense of node.defenses) {
    setStone(board, defense.defenderMove, defender);
    walk(
      defense.next,
      board,
      attacker,
      ply + 2,
      [...line, `${ply + 1}.${formatMove(defense.defenderMove)}`],
      out,
    );
    setStone(board, defense.defenderMove, null);
  }

  setStone(board, move, null);
}

/**
 * 詰み木を全経路たどり、上記の不変条件に違反するノードの説明文を集める。
 *
 * @param root 詰み木の根（`undefined` なら空配列＝検査対象なしで通る）
 * @param board 根の局面の盤面（走査中に一時的に石を置くが、戻り時に復元する）
 * @param attacker 攻め手の色。**黒のみ許可**（上記「適用範囲の注意」参照）
 * @param rootPly 根の攻め手の手数（表示用）
 * @returns 違反の説明文の配列。空なら不変条件を満たす
 */
export function collectForcedWinTreeViolations(
  root: ForcedWinNode | undefined,
  board: BoardState,
  attacker: PlayerColor,
  rootPly: number,
): string[] {
  if (attacker !== "black") {
    throw new Error(
      "collectForcedWinTreeViolations は攻め手が黒の木でのみ有効（長連点の判定と禁手フィルタの前提が崩れるため）",
    );
  }
  const violations: string[] = [];
  walk(root, board, attacker, rootPly, [], violations);
  return violations;
}
