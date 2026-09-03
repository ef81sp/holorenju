/**
 * 対局統計アキュムレータ（runMatch から統計を分離）。
 *
 * push(game) するたびに WDL / 三項 Elo / ペア統計 / SPRT を更新して返す。
 * **停止判定はペア LLR**（完成ペアのみ。未完成ペアは待つ）。三項 SPRT は
 * 参考値として並記する。副作用は持たない（表示・保存は caller）。
 */
import type {
  EloDiffResult,
  PairedStats,
  SPRTConfig,
  SPRTDecision,
  SPRTState,
  WDLCount,
} from "../types/ab.ts";

import { estimateEloDiff } from "./eloDiff.ts";
import { type PairableGame, computePairedStats } from "./pairedStats.ts";
import { updateSPRT } from "./sprt.ts";

/** push 後の統計スナップショット。 */
export interface MatchStatsSnapshot {
  /** WDL（A 視点） */
  wdl: WDLCount;
  /** 三項（1 局単位）の Elo。参考値 */
  trinomialElo: EloDiffResult;
  /** 三項 SPRT。参考値（SPRT 無効時は null） */
  sprtTrinomial: SPRTState | null;
  /** ペア統計（sprt はペア LLR による判定＝停止に使う） */
  paired: PairedStats;
  /** 停止判定（= paired.sprt.decision。SPRT 無効時は continue） */
  sprtDecision: SPRTDecision;
}

/** push に必要な最小限の対局情報（CommitGameResult のサブセット）。 */
export interface MatchStatsGame {
  pairId?: string;
  jushuName: string;
  isABlack: boolean;
  winner: "A" | "B" | "draw";
}

export class MatchStatsTracker {
  private readonly wdl: WDLCount = { wins: 0, draws: 0, losses: 0 };
  private readonly games: PairableGame[] = [];
  private readonly sprtConfig: SPRTConfig | null;

  constructor(sprtConfig: SPRTConfig | null) {
    this.sprtConfig = sprtConfig;
  }

  /** 1 局を加えて更新後のスナップショットを返す。 */
  push(game: MatchStatsGame): MatchStatsSnapshot {
    switch (game.winner) {
      case "A":
        this.wdl.wins++;
        break;
      case "B":
        this.wdl.losses++;
        break;
      default:
        this.wdl.draws++;
    }
    this.games.push({
      pairId: game.pairId ?? game.jushuName,
      isABlack: game.isABlack,
      winner: game.winner,
    });
    return this.snapshot();
  }

  /** 現在の統計。 */
  snapshot(): MatchStatsSnapshot {
    const wdl = { ...this.wdl };
    const paired = computePairedStats(this.games, this.sprtConfig);
    return {
      wdl,
      trinomialElo: estimateEloDiff(wdl),
      sprtTrinomial: this.sprtConfig ? updateSPRT(wdl, this.sprtConfig) : null,
      paired,
      sprtDecision: paired.sprt?.decision ?? "continue",
    };
  }
}
