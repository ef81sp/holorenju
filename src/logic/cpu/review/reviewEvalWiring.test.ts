/**
 * Review eval=hard 配線テスト（A1: 評価オプション配線漏れの修正）
 *
 * findBestMoveForReview の evalOptionsFlags パラメータ追加に伴い、
 * REVIEW_SEARCH_PARAMS.evaluationOptions が hard 相当でエンコードされ、
 * 0 のままWASM探索本体に渡らないことを検証する。
 *
 * 旧コードは searchEngine.ts:194 で WASM findBestMove の eval_flags 引数を 0 ハードコード
 * していたため、レビュー探索は必須防御/ミセ脅威/禁手脆弱性/single-four ペナルティを
 * 切った素 eval で読んでいた。白14クラスの深度感受性手で判定精度を落とす原因。
 */

import { describe, expect, it } from "vitest";

import { DIFFICULTY_PARAMS } from "@/types/cpu";

import { encodeEvalOptions } from "../wasm/searchEngine";
import { REVIEW_SEARCH_PARAMS } from "./reviewConstants";

describe("Review eval=hard 配線（A1）", () => {
  it("REVIEW_SEARCH_PARAMS.evaluationOptions のエンコード結果は 0 でない", () => {
    const flags = encodeEvalOptions(REVIEW_SEARCH_PARAMS.evaluationOptions);
    expect(flags).not.toBe(0);
  });

  it("REVIEW_SEARCH_PARAMS.evaluationOptions のエンコードは hard 相当と一致（SSoT）", () => {
    const reviewFlags = encodeEvalOptions(
      REVIEW_SEARCH_PARAMS.evaluationOptions,
    );
    const hardFlags = encodeEvalOptions(
      DIFFICULTY_PARAMS.hard.evaluationOptions,
    );
    expect(reviewFlags).toBe(hardFlags);
  });

  it("eval=none（フラグ0）と hard で異なる値になる", () => {
    const hardFlags = encodeEvalOptions(REVIEW_SEARCH_PARAMS.evaluationOptions);
    expect(hardFlags).not.toBe(0);
  });
});
