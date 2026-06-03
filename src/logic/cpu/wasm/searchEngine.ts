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

/**
 * EvaluationOptions → WASM用ビットマスクにエンコード
 *
 * ビットの順序は Zig の position_eval.decodeEvalOptions と一致させる。
 * enableNullMovePruning / enableFutilityPruning は Zig 側で
 * enable_counter_four フラグに統合されている。
 */
function encodeEvalOptions(opts: EvaluationOptions): number {
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
  return bits.reduce((flags, bit, i) => flags + (bit ? 2 ** i : 0), 0);
}

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
}

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
   */
  findBestMoveForReview(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
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
      0,
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

    const candidates: WasmCandidateEntry[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const base = ptr + 8 + i * 6;
      candidates.push({
        position: {
          row: view.getUint8(base),
          col: view.getUint8(base + 1),
        },
        score: view.getInt32(base + 2, true),
      });
    }

    return { position: { row, col }, score, completedDepth, candidates };
  }
}
