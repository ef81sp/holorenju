/**
 * VCT探索のヘルパー関数
 *
 * VCT探索で使用する脅威検出・防御位置取得の非再帰ヘルパー群。
 *
 * 禁止: vct からのインポート
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkFive } from "@/logic/renjuRules";

import type { DirectionPattern } from "../evaluation/patternScores";
import type { LineTable } from "../lineTable/lineTable";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "../evaluation/directionAnalysis";
import {
  isValidConsecutiveThree,
  isValidJumpThree,
} from "../evaluation/jumpPatterns";
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";
import { createsFourThree } from "../evaluation/winningPatterns";
import { LINE_BIT_TO_CELL, LINE_LENGTHS } from "../lineTable/lineMapping";
import { isNearExistingStone } from "../moveGenerator";
import { getJumpThreeDefensePositions } from "../patterns/threatAnalysis";
// #43 PR-3: 葉プリミティブ（図形/禁手判定）を Zig アダプタへ委譲。TS オーケストレーション
// （本ファイルの VCT 検証ロジック）は温存し、patterns.ts/forbiddenMoves.ts への依存を断つ。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
import { checkJumpThree } from "../wasm/patternsAdapter";
import { classifyThreat, isFourInDirection } from "./threatMoves";

/**
 * 連続活三（本物の四の一部でない）かを判定するヘルパー
 *
 * hasOpenThree と getCreatedOpenThreeDefenses で共通使用。
 *
 * issue #121: 除外条件に `checkJumpFour` をそのまま使うと、窓（中心 ±4）の外の自石で
 * ギャップ埋めが長連になる黒の形まで四扱いされ、三の検出が握り潰されていた。
 * 四かどうかは盤面の五点を見る `isFourInDirection` に委ねる。
 * ただし偽の四が外れた分「四でも三でもない」形が活三として流入するので、
 * 黒のウソの三（達四にできない三）も併せて除外する。
 * Zig `vct.hasOpenThree` / `threats.detectThreatsCore` と同じガード。
 *
 * @param i DIRECTIONS / DIRECTION_INDICES のインデックス（0..3）
 */
function isConsecutiveOpenThree(
  board: BoardState,
  row: number,
  col: number,
  i: number,
  color: "black" | "white",
  pattern: DirectionPattern,
): boolean {
  const dirIndex = DIRECTION_INDICES[i];
  return (
    pattern.count === 3 &&
    pattern.end1 === "empty" &&
    pattern.end2 === "empty" &&
    !isFourInDirection(board, row, col, i, color, pattern.count) &&
    (color !== "black" ||
      (dirIndex !== undefined &&
        isValidConsecutiveThree(board, row, col, dirIndex, color)))
  );
}

/**
 * 指定色がミセ手（1手で四三を作れる手）を持っているかチェック
 *
 * ミセ手は活三より強い反撃脅威（四三は止められない）であり、
 * 活三と同様にVCTの三脅威を無効化する。
 *
 * @param board 盤面
 * @param color チェック対象の色
 * @returns ミセ手があればtrue
 */
export function hasFourThreeAvailable(
  board: BoardState,
  color: "black" | "white",
): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }
      if (color === "black" && isForbiddenForBlack(board, row, col)) {
        continue;
      }
      if (createsFourThree(board, row, col, color)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 指定色が活三（連続三で両端空き）を持っているかチェック
 *
 * 活三を持つ相手がいる場合、相手は三を無視して四を打てるため、
 * VCT（三を含む脅威連続）は成立しない。VCF（四追い）のみが有効。
 *
 * ⚠️ **本番経路は Zig（`wasm/threatAdapter.hasOpenThree`）**。
 * `vctValidation` / `forcedLossCheck` はいずれも wasm 版を import しており、
 * 本関数は振り返り用 TS ヘルパ（`search/index.ts` 再 export）とテストからのみ使う。
 *
 * issue #121: LineTable ビットマスク版（`hasOpenThreeFast`）は削除した。
 * 長連ガードをビットマスク上で再実装すると「五」の定義が 3 個目になる一方、
 * board 版にだけガードを入れると同一エクスポートが第 3 引数の有無で違う答えを返す。
 * live な呼び出し元がゼロだったので分岐ごと落とした（#43 の物理削除の流れ）。
 *
 * @param board 盤面
 * @param color チェック対象の色
 * @returns 活三があればtrue
 */
export function hasOpenThree(
  board: BoardState,
  color: "black" | "white",
): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== color) {
        continue;
      }
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
        // 連続活三（本物の四の一部である連続三は活三ではない）
        if (isConsecutiveOpenThree(board, row, col, i, color, pattern)) {
          return true;
        }
        // 跳び三（○○_○ や ○_○○）。黒はウソの三を除外
        if (
          pattern.count !== 3 &&
          checkJumpThree(board, row, col, dirIndex, color) &&
          (color !== "black" ||
            isValidJumpThree(board, row, col, dirIndex, color))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

/**
 * 脅威（四・活三）を作れる位置を列挙
 * 四を優先的に列挙（枝刈り効率のため）
 *
 * lineTable が渡された場合、5セルウィンドウスキャンで候補をフィルタして高速化。
 */
export function findThreatMoves(
  board: BoardState,
  color: "black" | "white",
  lineTable?: LineTable,
): Position[] {
  if (lineTable) {
    return findThreatMovesFast(board, color, lineTable);
  }
  const fourMoves: Position[] = [];
  const openThreeMoves: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 行配列を取得
      const rowArray = board[row];

      // インプレースで石を置いて五連・四・活三を一括チェック
      if (rowArray) {
        rowArray[col] = color;
      }

      // 五連が作れる場合は最優先（禁手でもOK）
      if (checkFive(board, row, col, color)) {
        if (rowArray) {
          rowArray[col] = null;
        }
        fourMoves.push({ row, col });
        continue;
      }

      // 四と活三を1パスで判定
      const threat = classifyThreat(board, row, col, color);

      // 元に戻す（Undo）
      if (rowArray) {
        rowArray[col] = null;
      }

      if (!threat.createsFour && !threat.createsOpenThree) {
        continue;
      }

      // 禁手チェックは脅威を作る手だけに限定
      if (color === "black" && isForbiddenForBlack(board, row, col)) {
        continue;
      }

      if (threat.createsFour) {
        fourMoves.push({ row, col });
      } else {
        openThreeMoves.push({ row, col });
      }
    }
  }

  // 四を優先して返す
  return [...fourMoves, ...openThreeMoves];
}

/** 候補セルフラグバッファ（非リエントラント、モジュールスコープで再利用） */
const _candidates = new Uint8Array(225);

/**
 * LineTable の5セルウィンドウスキャンで候補セルを特定し、classifyThreat を適用する高速版
 *
 * 72ラインの5セルウィンドウを走査し、相手石がなく自石2個以上のウィンドウ内の
 * 空セルを候補としてフラグ。連続パターン（○○○_）と跳びパターン（○_○○）の両方を検出。
 * 候補セルのみに classifyThreat を適用することで走査数を ~40 → ~10-20 に削減。
 *
 * 非リエントラント安全性: 返却時にローカル Position[] を構築済みのため、
 * VCT再帰で再呼び出しされてもバッファ競合なし。
 */
function findThreatMovesFast(
  board: BoardState,
  color: "black" | "white",
  lt: LineTable,
): Position[] {
  const ownArr = color === "black" ? lt.blacks : lt.whites;
  const oppArr = color === "black" ? lt.whites : lt.blacks;

  // 5セルウィンドウスキャンで候補セルをフラグ
  _candidates.fill(0);
  for (let lineId = 0; lineId < 72; lineId++) {
    const own = ownArr[lineId] ?? 0;
    if (!own) {
      continue;
    }
    // 2石未満のラインはスキップ（四: 3石+仮置き, 活三: 2石+仮置き）
    if (!(own & (own - 1))) {
      continue;
    }

    const opp = oppArr[lineId] ?? 0;
    const len = LINE_LENGTHS[lineId] ?? 0;

    for (let start = 0; start <= len - 5; start++) {
      const windowMask = 0x1f << start;
      // 相手石があるウィンドウはスキップ
      if (opp & windowMask) {
        continue;
      }
      // 自石2個未満のウィンドウはスキップ
      const windowOwn = own & windowMask;
      if (!(windowOwn & (windowOwn - 1))) {
        continue;
      }

      // ウィンドウ内の空セルを候補に追加
      const emptyInWindow = ~(own | opp) & windowMask;
      let eBits = emptyInWindow;
      while (eBits) {
        const bp = 31 - Math.clz32(eBits & -eBits);
        eBits &= eBits - 1;
        const ci = LINE_BIT_TO_CELL[lineId * 16 + bp];
        if (ci !== undefined && ci !== 0xffff) {
          _candidates[ci] = 1;
        }
      }
    }
  }

  // 候補セルのみに classifyThreat を適用
  const fourMoves: Position[] = [];
  const openThreeMoves: Position[] = [];
  for (let i = 0; i < 225; i++) {
    if (!_candidates[i]) {
      continue;
    }
    const row = Math.floor(i / 15);
    const col = i % 15;
    if (board[row]?.[col] !== null) {
      continue;
    }

    const rowArray = board[row];
    if (rowArray) {
      rowArray[col] = color;
    }

    // 五連が作れる場合は最優先（禁手でもOK）
    if (checkFive(board, row, col, color)) {
      if (rowArray) {
        rowArray[col] = null;
      }
      fourMoves.push({ row, col });
      continue;
    }

    const threat = classifyThreat(board, row, col, color);
    if (rowArray) {
      rowArray[col] = null;
    }

    if (!threat.createsFour && !threat.createsOpenThree) {
      continue;
    }

    // 禁手チェックは脅威を作る手だけに限定
    if (color === "black" && isForbiddenForBlack(board, row, col)) {
      continue;
    }

    if (threat.createsFour) {
      fourMoves.push({ row, col });
    } else {
      openThreeMoves.push({ row, col });
    }
  }
  fourMoves.push(...openThreeMoves);
  return fourMoves;
}

/* eslint-enable no-bitwise */

// issue #130 / #43: TS 版 `isThreat` は削除した。Zig 側の `vct.isThreat` は
// `getThreatDefensePositions` の `len == 0` を切り分けるガード専用で、
// 戻り値の 3 値化（`ThreatDefense`）に吸収されて呼び出し元がゼロになった。
// TS 側も参照ゼロだったため、二重実装を残さないよう同時に削除する。
// 脅威の有無が要るなら `threatMoves.classifyThreat` を直接使うこと。

// issue #121 / #43: TS 版 `getThreatDefensePositions` は削除した。
// 本番経路は Zig の `vct.getThreatDefensePositions`（`threats.collectLineFivePoints` が
// 受け点の SSoT）のみで、TS 版は import 元ゼロの `@internal` テスト用エクスポートだった。
// しかも #115（跳び四の長連ギャップを受けにしない）も #124（受け点を五点列挙に一本化）も
// 未反映の旧基準のままで、残すと「正しい TS 実装がある」という誤解を生むため物理削除する。

/**
 * 指定位置に石を置いた際に作られた活三/飛び三の防御位置を返す
 *
 * Mise-VCFのノリ手検証で使用。ミセ手は必ず三に含まれるため、
 * 4方向チェックで十分（全盤面スキャン不要）。
 */
export function getCreatedOpenThreeDefenses(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const defenses: Position[] = [];
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
    // 連続活三（本物の四の一部・黒のウソの三はどちらも isConsecutiveOpenThree が除外）
    if (isConsecutiveOpenThree(board, row, col, i, color, pattern)) {
      defenses.push(
        ...getOpenThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
    // 飛び三（黒の場合はウソの三を除外）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color) &&
      (color !== "black" || isValidJumpThree(board, row, col, dirIndex))
    ) {
      defenses.push(
        ...getJumpThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
  }
  // 重複除去 + 空きマスのみ
  const unique = new Map<string, Position>();
  for (const pos of defenses) {
    if (board[pos.row]?.[pos.col] !== null) {
      continue;
    }
    const key = `${pos.row},${pos.col}`;
    if (!unique.has(key)) {
      unique.set(key, pos);
    }
  }
  return Array.from(unique.values());
}
