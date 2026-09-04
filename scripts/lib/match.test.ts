/**
 * buildBridgeCustomParams のワイヤリング検証。
 *
 * Gate 2（commit-bench による prospect vs legacy 比較）の前提として、
 * evaluationOptions（evalBasis 含む）が createBridgeWorker → cpu-bridge-worker →
 * encodeEvalOptionsForWasm まで正しく到達することを、worker を起動せずに固定する。
 * 経路: buildBridgeCustomParams（本ファイル） → mergeDifficultyParams
 *       （cpu-bridge-worker.ts loadDifficultyParams が使う SSoT） →
 *       encodeEvalOptionsForWasm（bit18 = eval_basis）。
 */
import { describe, expect, it } from "vitest";

import { DIFFICULTY_PARAMS } from "../../src/types/cpu.ts";
import { mergeDifficultyParams } from "./difficultyParamsMerge.ts";
import {
  type OpeningSource,
  buildBridgeCustomParams,
  buildTasks,
  jushuOpenings,
} from "./match.ts";
import { encodeEvalOptionsForWasm } from "./wasmEvalOptionsEncoder.ts";

describe("buildBridgeCustomParams", () => {
  it("randomFactor / evaluationOptions とも未指定なら undefined（既存呼び出しとの後方互換）", () => {
    expect(buildBridgeCustomParams(undefined, undefined)).toBeUndefined();
  });

  it("randomFactor のみ指定（従来の commit-bench --randomFactor 経路）", () => {
    expect(buildBridgeCustomParams(0.02, undefined)).toEqual({
      randomFactor: 0.02,
    });
  });

  it("evaluationOptions のみ指定（Gate 2: --eval-options-a 経路）", () => {
    expect(
      buildBridgeCustomParams(undefined, { evalBasis: "prospect" }),
    ).toEqual({
      evaluationOptions: { evalBasis: "prospect" },
    });
  });

  it("両方指定された場合は両方とも customParams に含まれる", () => {
    expect(buildBridgeCustomParams(0.02, { evalBasis: "prospect" })).toEqual({
      randomFactor: 0.02,
      evaluationOptions: { evalBasis: "prospect" },
    });
  });

  it("maxNodes のみ指定（--max-nodes-a/b 経路）", () => {
    expect(buildBridgeCustomParams(undefined, undefined, 3_000_000)).toEqual({
      maxNodes: 3_000_000,
    });
  });

  it("maxNodes は他レバーと共存する", () => {
    expect(
      buildBridgeCustomParams(0.02, { evalBasis: "prospect" }, 3_000_000),
    ).toEqual({
      randomFactor: 0.02,
      evaluationOptions: { evalBasis: "prospect" },
      maxNodes: 3_000_000,
    });
  });

  it("maxNodes オーバーライドが merge 後に反映される（difficulty 既定を上書き）", () => {
    const customParams = buildBridgeCustomParams(
      undefined,
      undefined,
      3_000_000,
    );
    const merged = mergeDifficultyParams(DIFFICULTY_PARAMS.hard, customParams);
    expect(merged.maxNodes).toBe(3_000_000);
    // 他フィールドは baseParams のまま
    expect(merged.timeLimit).toBe(DIFFICULTY_PARAMS.hard.timeLimit);
    expect(merged.depth).toBe(DIFFICULTY_PARAMS.hard.depth);
  });

  it("maxDepth のみ指定（--max-depth-a/b 経路）— DifficultyParams.depth に写る", () => {
    expect(
      buildBridgeCustomParams(undefined, undefined, undefined, 12),
    ).toEqual({
      depth: 12,
    });
  });

  it("maxDepth は他レバーと共存する", () => {
    expect(
      buildBridgeCustomParams(0.02, { evalBasis: "prospect" }, 3_000_000, 12),
    ).toEqual({
      randomFactor: 0.02,
      evaluationOptions: { evalBasis: "prospect" },
      maxNodes: 3_000_000,
      depth: 12,
    });
  });

  it("maxDepth オーバーライドが merge 後に depth を上書きする", () => {
    const customParams = buildBridgeCustomParams(
      undefined,
      undefined,
      undefined,
      12,
    );
    const merged = mergeDifficultyParams(DIFFICULTY_PARAMS.hard, customParams);
    expect(merged.depth).toBe(12);
    // 他フィールドは baseParams のまま
    expect(merged.timeLimit).toBe(DIFFICULTY_PARAMS.hard.timeLimit);
    expect(merged.maxNodes).toBe(DIFFICULTY_PARAMS.hard.maxNodes);
  });
});

describe("evalBasis 配線の end-to-end（silent 事故防止）", () => {
  it("evaluationOptions={evalBasis:'prospect'} が bit18 まで到達する", () => {
    const customParams = buildBridgeCustomParams(undefined, {
      evalBasis: "prospect",
    });
    // cpu-bridge-worker.ts loadDifficultyParams と同じマージ規則
    const merged = mergeDifficultyParams(DIFFICULTY_PARAMS.hard, customParams);
    const flags = encodeEvalOptionsForWasm(merged.evaluationOptions);

    expect(merged.evaluationOptions.evalBasis).toBe("prospect");
    expect(flags & (1 << 18)).not.toBe(0);
  });

  it("evaluationOptions 未指定なら base(hard)の evalBasis がそのまま伝播する（P5-a以降は既定でprospect）", () => {
    // P5-a（docs/plans/eval-basis-prospect-2026-07-13.md §5, Gate 2採用）で
    // DIFFICULTY_PARAMS.hard.evaluationOptions.evalBasis が既定 "prospect" になった。
    // customParams 未指定時は mergeDifficultyParams が baseParams をそのまま返す
    // （customParams.evaluationOptions で上書きしない）ため、base の値がそのまま伝播する。
    const customParams = buildBridgeCustomParams(undefined, undefined);
    const merged = mergeDifficultyParams(DIFFICULTY_PARAMS.hard, customParams);
    const flags = encodeEvalOptionsForWasm(merged.evaluationOptions);

    expect(merged.evaluationOptions.evalBasis).toBe("prospect");
    expect(flags & (1 << 18)).not.toBe(0);
  });

  it("evaluationOptions={evalBasis:'legacy'} を明示指定するとbit18は立たない（legacy比較ベースラインの取得経路）", () => {
    // P5-a以降、hard自体がprospect既定のため、legacyとの比較には明示的な
    // override（evalBasis:"legacy"）が必要（未指定では得られない）。
    const customParams = buildBridgeCustomParams(undefined, {
      evalBasis: "legacy",
    });
    const merged = mergeDifficultyParams(DIFFICULTY_PARAMS.hard, customParams);
    const flags = encodeEvalOptionsForWasm(merged.evaluationOptions);

    expect(merged.evaluationOptions.evalBasis).toBe("legacy");
    expect(flags & (1 << 18)).toBe(0);
  });

  it("A側=prospect(未指定) / B側=legacy(明示指定) を同時指定しても互いに干渉しない（プレイヤー別独立性）", () => {
    const customParamsA = buildBridgeCustomParams(undefined, {
      evalBasis: "prospect",
    });
    const customParamsB = buildBridgeCustomParams(undefined, {
      evalBasis: "legacy",
    });

    const mergedA = mergeDifficultyParams(
      DIFFICULTY_PARAMS.hard,
      customParamsA,
    );
    const mergedB = mergeDifficultyParams(
      DIFFICULTY_PARAMS.hard,
      customParamsB,
    );

    const flagsA = encodeEvalOptionsForWasm(mergedA.evaluationOptions);
    const flagsB = encodeEvalOptionsForWasm(mergedB.evaluationOptions);

    expect(flagsA & (1 << 18)).not.toBe(0);
    expect(flagsB & (1 << 18)).toBe(0);
  });
});

describe("buildTasks(jushuOpenings()) — 珠型モードの後方互換", () => {
  it("各珠型に A黒/A白 の 2 局を隣接して出し、pairId は set:珠型", () => {
    const tasks = buildTasks(jushuOpenings(), 2);
    expect(tasks.length % 2).toBe(0);
    for (let i = 0; i < tasks.length; i += 2) {
      const black = tasks[i]!;
      const white = tasks[i + 1]!;
      expect(black.isABlack).toBe(true);
      expect(white.isABlack).toBe(false);
      expect(black.pairId).toBe(white.pairId);
      expect(black.openingId).toBe(white.openingId);
      expect(black.pairId).toBe(
        `${i < tasks.length / 2 ? 0 : 1}:${black.openingId}`,
      );
    }
  });

  it("pairId はセット間で異なる（同一珠型でも別ペア）", () => {
    const tasks = buildTasks(jushuOpenings(), 2);
    const ids = new Set(tasks.map((t) => t.pairId));
    expect(ids.size).toBe(tasks.length / 2);
  });
});

describe("jushuOpenings", () => {
  it("26 珠型を 3 石の OpeningSource として返す", () => {
    const src = jushuOpenings();
    expect(src.length).toBe(26);
    for (const o of src) {
      expect(o.positions).toHaveLength(3);
      expect(o.positions[0]).toEqual({ row: 7, col: 7 });
    }
  });

  it("珠型モードの 1 セットは 26 × 2 = 52 局", () => {
    expect(buildTasks(jushuOpenings(), 1)).toHaveLength(52);
  });
});

const SRC: OpeningSource[] = [
  { id: "o1", positions: [{ row: 7, col: 7 }] },
  {
    id: "o2",
    positions: [
      { row: 7, col: 7 },
      { row: 6, col: 8 },
    ],
  },
  {
    id: "o3",
    positions: [
      { row: 7, col: 7 },
      { row: 6, col: 8 },
      { row: 8, col: 6 },
    ],
  },
];

describe("buildTasks", () => {
  it("各開局に A黒→A白 を隣接して出し、pairId は set:id、positions は source を透過する", () => {
    const tasks = buildTasks(SRC, 1);
    expect(tasks.map((t) => [t.openingId, t.isABlack, t.pairId])).toEqual([
      ["o1", true, "0:o1"],
      ["o1", false, "0:o1"],
      ["o2", true, "0:o2"],
      ["o2", false, "0:o2"],
      ["o3", true, "0:o3"],
      ["o3", false, "0:o3"],
    ]);
    expect(tasks[2]!.positions).toBe(SRC[1]!.positions);
    expect(tasks[5]!.positions).toHaveLength(3);
  });

  it("sets はスイートの周回数（各周回で pairId の set が進む）", () => {
    const tasks = buildTasks(SRC, 2);
    expect(tasks).toHaveLength(12);
    expect(tasks[0]!.pairId).toBe("0:o1");
    expect(tasks[6]!.pairId).toBe("1:o1");
    expect(tasks[11]!.pairId).toBe("1:o3");
  });

  it("offset は n 番目の開局から使い、末尾で折り返さない", () => {
    const tasks = buildTasks(SRC, 2, { offset: 2 });
    expect(tasks.map((t) => t.pairId)).toEqual([
      "0:o3",
      "0:o3",
      "1:o3",
      "1:o3",
    ]);
    expect(buildTasks(SRC, 1, { offset: 3 })).toEqual([]);
    expect(buildTasks(SRC, 1, { offset: 99 })).toEqual([]);
  });

  it("maxGames はペア境界で切る（奇数なら偶数に切り下げ）", () => {
    expect(buildTasks(SRC, 1, { maxGames: 4 }).map((t) => t.pairId)).toEqual([
      "0:o1",
      "0:o1",
      "0:o2",
      "0:o2",
    ]);
    expect(buildTasks(SRC, 1, { maxGames: 3 })).toHaveLength(2);
    expect(buildTasks(SRC, 1, { maxGames: 0 })).toHaveLength(6);
    expect(buildTasks(SRC, 1, { maxGames: 100 })).toHaveLength(6);
  });
});
