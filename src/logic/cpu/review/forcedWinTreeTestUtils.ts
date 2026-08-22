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
 * 1. 攻め手が受けを 1 点に強制しているとき、その 1 点は攻め手の強さと釣り合うこと。
 *    - 攻め手が**四**なら、その 1 点は「攻め手がそこに打つと本当に五になる点」でなければ
 *      ならない。四の受けは五点を塞ぐこと以外にありえないので、これは厳密に成り立つ。
 *      （`quiescence.getFourDefensePosition` 経路の長連ギャップ誤選択を押さえる）
 *    - 攻め手が**四でない**なら、その 1 点は少なくとも
 *      **攻め手の長連点であってはならない**。埋めると 6 連になる点は五点ではないので、
 *      それを唯一の受けとして強制するのは分類（`classifyThreat` は長連補正済み）との
 *      食い違いである。（`getThreatDefensePositions` 経路を押さえる）
 *      四のときより弱い条件にしているのは、記録された受けが部分集合になりうるため
 *      （下記「適用範囲の注意」）。
 * 2. 受けが 0 点（＝防御不可・終端）の攻め手ノードは五か達四でなければならない
 *    （zig/src/vct.zig `hasVCT` の「防御不可 → 脅威が成立していれば勝ち」に対応）。
 *
 * ## 適用範囲の注意
 *
 * - **「受けが 1 点 ⇒ 四」という、より強い不変条件は成り立たない。**
 *   `findVCTSequenceRecursive` は、受け手自身がカウンター脅威を作る場合
 *   （`checkDefenseCounterThreat` が win/four/three）を VCF 経路で処理し、
 *   その受けを木の `defenses` に記録しない。つまり記録された受けは
 *   `getThreatDefensePositions` の結果の**部分集合**であり、三の攻め手でも
 *   記録上 1 点だけになりうる。だから四でないときは「長連点でない」に限定してある。
 *   （実例: `21.K7 22.M7 23.N8 24.M8 25.M9` の M9 は活三で、受けは J6 と N10 の
 *   2 点あるが、N10 はカウンター脅威扱いで木に載らず J6 だけが記録される）
 * - 守り手が黒の場合、受け点から黒の禁手が除外されるため受けはさらに減る。
 *   長連点の判定も攻め手＝黒を前提にしているので、この検査は
 *   **攻め手が黒（＝守り手が白）の木でのみ有効**であり、ヘルパー側で assert する。
 * - 五の判定に `checkFive`（TS 側の連珠ルール実装）を使う。Zig/WASM の探索が
 *   返した木を **TS 側の独立した実装で**検算する形になっており、
 *   `createsFour`（wasm の `vct.classifyThreat`）に頼る自己参照を避けている。
 *   座標を明示した Zig 単体テストが一次のアンカーで、こちらは探索木全体への
 *   波及を広く押さえる補助という位置づけは変わらない。
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

/** color がそこに打つと五になる空点かどうか（黒の長連点は checkFive が偽） */
function isFivePointFor(
  board: BoardState,
  pos: Position,
  color: PlayerColor,
): boolean {
  const row = board[pos.row];
  if (!row || row[pos.col]) {
    return false;
  }
  row[pos.col] = color;
  const result = checkFive(board, pos.row, pos.col, color);
  row[pos.col] = null;
  return result;
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
    if (defense) {
      const isFour = createsFour(board, move.row, move.col, attacker);
      const defensePos = defense.defenderMove;
      if (isFour && !isFivePointFor(board, defensePos, attacker)) {
        out.push(
          `${line.join(" ")}: 四の受けが ${formatMove(defensePos)} の1点に強制されているが、そこは攻め手が打っても五にならない`,
        );
      } else if (!isFour && isOverlinePoint(board, defensePos, attacker)) {
        out.push(
          `${line.join(" ")}: 四でないのに受けが ${formatMove(defensePos)} の1点に強制されている（そこは攻め手の長連点で五にできない）`,
        );
      }
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
