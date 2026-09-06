/**
 * openingSuiteCli.ts（gen-opening-suite の CLI オプション）のテスト。
 * `--suite-version` が既定と制約の SSoT であることを固定する。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  defaultNegativeRatio,
  parseSuiteArgs,
  smokeSuffixedPath,
} from "./openingSuiteCli.ts";

const V2_ARGS = ["--from-raw=raw.jsonl", "--ply-check=ply.jsonl"];

describe("parseSuiteArgs", () => {
  it("version 2 が既定で、ply-check 必須・negativeRatio 0.4", () => {
    const o = parseSuiteArgs(V2_ARGS);
    expect(o.suiteVersion).toBe(2);
    expect(o.negativeRatioMin).toBe(0.4);
    expect(o.plyCheck).toBe(path.resolve("ply.jsonl"));
    expect(() => parseSuiteArgs(["--from-raw=raw.jsonl"])).toThrow(
      /--ply-check.*必須/,
    );
  });

  it("version 1 は negativeRatio 0 が既定で、ply-check と符号層化は禁止", () => {
    const o = parseSuiteArgs(["--suite-version=1", "--from-raw=raw.jsonl"]);
    expect(o.negativeRatioMin).toBe(0);
    expect(o.plyCheck).toBeNull();
    expect(() => parseSuiteArgs(["--suite-version=1", ...V2_ARGS])).toThrow(
      /version=1 では ply-check/,
    );
    expect(() =>
      parseSuiteArgs([
        "--suite-version=1",
        "--from-raw=raw.jsonl",
        "--negative-ratio=0.4",
      ]),
    ).toThrow(/符号層化/);
    // 明示の 0 は許可
    expect(
      parseSuiteArgs([
        "--suite-version=1",
        "--from-raw=raw.jsonl",
        "--negative-ratio=0",
      ]).negativeRatioMin,
    ).toBe(0);
  });

  it("version 1 でも worker モード（--from-raw なし）は許可", () => {
    expect(parseSuiteArgs(["--suite-version=1"]).fromRaw).toBeNull();
  });

  it("ply-check は from-raw と併用必須、未知の version と未知の引数は例外", () => {
    expect(() => parseSuiteArgs(["--ply-check=ply.jsonl"])).toThrow(
      /--from-raw と併用/,
    );
    expect(() => parseSuiteArgs(["--suite-version=3", ...V2_ARGS])).toThrow(
      /未対応/,
    );
    expect(() => parseSuiteArgs(["--bogus", ...V2_ARGS])).toThrow(/未知の引数/);
    expect(() => parseSuiteArgs(["--target=x", ...V2_ARGS])).toThrow(
      /数値でない/,
    );
    expect(() => parseSuiteArgs(["--negative-ratio=1.5", ...V2_ARGS])).toThrow(
      /0..1/,
    );
  });

  it("数値・パス・bool フラグを読む", () => {
    const o = parseSuiteArgs([
      ...V2_ARGS,
      "--target=10",
      "--workers=0",
      "--ply-score-max=900",
      "--dry-run",
      "--ply-limit=16",
      "--flips-out=flips.jsonl",
    ]);
    expect(o.target).toBe(10);
    expect(o.workers).toBe(1);
    expect(o.plyScoreAbsMax).toBe(900);
    expect(o.dryRun).toBe(true);
    expect(o.plyLimit).toBe(16);
    expect(o.flipsOut).toBe(path.resolve("flips.jsonl"));
  });
});

describe("defaultNegativeRatio / smokeSuffixedPath", () => {
  it("version 1 は 0、2 以上は 0.4", () => {
    expect(defaultNegativeRatio(1)).toBe(0);
    expect(defaultNegativeRatio(2)).toBe(0.4);
  });
  it("拡張子の前に -smoke を付ける", () => {
    expect(smokeSuffixedPath("/a/horizon-flips-v2.jsonl")).toBe(
      "/a/horizon-flips-v2-smoke.jsonl",
    );
    expect(smokeSuffixedPath("/a/noext")).toBe("/a/noext-smoke");
  });
});
