import { describe, expect, it } from "vitest";

import {
  effectiveRandomFactor,
  normalizeMaxGames,
  openingsRepeatWarning,
  resolveFixedNodesParams,
  resolveFixedNodesPerSide,
  resolveMoveTimeoutMs,
  validateFixedNodesFlags,
  validateOpeningsFlags,
} from "./benchCliChecks.ts";

describe("validateOpeningsFlags", () => {
  it("--openings と --book-a/--book-b の併用はエラー", () => {
    expect(
      validateOpeningsFlags({ openings: "s.json", bookA: true, bookB: false }),
    ).toMatch(/--book-a/);
    expect(
      validateOpeningsFlags({ openings: "s.json", bookA: false, bookB: true }),
    ).toMatch(/--book-b/);
  });

  it("--openings 単独・book 単独は OK", () => {
    expect(
      validateOpeningsFlags({ openings: "s.json", bookA: false, bookB: false }),
    ).toBeNull();
    expect(
      validateOpeningsFlags({ openings: undefined, bookA: true, bookB: true }),
    ).toBeNull();
  });

  it("--opening-offset は --openings 無しでは意味が無いのでエラー", () => {
    expect(
      validateOpeningsFlags({
        openings: undefined,
        bookA: false,
        bookB: false,
        openingOffset: 3,
      }),
    ).toMatch(/--opening-offset/);
    expect(
      validateOpeningsFlags({
        openings: undefined,
        bookA: false,
        bookB: false,
        openingOffset: 0,
      }),
    ).toBeNull();
  });
});

describe("openingsRepeatWarning", () => {
  it("--openings かつ sets > 1 かつ randomFactor 未指定なら warn", () => {
    expect(
      openingsRepeatWarning({
        openings: "s.json",
        sets: 2,
        randomFactor: undefined,
      }),
    ).toMatch(/同一棋譜/);
  });

  it("sets=1 / randomFactor あり / 珠型モードなら warn しない", () => {
    expect(
      openingsRepeatWarning({
        openings: "s.json",
        sets: 1,
        randomFactor: undefined,
      }),
    ).toBeNull();
    expect(
      openingsRepeatWarning({
        openings: "s.json",
        sets: 4,
        randomFactor: 0.02,
      }),
    ).toBeNull();
    expect(
      openingsRepeatWarning({
        openings: undefined,
        sets: 8,
        randomFactor: undefined,
      }),
    ).toBeNull();
  });
});

describe("normalizeMaxGames", () => {
  it("偶数はそのまま、奇数は偶数へ切り下げて warning を返す", () => {
    expect(normalizeMaxGames(4)).toEqual({
      ok: true,
      maxGames: 4,
      warning: null,
    });
    expect(normalizeMaxGames(0)).toEqual({
      ok: true,
      maxGames: 0,
      warning: null,
    });
    const odd = normalizeMaxGames(5);
    expect(odd).toMatchObject({ ok: true, maxGames: 4 });
    expect(odd.ok && odd.warning).toMatch(/5.*4/);
  });

  it("1 はペアを成せず 0（=無効・全局）にも丸められないのでエラー", () => {
    const one = normalizeMaxGames(1);
    expect(one.ok).toBe(false);
    expect(!one.ok && one.error).toMatch(/--max-games/);
  });
});

describe("resolveFixedNodesParams", () => {
  it("fixedNodes → timeLimit 0 / maxNodes N / deterministic true", () => {
    expect(resolveFixedNodesParams(50000)).toEqual({
      timeLimit: 0,
      maxNodes: 50000,
      deterministic: true,
    });
  });

  it("未指定なら undefined（時間モードのまま）", () => {
    expect(resolveFixedNodesParams(undefined)).toBeUndefined();
  });
});

describe("resolveFixedNodesPerSide", () => {
  it("--fixed-nodes は両側に同じ N", () => {
    expect(resolveFixedNodesPerSide({ fixedNodes: 100 })).toEqual({
      a: 100,
      b: 100,
    });
  });

  it("--fixed-nodes-a/b は片側のみ（較正用の時間 vs 固定の混合）", () => {
    expect(resolveFixedNodesPerSide({ fixedNodesB: 100 })).toEqual({
      a: undefined,
      b: 100,
    });
  });

  it("両側指定と片側指定の併用はエラー", () => {
    expect(() =>
      resolveFixedNodesPerSide({ fixedNodes: 100, fixedNodesA: 50 }),
    ).toThrow(/--fixed-nodes/);
  });
});

describe("validateFixedNodesFlags", () => {
  const base = {
    fixedNodesA: 100 as number | undefined,
    fixedNodesB: 100 as number | undefined,
    maxNodesA: undefined as number | undefined,
    maxNodesB: undefined as number | undefined,
    bookA: false,
    bookB: false,
    randomFactor: undefined as number | undefined,
    seedExplicit: false,
    sets: 1,
  };

  it("固定ノード未指定なら常に OK（時間モードは従来どおり）", () => {
    expect(
      validateFixedNodesFlags({
        ...base,
        fixedNodesA: undefined,
        fixedNodesB: undefined,
        maxNodesA: 3_000_000,
        bookA: true,
        randomFactor: 0.02,
        sets: 8,
      }),
    ).toBeNull();
  });

  it("両側固定・他フラグ無しは OK", () => {
    expect(validateFixedNodesFlags(base)).toBeNull();
  });

  it("--max-nodes-a/b との併用はエラー", () => {
    expect(validateFixedNodesFlags({ ...base, maxNodesA: 1 })).toMatch(
      /--max-nodes-a/,
    );
    expect(validateFixedNodesFlags({ ...base, maxNodesB: 1 })).toMatch(
      /--max-nodes-b/,
    );
  });

  it("--book-a/b との併用はエラー（ブックの randomPool は Math.random）", () => {
    expect(validateFixedNodesFlags({ ...base, bookA: true })).toMatch(
      /--book-a/,
    );
    expect(validateFixedNodesFlags({ ...base, bookB: true })).toMatch(
      /--book-b/,
    );
  });

  it("randomFactor > 0 は --seed 必須", () => {
    expect(validateFixedNodesFlags({ ...base, randomFactor: 0.02 })).toMatch(
      /--seed/,
    );
    expect(
      validateFixedNodesFlags({
        ...base,
        randomFactor: 0.02,
        seedExplicit: true,
      }),
    ).toBeNull();
  });

  it("difficulty 既定の randomFactor > 0（beginner=0.3）でも --seed 無しはエラー（実効値で判定）", () => {
    const effective = effectiveRandomFactor(undefined, "beginner");
    expect(effective).toBeGreaterThan(0);
    expect(
      validateFixedNodesFlags({ ...base, randomFactor: effective }),
    ).toMatch(/--seed/);
    expect(
      validateFixedNodesFlags({
        ...base,
        randomFactor: effective,
        seedExplicit: true,
      }),
    ).toBeNull();
  });

  it("randomFactor=0 は seed 不要", () => {
    expect(validateFixedNodesFlags({ ...base, randomFactor: 0 })).toBeNull();
  });

  it("--sets > 1 は randomFactor 無しではエラー（同一棋譜の反復）", () => {
    expect(validateFixedNodesFlags({ ...base, sets: 2 })).toMatch(/--sets/);
    expect(
      validateFixedNodesFlags({
        ...base,
        sets: 2,
        randomFactor: 0.02,
        seedExplicit: true,
      }),
    ).toBeNull();
    expect(
      validateFixedNodesFlags({ ...base, sets: 2, randomFactor: 0 }),
    ).toMatch(/--sets/);
  });

  it("片側固定（較正）でも同じ排他が効く", () => {
    expect(
      validateFixedNodesFlags({ ...base, fixedNodesA: undefined, bookA: true }),
    ).toMatch(/--book-a/);
  });
});

describe("effectiveRandomFactor", () => {
  it("明示値があればそれ、無ければ difficulty 既定", () => {
    expect(effectiveRandomFactor(0.02, "beginner")).toBe(0.02);
    expect(effectiveRandomFactor(0, "beginner")).toBe(0);
    expect(effectiveRandomFactor(undefined, "hard")).toBe(0);
    expect(effectiveRandomFactor(undefined, "beginner")).toBe(0.3);
  });
});

describe("resolveMoveTimeoutMs", () => {
  it("明示指定があればそれを使う", () => {
    expect(resolveMoveTimeoutMs(5000, true, 30000)).toBe(5000);
  });
  it("決定的モードで未指定なら 600000", () => {
    expect(resolveMoveTimeoutMs(undefined, true, 30000)).toBe(600000);
  });
  it("時間モードで未指定なら CLI 既定", () => {
    expect(resolveMoveTimeoutMs(undefined, false, 30000)).toBe(30000);
  });
});
