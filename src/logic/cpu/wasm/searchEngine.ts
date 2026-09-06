/**
 * WASM版探索エンジン
 *
 * boardStateToWasm で盤面をコピーし、WASM findBestMove を呼ぶ。
 * 難易度パラメータから maxDepth/timeLimit/maxNodes を取得。
 */

import type { BoardState, Position } from "@/types/game";

import { DIFFICULTY_PARAMS, type CpuDifficulty } from "@/types/cpu";

import type { EvaluationOptions } from "../evaluation/patternScores";
import type { VCFSequenceResult, VCTSequenceResult } from "../search/types";
import type { WasmModuleContext } from "./types";

import { boardStateToWasm, colorToWasm } from "./boardAdapter";
import {
  buildForcedWinTreeFromArrays,
  type WireDefense,
  type WireNode,
} from "./forcedWinTreeWire";

/* eslint-disable no-bitwise -- WASM オプションビットフィールドエンコード */

/**
 * EvaluationOptions → WASM用ビットマスクにエンコード
 *
 * ビットの順序は Zig の position_eval.decodeEvalOptions と一致させる。
 * enableNullMovePruning / enableFutilityPruning は Zig 側で
 * enable_counter_four フラグに統合されている。
 *
 * ビットレイアウト（u32）:
 *   bits 0-8:   position_eval.EvalOptions（ムーブオーダリング用フラグ）
 *   bits 9-16:  葉評価 single_four_penalty_multiplier
 *               （0=未指定→100、255=センチネル→0、1-254=そのまま）
 *   bit 17:     enable_leaf_mise（現在は未使用、将来拡張用）
 *   bit 18:     eval_basis（evalBasis === "prospect" のとき1、それ以外0=legacy）
 *
 * Zig 側: main.zig findBestMove が bits 9-18 をデコードして board_eval_options を構築する。
 */
export function encodeEvalOptions(opts: EvaluationOptions): number {
  // ビット位置: Zig position_eval.decodeEvalOptions と一致
  const bits: boolean[] = [
    opts.enableMise, // bit 0
    opts.enableForbiddenTrap, // bit 1
    opts.enableMultiThreat, // bit 2
    opts.enableCounterFour ||
      opts.enableNullMovePruning ||
      opts.enableFutilityPruning, // bit 3
    opts.enableMandatoryDefense, // bit 4
    opts.enableSingleFourPenalty, // bit 5
    opts.enableMiseThreat, // bit 6
    opts.enableDoubleThreeThreat, // bit 7
    opts.enableForbiddenVulnerability, // bit 8
  ];
  let flags = bits.reduce((acc, bit, i) => acc + (bit ? 2 ** i : 0), 0);

  // bits 9-16: 葉評価 singleFourPenaltyMultiplier
  // センチネル規則（Zig main.zig findBestMove と対称）:
  //   enableSingleFourPenalty が false → 0（未指定 = デフォルト 100）
  //   multiplier === 0 → 255（センチネル: 完全ペナルティ）
  //   その他 → Math.round(m * 100)（1-254）
  if (opts.enableSingleFourPenalty) {
    const m = opts.singleFourPenaltyMultiplier;
    const raw = m === 0 ? 255 : Math.round(m * 100);
    flags |= (raw & 0xff) << 9;
  }

  if (opts.evalBasis === "prospect") {
    flags |= 1 << 18;
  }

  return flags;
}

/** result_buffer の exact_mask（u8）の bit i が立っているか */
function isExactBit(mask: number, i: number): boolean {
  return ((mask >> i) & 1) === 1;
}

/* eslint-enable no-bitwise */

const PV_MAX_LENGTH = 10;

/**
 * 探索結果
 */
export interface WasmSearchResult {
  position: Position;
  score: number;
  completedDepth: number;
}

/**
 * 候補手付き探索結果（レビュー用）
 */
export interface WasmCandidateEntry {
  position: Position;
  score: number;
  pv?: Position[];
  /**
   * score が真値か（review-multipv-2026-09-06.md §2.1）。
   * false = root の fail-low 境界値（上限）。旧 wasm では常に false。
   */
  scoreExact?: boolean;
}

/** 振り返り探索で真値にする root 上位候補数（§2.5、SSoT） */
export const REVIEW_EXACT_TOP_K = 5;
/** wasm findBestMove の forced_row/forced_col「強制手なし」（§2.4） */
export const WASM_NO_FORCED_MOVE = 255;
/** result_buffer 内 exact_mask のオフセット（§2.4。旧 wasm では 0） */
const RESULT_EXACT_MASK_OFFSET = 68;

export interface WasmSearchResultWithCandidates extends WasmSearchResult {
  candidates: WasmCandidateEntry[];
  bestPV?: Position[];
}

export class WasmSearchEngine {
  private readonly wasm: WasmModuleContext;

  constructor(wasm: WasmModuleContext) {
    this.wasm = wasm;
  }

  /** Transposition Table をクリア */
  clearTT(): void {
    this.wasm.ttClear();
  }

  findBestMove(
    board: BoardState,
    color: "black" | "white",
    difficulty: CpuDifficulty,
  ): WasmSearchResult {
    const params = DIFFICULTY_PARAMS[difficulty];
    return this.findBestMoveWithParams(
      board,
      color,
      params.depth,
      params.timeLimit,
      params.maxNodes,
      encodeEvalOptions(params.evaluationOptions),
    );
  }

  findBestMoveWithParams(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    evalOptionsFlags = 0,
  ): WasmSearchResult {
    boardStateToWasm(this.wasm, board);
    this.wasm.ttClear();
    this.wasm.findBestMove(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      0,
      0,
      evalOptionsFlags,
    );
    return this.readResult();
  }

  /** TTをクリアせずに探索（PV補完用） */
  findBestMoveWithParamsNoTTClear(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ): WasmSearchResult {
    boardStateToWasm(this.wasm, board);
    this.wasm.findBestMove(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      0,
      0,
      0,
    );
    return this.readResult();
  }

  /**
   * レビュー用の探索（候補手リスト付き・PV抽出あり）
   *
   * aspiration_mode=1 で段階的拡大幅 [75, 200, 500] を使用。
   * 探索後に各候補手の PV を TT から抽出する。
   *
   * evalOptionsFlags: encodeEvalOptions で生成した hard 相当のフラグ。
   * 0 を渡すと WASM 側は必須防御/ミセ脅威/禁手脆弱性などを切った素 eval で読むため、
   * 呼び出し側で必ず hard 相当（または検証用 0）を明示する。デフォルト引数を持たせない
   * のは、新規呼び出し経路で配線を忘れて素 eval に落ちる silent regression を防ぐため。
   *
   * exactTopK: root 上位 K 手を全窓で再探索して真値にする（§2.1）。候補の scoreExact に反映。
   * forcedMove: 候補外でも必ず真値で返す手（フェーズ 2 §2.6。未配線）。
   * findBestMoveWithParams 系（対戦 CPU / プローブ）はこれらを渡さない（0 = 従来どおり）。
   */
  findBestMoveForReview(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
    evalOptionsFlags: number,
    exactTopK: number = REVIEW_EXACT_TOP_K,
    forcedMove?: Position,
  ): WasmSearchResultWithCandidates {
    const wasmColor = colorToWasm(color);
    boardStateToWasm(this.wasm, board);
    this.wasm.ttClear();
    this.wasm.findBestMove(
      wasmColor,
      maxDepth,
      timeLimitMs,
      maxNodes,
      absoluteTimeLimitMs,
      aspirationMode,
      evalOptionsFlags,
      exactTopK,
      forcedMove?.row ?? WASM_NO_FORCED_MOVE,
      forcedMove?.col ?? WASM_NO_FORCED_MOVE,
    );
    const result = this.readResultWithCandidates();

    // 各候補手の PV を TT から抽出
    for (const candidate of result.candidates) {
      candidate.pv = this.extractPVFromTT(
        board,
        candidate.position,
        color,
        wasmColor,
      );
    }

    // 最善手の PV を個別に抽出（候補手にない場合や preSearch 即リターン時に備える）
    result.bestPV = this.extractPVFromTT(
      board,
      result.position,
      color,
      wasmColor,
    );

    return result;
  }

  /**
   * TT から PV を抽出する
   *
   * extractPV は盤面を一時的に変更して TT を辿るため、
   * 呼び出し前に boardStateToWasm で盤面がセットされている必要がある。
   * 候補手ごとに盤面をリセットして呼び出す。
   */
  extractPVFromTT(
    board: BoardState,
    move: Position,
    color: "black" | "white",
    wasmColor: number,
  ): Position[] {
    // 盤面を毎回リセット（extractPV が盤面を復元するが念のため）
    boardStateToWasm(this.wasm, board);

    this.wasm.extractPV(move.row, move.col, wasmColor, PV_MAX_LENGTH);

    const pvPtr = this.wasm.getResultPVBuffer();
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);
    const len = view.getUint8(pvPtr);
    const pv: Position[] = [];
    for (let i = 0; i < len; i++) {
      pv.push({
        row: view.getUint8(pvPtr + 1 + i * 2),
        col: view.getUint8(pvPtr + 1 + i * 2 + 1),
      });
    }
    return pv;
  }

  private readResult(): WasmSearchResult {
    const ptr = this.wasm.getResultBuffer();
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);
    const row = view.getUint8(ptr);
    const col = view.getUint8(ptr + 1);
    const score = view.getInt32(ptr + 2, true); // little-endian i32
    const completedDepth = view.getUint8(ptr + 6);
    return { position: { row, col }, score, completedDepth };
  }

  /**
   * VCF手順全体を探索
   */
  findVCFSequence(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ): VCFSequenceResult | null {
    boardStateToWasm(this.wasm, board);
    this.wasm.findVCFSequenceWasm(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
    );
    return this.readVCFSequenceResult();
  }

  /**
   * 指定初手からのVCF手順を探索
   */
  findVCFSequenceFromFirstMove(
    board: BoardState,
    firstMove: Position,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ): VCFSequenceResult | null {
    boardStateToWasm(this.wasm, board);
    this.wasm.findVCFSequenceFromFirstMoveWasm(
      firstMove.row,
      firstMove.col,
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
    );
    return this.readVCFSequenceResult();
  }

  /**
   * Mise-VCF手順を探索
   */
  findMiseVCFSequence(
    board: BoardState,
    color: "black" | "white",
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: boolean,
  ): VCTSequenceResult | null {
    boardStateToWasm(this.wasm, board);
    this.wasm.findMiseVCFSequenceWasm(
      colorToWasm(color),
      timeLimitMs,
      maxNodes,
      collectBranches ? 1 : 0,
    );
    // Mise-VCF バッファは VCT と同一フォーマット（分岐情報を含む）
    return this.readSequenceWithTree(this.wasm.getMiseVCFSequenceBuffer());
  }

  private readVCFSequenceResult(): VCFSequenceResult | null {
    const ptr = this.wasm.getVCFSequenceBuffer();
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);

    const found = view.getUint8(ptr) === 1;
    if (!found) {
      return null;
    }

    const len = view.getUint8(ptr + 1);
    const isForbiddenTrap = view.getUint8(ptr + 2) === 1;

    const sequence: Position[] = [];
    for (let i = 0; i < len; i++) {
      sequence.push({
        row: view.getUint8(ptr + 3 + i * 2),
        col: view.getUint8(ptr + 3 + i * 2 + 1),
      });
    }

    const firstMove = sequence[0] ?? { row: 0, col: 0 };
    return { firstMove, sequence, isForbiddenTrap };
  }

  /**
   * VCT手順全体を探索
   */
  findVCTSequence(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: boolean,
  ): VCTSequenceResult | null {
    boardStateToWasm(this.wasm, board);
    this.wasm.findVCTSequenceWasm(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      collectBranches ? 1 : 0,
    );
    return this.readVCTSequenceResult();
  }

  /**
   * VCT手順全体を探索（被詰み判定専用・strict）
   *
   * カウンターフォーでテンポを奪い返される手順（幻の被詰み）を棄却する。
   * 自分の forcedWin 検出（攻め）には findVCTSequence（lenient）を使うこと。
   */
  findVCTSequenceStrict(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: boolean,
  ): VCTSequenceResult | null {
    boardStateToWasm(this.wasm, board);
    this.wasm.findVCTSequenceStrictWasm(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      collectBranches ? 1 : 0,
    );
    return this.readVCTSequenceResult();
  }

  /**
   * 指定初手からのVCT手順を探索
   */
  findVCTSequenceFromFirstMove(
    board: BoardState,
    firstMove: Position,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: boolean,
  ): VCTSequenceResult | null {
    boardStateToWasm(this.wasm, board);
    this.wasm.findVCTSequenceFromFirstMoveWasm(
      firstMove.row,
      firstMove.col,
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      collectBranches ? 1 : 0,
    );
    return this.readVCTSequenceResult();
  }

  /**
   * 指定手がVCT開始手として有効かチェック
   */
  isVCTFirstMove(
    board: BoardState,
    move: Position,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ): boolean {
    boardStateToWasm(this.wasm, board);
    return (
      this.wasm.isVCTFirstMoveWasm(
        move.row,
        move.col,
        colorToWasm(color),
        maxDepth,
        timeLimitMs,
        maxNodes,
      ) === 1
    );
  }

  private readVCTSequenceResult(): VCTSequenceResult | null {
    return this.readSequenceWithTree(this.wasm.getVCTSequenceBuffer());
  }

  /**
   * 直近に構築した詰み木の健全性（issue #122）
   *
   * どちらも詰み判定は壊れないが、表示の受け分岐が欠ける種類の劣化。
   * - overflow: アリーナのノード/受け上限を超えて枝が terminal に倒れた
   * - defenseTruncated: 1ノードの受けが上限を超えて切り捨てられた
   */
  lastForcedWinTreeHealth(): { overflow: boolean; defenseTruncated: boolean } {
    return {
      overflow: this.wasm.getLastForcedWinTreeOverflow() === 1,
      defenseTruncated: this.wasm.getLastForcedWinTreeDefenseTruncated() === 1,
    };
  }

  /**
   * 詰み木付きの手順バッファをデシリアライズする（VCT / Mise-VCF 共通、#22）。
   *
   * バッファフォーマット（Zig writeVCTResult / findMiseVCFSequenceWasm +
   * writeForcedWinTree と一致）:
   * [0] found, [1] seq_len, [2] isForbiddenTrap,
   * [3..] row,col ペア（メインPV = 木の defenses[0] 連鎖）,
   * offset = 3 + seq_len*2 以降: node_count(u16 LE), defense_count(u16 LE),
   *   nodes(各6B: row,col,defense_start u16,defense_count u16),
   *   defenses(各4B: row,col,child_node u16)。
   *
   * 木は `result.tree` に復元する（progressionModel が再帰展開する）。
   */
  private readSequenceWithTree(ptr: number): VCTSequenceResult | null {
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);

    const found = view.getUint8(ptr) === 1;
    if (!found) {
      return null;
    }

    const len = view.getUint8(ptr + 1);
    const isForbiddenTrap = view.getUint8(ptr + 2) === 1;

    const sequence: Position[] = [];
    for (let i = 0; i < len; i++) {
      sequence.push({
        row: view.getUint8(ptr + 3 + i * 2),
        col: view.getUint8(ptr + 3 + i * 2 + 1),
      });
    }

    const firstMove = sequence[0] ?? { row: 0, col: 0 };

    const result: VCTSequenceResult = {
      firstMove,
      sequence,
      isForbiddenTrap,
    };

    // ─── 詰み木セクション ───
    let pos = ptr + 3 + len * 2;
    const nodeCount = view.getUint16(pos, true);
    const defenseCount = view.getUint16(pos + 2, true);
    pos += 4;

    if (nodeCount > 0) {
      const nodes: WireNode[] = [];
      for (let i = 0; i < nodeCount; i++) {
        nodes.push({
          attacker: {
            row: view.getUint8(pos),
            col: view.getUint8(pos + 1),
          },
          defenseStart: view.getUint16(pos + 2, true),
          defenseCount: view.getUint16(pos + 4, true),
        });
        pos += 6;
      }
      const defenses: WireDefense[] = [];
      for (let i = 0; i < defenseCount; i++) {
        defenses.push({
          defender: {
            row: view.getUint8(pos),
            col: view.getUint8(pos + 1),
          },
          childNode: view.getUint16(pos + 2, true),
        });
        pos += 4;
      }

      const tree = buildForcedWinTreeFromArrays(nodes, defenses);
      if (tree) {
        result.tree = tree;
      }
    }

    return result;
  }

  private readResultWithCandidates(): WasmSearchResultWithCandidates {
    const ptr = this.wasm.getResultBuffer();
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);
    const row = view.getUint8(ptr);
    const col = view.getUint8(ptr + 1);
    const score = view.getInt32(ptr + 2, true);
    const completedDepth = view.getUint8(ptr + 6);
    const candidateCount = view.getUint8(ptr + 7);
    // bit i = 候補 i が真値（最終順序）。旧 wasm は書かないので 0（全候補が境界値扱い）。
    const exactMask = view.getUint8(ptr + RESULT_EXACT_MASK_OFFSET);

    const candidates: WasmCandidateEntry[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const base = ptr + 8 + i * 6;
      candidates.push({
        position: {
          row: view.getUint8(base),
          col: view.getUint8(base + 1),
        },
        score: view.getInt32(base + 2, true),
        scoreExact: isExactBit(exactMask, i),
      });
    }

    return { position: { row, col }, score, completedDepth, candidates };
  }
}
