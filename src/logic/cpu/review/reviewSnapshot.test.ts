/**
 * review 戦術出力スナップショット harness（Issue #37 P0 / #39）
 *
 * 目的: review の戦術解析（P3 #42 で Zig へ移す対象）の**現在の出力を golden 凍結**し、
 * P3 の各移行 PR が「出力不変」を機械的に証明できる安全網にする。本テストはロジックを
 * 一切変えない（現状凍結のみ）。
 *
 * 決定性（flaky 回避）: review の minimax は時間制限探索で非決定なので**対象にしない**。
 * 代わりに P3 直撃の bounded 探索関数（detectForcedWin / checkForcedLoss）を直接呼ぶ。
 * これらは `timeLimit=Infinity` を渡すと探索が node/maxDepth のみで打ち切られ
 * **マシン速度に非依存（決定的）**になる（Zig: time_limit==0 で時刻チェック skip）。
 *
 * 凍結する契約 = 構造的・戦術的フィールドのみ:
 *   detectForcedWin: forcedWinType / forcedWin(firstMove,sequence,isForbiddenTrap,tree) /
 *                    doubleMiseBestMove / doubleMiseMoves
 *   checkForcedLoss: type / sequence
 * 除外（非決定 or P3 非対象）: minimax 由来スコア・候補順序・completedDepth・timings。
 *
 * 正規化: forcedWinTree の防御分岐 `defenses` は探索順依存なので座標でソートして順序非依存化
 * （主筋は ForcedWinInfo.sequence が別途凍結するので分岐集合の一致だけ見れば十分）。
 */

import { describe, expect, it } from "vitest";

import type { ForcedWinNode } from "@/types/review";

import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { createBoardFromRecord } from "@/logic/gameRecordParser";

import {
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
  type ForcedLossCheckOptions,
} from "./forcedLossCheck";
import { detectForcedWin } from "./forcedWinDetection";

// 決定的設定: timeLimit を Infinity にして探索を node/maxDepth のみで打ち切る
const DETERMINISTIC_LOSS_OPTIONS: ForcedLossCheckOptions = {
  vcfOptions: { ...REVIEW_VCF_OPTIONS, timeLimit: Infinity },
  miseVcfOptions: { ...REVIEW_MISE_VCF_OPTIONS, timeLimit: Infinity },
  vctOptions: { ...FORCED_LOSS_VCT_OPTIONS, timeLimit: Infinity },
};

/** コーパス: 速攻確定する forcing 局面に厳選（決定性＋CI速度の前提） */
const CORPUS: { name: string; record: string; moveCount: number }[] = [
  {
    // #18 Mise-VCF 局面（44手目=白番、G6 ミセ手で追詰）
    name: "mise-vcf-#18",
    record:
      "H8 H9 I9 I8 G7 F6 G10 G9 F9 H11 H7 F7 F10 G8 I10 H10 K11 J10 " +
      "F8 K9 I11 I13 H6 E9 F11 F12 I5 J4 G5 H5 I7 J8 J6 J7 K7 L8 " +
      "F4 E3 G3 H4 I6 K6 L5",
    moveCount: 43,
  },
  {
    // 被追い詰め多数の白番棋譜（reference_review_test_kifu）。複数手数で凍結
    name: "white29-m20",
    record:
      "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12",
    moveCount: 20,
  },
  {
    name: "white29-m24",
    record:
      "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12",
    moveCount: 24,
  },
];

const sortPos = (
  a: { row: number; col: number },
  b: { row: number; col: number },
): number => a.row - b.row || a.col - b.col;

/** 詰み木を分岐順非依存に正規化（defenses を defenderMove 座標でソート） */
function normalizeTree(node: ForcedWinNode): unknown {
  return {
    attackerMove: node.attackerMove,
    defenses: node.defenses
      .map((d) => ({
        defenderMove: d.defenderMove,
        next: normalizeTree(d.next),
      }))
      .sort((x, y) => sortPos(x.defenderMove, y.defenderMove)),
  };
}

// WASM は1回だけロードして全テストで使い回す
const engine = new WasmSearchEngine(await loadWasmModule());

describe("review 戦術出力スナップショット (#37 P0)", () => {
  it.each(CORPUS)("detectForcedWin: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    const r = detectForcedWin(board, nextColor, false, false, engine);
    const snapshot = {
      forcedWinType: r.forcedWinType ?? null,
      doubleMiseBestMove: r.doubleMiseBestMove,
      doubleMiseMoves: [...r.doubleMiseMoves].sort(sortPos),
      forcedWin: r.forcedWin
        ? {
            firstMove: r.forcedWin.firstMove,
            sequence: r.forcedWin.sequence,
            isForbiddenTrap: r.forcedWin.isForbiddenTrap,
            tree: r.forcedWin.tree
              ? normalizeTree(r.forcedWin.tree)
              : undefined,
          }
        : null,
    };
    expect(snapshot).toMatchSnapshot();
  });

  it.each(CORPUS)("checkForcedLoss: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    // 直前に着手された側の相手 = nextColor が追詰を持つか
    const result = checkForcedLoss(
      board,
      nextColor,
      moveCount,
      engine,
      DETERMINISTIC_LOSS_OPTIONS,
    );
    expect(result ?? null).toMatchSnapshot();
  });
});
