import { describe, expect, it } from "vitest";

import { addResultToWdl, createWdl, wdlFromWinners } from "./wdl.ts";

describe("wdl", () => {
  it("addResultToWdl は A→wins / B→losses / draw→draws", () => {
    const w = createWdl();
    addResultToWdl(w, "A");
    addResultToWdl(w, "B");
    addResultToWdl(w, "B");
    addResultToWdl(w, "draw");
    expect(w).toEqual({ wins: 1, draws: 1, losses: 2 });
  });

  it("wdlFromWinners は列から集計する", () => {
    expect(wdlFromWinners(["A", "A", "draw"])).toEqual({
      wins: 2,
      draws: 1,
      losses: 0,
    });
  });
});
