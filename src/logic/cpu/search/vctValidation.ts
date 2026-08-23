/**
 * VCT手順の事後検証
 *
 * 見つかった手順を盤面上でリプレイし、防御手がカウンターウィン/カウンターフォーを
 * 作らないことを検証する純粋関数群。VCT探索の再帰ロジックに依存しない。
 */

import type { BoardState, Position } from "@/types/game";

import { checkFive } from "@/logic/renjuRules";

// #37 P3 PR6: VCT検証ヘルパーを Zig 単一ソース経由に（合法局面で TS と一致、未ロード時 TS フォールバック）。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
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
 * `sequence[startIndex]` から末尾までリプレイし、防御の ct 値を検証する。
 * 現在の呼び出し元は `validateVCTSequence` のみ（`startIndex` は手順途中からの
 * 検証用に残してある）。
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
        // ブロック後の分岐は classifyBlock に集約（issue #145）。
        // 判定のあいだだけブロック石を置いて外すので、ここではまだ盤面は変わっていない。
        const outcome = classifyBlock(board, blockPos, color);
        if (outcome === "stop") {
          // 禁手で打てない（#146）/ 脅威なし / 三しか作らず受け手に反撃がある（#117）
          valid = false;
          break;
        }
        // ブロックを配置（以降の検証はブロック石込みの盤面で行う）
        const bRow = board[blockPos.row];
        if (bRow) {
          bRow[blockPos.col] = color;
        }
        placed.push(blockPos);
        if (outcome === "win_now") {
          // ブロック石が五を作った → その場で攻撃側の勝ち（issue #140）。
          // 以降の手順は存在しない（Zig 側もブロック石で手順を確定する）ので検証不要。
          break;
        }
        i++; // ブロック要素をスキップ（先行配置済み）
        // ブロック石自身の活三/ミセ手チェックは classifyBlock で済み（#117）。
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
 * 攻め側がブロック点に実際に打てるか判定する（issue #146）。
 *
 * Zig 側 `vct.zig` の `blockIsPlayable` と同じ意味論（二重実装のため両方を直すこと）。
 * 受け手のカウンター四をブロックする点は、攻め側が黒のとき禁手（三三 / 四四 / 長連）で
 * あり得る。そこには打てない＝相手の四を止められない＝その筋の VCT は不成立。
 * 五連を作る点は禁手に優先して勝ちなので `checkFive` で先に許可する。
 *
 * `board` はブロック石を**配置する前**（対象が空点）の状態で渡すこと。
 */
export function blockIsPlayable(
  board: BoardState,
  blockPos: Position,
  color: "black" | "white",
): boolean {
  if (color !== "black") {
    return true;
  }
  if (checkFive(board, blockPos.row, blockPos.col, "black")) {
    return true;
  }
  return !isForbiddenForBlack(board, blockPos.row, blockPos.col);
}

/** カウンター四をブロックしたあとの分岐（issue #145。Zig `vct.BlockOutcome` と 1 対 1） */
export type BlockOutcome = "stop" | "win_now" | "continue_search";

/**
 * カウンター四をブロックしたあとの分岐を 1 箇所に集約する（issue #145）。
 *
 * Zig 側 `vct.zig` の `classifyBlock` と 1 対 1（二重実装のため両方を直すこと）。
 * - `stop`: ブロック点が禁手（#146）/ ブロック石が脅威を作らない / 三しか作らず
 *   受け手が活三・ミセ手・VCF を持つ（#117 / #118）→ この筋は不成立
 * - `win_now`: ブロック石が五連 → その場で勝ち（#140）
 * - `continue_search`: 受けの検証に進む
 *
 * `board` はブロック点が**空のまま**の状態で渡すこと（禁手判定は空点でしかできない）。
 * 判定のあいだだけブロック石を置いて外すので、戻ったときの `board` は呼び出し前と同一。
 */
export function classifyBlock(
  board: BoardState,
  blockPos: Position,
  color: "black" | "white",
): BlockOutcome {
  if (!blockIsPlayable(board, blockPos, color)) {
    return "stop";
  }
  const row = board[blockPos.row];
  if (!row) {
    return "stop";
  }
  const opponentColor = color === "black" ? "white" : "black";

  row[blockPos.col] = color;
  const outcome = classifyPlacedBlock(board, blockPos, color, opponentColor);
  row[blockPos.col] = null;

  return outcome;
}

/** `classifyBlock` の本体（ブロック石を配置済みの盤面で判定する） */
function classifyPlacedBlock(
  board: BoardState,
  blockPos: Position,
  color: "black" | "white",
  opponentColor: "black" | "white",
): BlockOutcome {
  const blockThreat = checkDefenseCounterThreat(
    board,
    blockPos.row,
    blockPos.col,
    color,
  );
  // 五連は受けの検証に進むまでもなく勝ち（issue #140）。
  // blockThreatContinues より前に見る（"win" は無条件継続なので結果は同じ）。
  if (blockThreat === "win") {
    return "win_now";
  }
  return blockThreatContinues(blockThreat, board, opponentColor)
    ? "continue_search"
    : "stop";
}

/**
 * カウンター四をブロックした石で攻撃を継続できるか判定する（issue #117）。
 *
 * 呼び出し元は `classifyBlock` だけ（issue #145 で分岐を集約した）。
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
