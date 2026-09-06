/**
 * gen-opening-suite.ts の worker プール（node:worker_threads）。
 *
 * worker は起動後に `{ ready: true }` を 1 回送り、以後は 1 リクエストにつき 1 レスポンスを
 * 返す約束。`next()` が null を返し、in-flight が 0 になった時点で全 worker を terminate
 * して resolve する（`next()` は「今は配るものが無い」ではなく「これ以上配らない」の
 * 意味で使うこと。null を返した後に再び非 null を返しても拾われない）。
 */
import { Worker } from "node:worker_threads";

export interface WorkerPoolOptions<Req, Res> {
  workerScript: string;
  workerData: unknown;
  workers: number;
  execArgv: string[];
  /** 次のリクエスト。これ以上配らないなら null */
  next: () => Req | null;
  onResult: (res: Res) => void;
}

export function runWorkerPool<Req, Res>(
  opts: WorkerPoolOptions<Req, Res>,
): Promise<void> {
  let inFlight = 0;
  return new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];
    const terminateAll = (): void => {
      for (const w of workers) {
        w.terminate();
      }
    };
    const dispatch = (w: Worker): void => {
      const req = opts.next();
      if (req === null) {
        if (inFlight === 0) {
          terminateAll();
          resolve();
        }
        return;
      }
      inFlight++;
      w.postMessage(req);
    };
    const attach = (w: Worker): void => {
      w.on("message", (msg: Res | { ready: true }) => {
        if (!(typeof msg === "object" && msg !== null && "ready" in msg)) {
          inFlight--;
          opts.onResult(msg as Res);
        }
        dispatch(w);
      });
      w.on("error", (err) => {
        terminateAll();
        reject(err);
      });
    };
    for (let i = 0; i < opts.workers; i++) {
      const w = new Worker(opts.workerScript, {
        workerData: opts.workerData,
        execArgv: opts.execArgv,
      });
      workers.push(w);
      attach(w);
    }
  });
}
