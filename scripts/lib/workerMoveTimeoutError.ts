/**
 * askWorker（commit-game-runner）が move-request timeout を検知したときに
 * throw する低レベルエラー。上位（runCommitGame）が catch して盤面/履歴を
 * 添えた GameHangError に変換する。
 *
 * commit-game-runner.ts から切り出しているのは、max-classes-per-file lint を
 * 満たすためと、bench 以外の caller（将来の replay 用ハーネス等）から
 * 「単純な timeout として拾って再 raise しない」ケースにも使いたいため。
 */
import type { WorkerTelemetrySnapshot } from "./workerTelemetry.ts";

export class WorkerMoveTimeoutError extends Error {
  readonly requestId: number;
  readonly timeoutMs: number;
  readonly color: "black" | "white";
  readonly side: "A" | "B";
  /**
   * timeout を検知した**その瞬間**の worker 計測。
   * 上位で worker からレジストリを引き直すと、その間に届いた遅延応答で
   * pendingRequest が消えている可能性があるため、検知側でスナップショットを取る。
   */
  readonly telemetry: WorkerTelemetrySnapshot;

  constructor(params: {
    requestId: number;
    timeoutMs: number;
    color: "black" | "white";
    side: "A" | "B";
    telemetry: WorkerTelemetrySnapshot;
  }) {
    super(
      `Worker move request timed out (requestId=${params.requestId}, side=${params.side}, color=${params.color}, timeoutMs=${params.timeoutMs})`,
    );
    this.name = "WorkerMoveTimeoutError";
    this.requestId = params.requestId;
    this.timeoutMs = params.timeoutMs;
    this.color = params.color;
    this.side = params.side;
    this.telemetry = params.telemetry;
  }
}
