/**
 * replay-hang が bridge worker に渡す workerData を、ダンプの engineParams から組み立てる。
 *
 * **engineParams が権威**（ready 通知でその worker が自己申告した解決済みパラメータ）。
 * timeLimit / maxNodes / depth / deterministic を全て復元しないと、固定ノード
 * （決定的）モードで起きたハングを 10 s 時間モードで再生してしまい「再現せず」と
 * 誤結論する（bench-fixed-nodes-2026-09-06.md §2.5 replay-hang）。
 * v1 ダンプ・engineParams 欠落時はダンプのトップレベル情報でフォールバックする。
 */
import type { EngineParamsSnapshot } from "./workerTelemetry.ts";

import { type BridgeCustomParams, buildBridgeCustomParams } from "./match.ts";
import {
  type LivenessChannel,
  createLivenessChannel,
} from "./workerLiveness.ts";

/** ダンプの worker セクションのうち、フォールバックに使う項目。 */
export interface ReplayDumpWorker {
  worktreePath: string;
  difficulty: string;
  randomFactor: number | undefined;
  evaluationOptions: Record<string, unknown> | undefined;
  bookEnabled: boolean;
}

/** cpu-bridge-worker.ts の BridgeWorkerData と同じ形（型の循環を避けて再定義）。 */
export interface ReplayWorkerData {
  worktreePath: string;
  difficulty: string;
  customParams: BridgeCustomParams | undefined;
  bookEnabled: boolean;
  threatProbeEnabled: boolean | undefined;
  livenessChannel: LivenessChannel;
}

export function buildReplayWorkerData(
  dumpWorker: ReplayDumpWorker,
  engineParams: EngineParamsSnapshot | undefined,
): ReplayWorkerData {
  const customParams = buildBridgeCustomParams({
    randomFactor: engineParams?.randomFactor ?? dumpWorker.randomFactor,
    evaluationOptions:
      (engineParams?.evaluationOptions as
        | Record<string, unknown>
        | undefined) ?? dumpWorker.evaluationOptions,
    maxNodes: engineParams?.maxNodes,
    maxDepth: engineParams?.depth,
    timeLimit: engineParams?.timeLimit,
    // 旧 bridge worker では欠落（= 時間モード）。true のときだけ写す
    deterministic: engineParams?.deterministic ? true : undefined,
  });
  return {
    worktreePath: dumpWorker.worktreePath,
    difficulty: engineParams?.difficulty ?? dumpWorker.difficulty,
    customParams,
    bookEnabled: engineParams?.bookEnabled ?? dumpWorker.bookEnabled,
    // engineParams.threatProbe は "ON(default)" / "OFF(runtime)" などの表示文字列。
    // OFF で走っていたときだけ明示的に無効化する。
    threatProbeEnabled: engineParams?.threatProbe.startsWith("OFF")
      ? false
      : undefined,
    livenessChannel: createLivenessChannel(),
  };
}
