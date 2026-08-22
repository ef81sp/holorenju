/**
 * VCT手順の事後検証
 *
 * 見つかった手順を盤面上でリプレイし、防御手がカウンターウィン/カウンターフォーを
 * 作らないことを検証する純粋関数群。VCT探索の再帰ロジックに依存しない。
 */

import type { BoardState, Position } from "@/types/game";

import { checkFive } from "@/logic/renjuRules";

// #37 P3 PR6: VCT検証ヘルパーを Zig 単一ソース経由に（合法局面で TS と一致、未ロード時 TS フォールバック）。
import { hasFourThreeAvailable, hasOpenThree } from "../wasm/threatAdapter";
import { createsFour } from "./threatMoves";
import {
  checkDefenseCounterThreat,
  findFourMoves,
  fourDefenseBlock,
  getFourDefensePosition,
} from "./threatPatterns";
import { hasVCF } from "./vcfCheck";

/**
 * VCT手順の事後検証
 *
 * 見つかった手順を盤面上でリプレイし、各防御手が五連（カウンターウィン）
 * または四（カウンターフォー）を作らないことを検証する。
 *
 * 探索関数内でのper-nodeチェックは探索木全体のノードに対して実行され
 * 性能上不可能（6倍以上の速度低下）なため、O(sequence_length)の事後検証で対応。
 */
export function validateVCTSequence(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
): boolean {
  return validateSubsequence(board, color, sequence, 0);
}

/**
 * VCT手順の部分検証（内部ヘルパー）
 *
 * validateVCTSequence と hasBreakingCounterFour の共通ロジック。
 * sequence[startIndex] から末尾までリプレイし、防御の ct 値を検証する。
 */
function validateSubsequence(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
  startIndex: number,
): boolean {
  const opponentColor = color === "black" ? "white" : "black";
  const placed: Position[] = [];

  let valid = true;
  for (let i = startIndex; i < sequence.length; i++) {
    const pos = sequence[i];
    if (!pos) {
      continue;
    }
    const isDefense = i % 2 === 1;
    const stoneColor = isDefense ? opponentColor : color;

    const row = board[pos.row];
    if (row) {
      row[pos.col] = stoneColor;
    }
    placed.push(pos);

    if (isDefense) {
      const ct = checkDefenseCounterThreat(
        board,
        pos.row,
        pos.col,
        opponentColor,
      );
      if (ct === "win") {
        valid = false;
        break;
      }
      if (ct === "four") {
        // 明示的ブロック: 次の攻撃手がブロック位置と一致するか確認
        // #124: not_four / unstoppable いずれも「この筋は追えない」＝保守側
        const blockPos = fourDefenseBlock(
          getFourDefensePosition(board, pos, opponentColor),
        );
        if (!blockPos) {
          valid = false;
          break;
        }
        const nextIdx = i + 1;
        const nextPos = nextIdx < sequence.length ? sequence[nextIdx] : null;
        if (
          !nextPos ||
          nextPos.row !== blockPos.row ||
          nextPos.col !== blockPos.col
        ) {
          valid = false;
          break;
        }
        // ブロックを先行配置し、脅威チェック
        const bRow = board[blockPos.row];
        if (bRow) {
          bRow[blockPos.col] = color;
        }
        const blockThreat = checkDefenseCounterThreat(
          board,
          blockPos.row,
          blockPos.col,
          color,
        );
        if (!blockThreatContinues(blockThreat, board, opponentColor)) {
          valid = false;
          break;
        }
        placed.push(blockPos);
        i++; // ブロック要素をスキップ（先行配置済み）
        // ブロック石自身の活三/ミセ手チェックは blockThreatContinues で済み（#117）。
        // 以降の openThree チェックは次の防御手（i+1）で処理する。
        continue;
      }
      // 防御手配置後に相手の活三・ミセ手・VCF が存在する → 次の攻撃手が四/五連でなければ
      // VCT手順崩壊（issue #116 / #118 相当）。
      // Zig 探索側は各ノードで同じ判定をするが（#118 の VCF はノード深さ <= 1 限定）、
      // 本検証は詰み木・手順の最終ゲートとして独立に判定する。線形リプレイで局面数が
      // 少ないため、ここでは深さゲート無しで全局面の相手 VCF まで見る。
      if (opponentBlocksThreePursuit(board, opponentColor)) {
        const nextIdx = i + 1;
        if (nextIdx >= sequence.length) {
          valid = false;
          break;
        }
        const nextPos = sequence[nextIdx];
        if (!nextPos) {
          valid = false;
          break;
        }
        const nextRow = board[nextPos.row];
        if (nextRow) {
          nextRow[nextPos.col] = color;
        }
        const makesFourOrFive =
          createsFour(board, nextPos.row, nextPos.col, color) ||
          checkFive(board, nextPos.row, nextPos.col, color);
        if (nextRow) {
          nextRow[nextPos.col] = null;
        }
        if (!makesFourOrFive) {
          valid = false;
          break;
        }
      }
    }
  }

  // 盤面を元に戻す
  for (let j = placed.length - 1; j >= 0; j--) {
    const p = placed[j];
    if (!p) {
      continue;
    }
    const r = board[p.row];
    if (r) {
      r[p.col] = null;
    }
  }

  return valid;
}

/**
 * ブロック石が攻撃継続に必要な脅威を持つか判定する。
 *
 * checkDefenseCounterThreat で四/活三を検出 → true（脅威あり）。
 * いずれもなければ false（脅威なし → VCT不成立）。
 */
function blockHasThreat(
  blockThreat: "win" | "four" | "three" | "none",
): boolean {
  return blockThreat !== "none";
}

/**
 * 相手が「三の追いを許さない脅威」を持つか（Zig `vct.opponentBlocksThreePursuit` 対応）。
 *
 * これが真なら、攻撃側の次の一手は四/五でなければならない。三で追っても
 * 相手は受けずに活四・四三・四追いを先行させられるため、手順が崩壊する。
 *
 * Zig 版は活三 or ミセ手のみで、相手 VCF はノード深さ <= 1 のノードだけで見る
 * （探索コストのため。issue #118）。本検証は手順の線形リプレイで局面数が少ないので
 * 深さゲートは移植せず、全局面で VCF まで見る（最終ゲートとして最も安い closure）。
 * 安い述語から順に評価して短絡する。
 */
export function opponentBlocksThreePursuit(
  board: BoardState,
  opponentColor: "black" | "white",
): boolean {
  return (
    hasOpenThree(board, opponentColor) ||
    hasFourThreeAvailable(board, opponentColor) ||
    hasVCF(board, opponentColor)
  );
}

/**
 * カウンター四をブロックした石で攻撃を継続できるか判定する（issue #117）。
 *
 * Zig 側 `vct.zig` の `blockThreatContinues` と同じ意味論（二重実装のため両方を直すこと）。
 * - `none`: 脅威なし → 継続不可
 * - `win` / `four`: 受けは強制 → 継続可（追加チェック不要＝コスト最小）
 * - `three`: 受け手に受ける義務がない。受け手が活三 / ミセ手（1手四三）/ VCF を持つなら、
 *   受け手はブロックの三を無視して達四・四三・四追いを先行させられるので手順は崩壊する。
 *
 * `board` はブロック石を配置済みの状態で渡すこと。
 */
export function blockThreatContinues(
  blockThreat: "win" | "four" | "three" | "none",
  board: BoardState,
  opponentColor: "black" | "white",
): boolean {
  if (!blockHasThreat(blockThreat)) {
    return false;
  }
  if (blockThreat !== "three") {
    return true;
  }
  return !opponentBlocksThreePursuit(board, opponentColor);
}

/**
 * VCT手順がカウンター四に耐性があるか検証
 *
 * 攻撃手が三を作る各ステップで、防御側がカウンター四を打てるか調べ、
 * CF+ブロック配置後に元手順の残りが崩壊しないか検証する。
 *
 * validateVCTSequence（手順整合性検証）とは独立した責務。
 * 呼び出し元で2段階バリデーション: 手順検証 → カウンター四耐性チェック。
 */
export function isResilientToCounterFours(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
): boolean {
  const opponentColor = color === "black" ? "white" : "black";
  const placed: Position[] = [];
  let resilient = true;

  for (let i = 0; i < sequence.length; i++) {
    const pos = sequence[i];
    if (!pos) {
      continue;
    }

    const isAttack = i % 2 === 0;
    const stoneColor = isAttack ? color : opponentColor;

    const row = board[pos.row];
    if (row) {
      row[pos.col] = stoneColor;
    }
    placed.push(pos);

    // 攻撃手が三を作る場合のみチェック（四や五連は対象外）
    if (
      isAttack &&
      !checkFive(board, pos.row, pos.col, color) &&
      !createsFour(board, pos.row, pos.col, color)
    ) {
      if (hasBreakingCounterFour(board, color, sequence, i)) {
        resilient = false;
        break;
      }
    }
  }

  // 盤面を元に戻す
  for (let j = placed.length - 1; j >= 0; j--) {
    const p = placed[j];
    if (!p) {
      continue;
    }
    const r = board[p.row];
    if (r) {
      r[p.col] = null;
    }
  }

  return resilient;
}

/**
 * 非直接カウンター四が手順を破壊するか検査
 *
 * CF+ブロック配置後、元手順の残りをリプレイし、防御の ct 値変化を検証。
 * ct=win/ct=four不一致のみチェック（活三/ミセ手チェックはCF+ブロック配置下で
 * 偽陽性を生むため省略）。省略により偽VCTを見逃す可能性はあるが、
 * CF+ブロック由来の活三発生は稀であり、実害は限定的。
 *
 * @returns いずれかのカウンター四が手順を破壊するなら true
 */
function hasBreakingCounterFour(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
  attackIndex: number,
): boolean {
  const opponentColor = color === "black" ? "white" : "black";
  const counterFours = findFourMoves(board, opponentColor);

  for (const cf of counterFours) {
    // CF が五連を作るか
    const cfRow = board[cf.row];
    if (!cfRow) {
      continue;
    }
    cfRow[cf.col] = opponentColor;

    if (checkFive(board, cf.row, cf.col, opponentColor)) {
      cfRow[cf.col] = null;
      return true;
    }

    // ブロック位置取得（null = 活四 or 四でない → 防御側勝利扱い・保守側 #124）
    const blockPos = fourDefenseBlock(
      getFourDefensePosition(board, cf, opponentColor),
    );
    if (!blockPos) {
      cfRow[cf.col] = null;
      return true;
    }

    // ブロック配置
    const blockRow = board[blockPos.row];
    if (blockRow) {
      blockRow[blockPos.col] = color;
    }

    // CF+ブロック後、残り手順の防御手 ct 変化を検証
    const breaks = checkSequenceBreaksByCF(
      board,
      color,
      sequence,
      attackIndex + 1,
    );

    // Undo
    if (blockRow) {
      blockRow[blockPos.col] = null;
    }
    cfRow[cf.col] = null;

    if (breaks) {
      return true;
    }
  }

  return false;
}

/**
 * CF+ブロック配置下で残り手順の防御 ct 値が破壊的に変化するか検査
 *
 * validateSubsequenceの簡略版。ct=win と ct=four不一致のみチェック。
 * 活三/ミセ手チェックはCF配置下で偽陽性（正当VCTの誤棄却）を生むため省略。
 * これにより偽VCTを見逃す方向の偽陰性が生じうるが、CF+ブロック由来の
 * 活三発生は稀であり実害は限定的。
 */
function checkSequenceBreaksByCF(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
  startIndex: number,
): boolean {
  const opponentColor = color === "black" ? "white" : "black";
  const placed: Position[] = [];

  let breaks = false;
  for (let i = startIndex; i < sequence.length; i++) {
    const pos = sequence[i];
    if (!pos) {
      continue;
    }

    const isDefense = i % 2 === 1;
    const stoneColor = isDefense ? opponentColor : color;

    // CF/ブロックが占有済みの位置はスキップ
    // 異色衝突（CF at 攻撃位置等）を即breaks=trueにすると、戦略的に打たれない
    // CFまで含めて全カウンター四をチェックするため偽陽性が生じる。
    // lenient方向（スキップ）にすることで正当VCTの棄却を回避する。
    if (board[pos.row]?.[pos.col] !== null) {
      continue;
    }

    const row = board[pos.row];
    if (row) {
      row[pos.col] = stoneColor;
    }
    placed.push(pos);

    if (isDefense) {
      const ct = checkDefenseCounterThreat(
        board,
        pos.row,
        pos.col,
        opponentColor,
      );
      if (ct === "win") {
        breaks = true;
        break;
      }
      if (ct === "four") {
        const fourBlockPos = fourDefenseBlock(
          getFourDefensePosition(board, pos, opponentColor),
        );
        if (!fourBlockPos) {
          breaks = true;
          break;
        }
        const nextIdx = i + 1;
        const nextPos = nextIdx < sequence.length ? sequence[nextIdx] : null;
        if (
          !nextPos ||
          nextPos.row !== fourBlockPos.row ||
          nextPos.col !== fourBlockPos.col
        ) {
          breaks = true;
          break;
        }
      }
    }
  }

  // 盤面を元に戻す
  for (let j = placed.length - 1; j >= 0; j--) {
    const p = placed[j];
    if (!p) {
      continue;
    }
    const r = board[p.row];
    if (r) {
      r[p.col] = null;
    }
  }

  return breaks;
}
