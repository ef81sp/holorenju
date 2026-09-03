/**
 * WDL（勝敗引分）カウントの生成・加算（SSoT）。
 * 勝者は常に A 視点（commitA / baseline）。
 */
import type { WDLCount } from "../types/ab.ts";

export type GameWinner = "A" | "B" | "draw";

export function createWdl(): WDLCount {
  return { wins: 0, draws: 0, losses: 0 };
}

/** 1 局の勝者を wdl に加算する（破壊的）。 */
export function addResultToWdl(wdl: WDLCount, winner: GameWinner): void {
  switch (winner) {
    case "A":
      wdl.wins++;
      break;
    case "B":
      wdl.losses++;
      break;
    default:
      wdl.draws++;
  }
}

/** games の勝者列から WDL を作る。 */
export function wdlFromWinners(winners: Iterable<GameWinner>): WDLCount {
  const wdl = createWdl();
  for (const w of winners) {
    addResultToWdl(wdl, w);
  }
  return wdl;
}
