import { describe, expect, it } from "vitest";

import {
  normalizeMaxGames,
  openingsRepeatWarning,
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
