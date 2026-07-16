/**
 * trap-mining.ts のチェック粒度ワーカー（gate3 方式: worktree bridge を介さず、
 * このコードベースの WasmSearchEngine を直接ロードする。TT はワーカーインスタンス
 * 毎に独立するため共有ハザードなし）。
 *
 * メインプロセスが Phase1/2（ルートごとの white4/white6・攻め側フィルタ候補選定）を
 * 直列で行い、最終手番の直前局面まで進めた盤面をタスクとして本ワーカーに渡す。
 * 本ワーカーは「チェック粒度」= hard選択（side視点）+ VCF/VCT 強制勝ち判定 +
 * （必要なら）実機再検証ゲートのみを担当する（opening-trap-mining-2026-07-16.md
 * §4, §5）。white版（white8・side="white"）と black版（black7・side="black"、
 * ★第2段）を共通コードで扱う。
 */
import { parentPort } from "node:worker_threads";

import type { BoardState } from "@/types/game";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";

import { checkForcedWin, type Side } from "./lib/forcedWinCheck";
import { findSurvivorMoves } from "./lib/survivorMoves";

export interface CheckTask {
  taskId: number;
  /** このノードで hard が着手する側（white版=white8, black版=black7）。 */
  side: Side;
  /** side が着手する直前の局面。 */
  board: BoardState;
  /** 未指定なら実機 hard（DIFFICULTY_PARAMS.hard.timeLimit）をそのまま使う。 */
  hardTimeMs?: number;
  /**
   * true の場合、トラップ検出時（forcedWinKind 非null）にその場で生存手導出
   * まで実行する（opening-book-2026-07-16.md §1、最終手番ノード用）。
   */
  dumpBook?: boolean;
}

export interface CheckTaskResult {
  taskId: number;
  forcedWinKind: "VCF" | "VCT" | null;
  chosenMoveStr: string;
  forcedWinSequenceStr: string | null;
  /**
   * severity-A 確定に必要な実機再検証ゲートの結果。
   * hardTimeMs 未指定（=すでに実機 timeLimit）なら常に true。
   * hardTimeMs 指定時は、本番 timeLimit（undefined）で再実行し同じ手で
   * 強制勝ちが残る場合のみ true。
   */
  verifiedAtFullHardTime: boolean;
  /**
   * dumpBook=true かつトラップ検出時のみ非null（生存手導出結果）。
   * 空配列なら生存手ゼロ（彗星型）。dumpBook=false またはトラップなしなら null。
   */
  survivorMoves: string[] | null;
}

type WorkerRequest = CheckTask | { type: "shutdown" };

function isShutdown(msg: WorkerRequest): msg is { type: "shutdown" } {
  return "type" in msg && msg.type === "shutdown";
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error("trap-mining-worker はメインスレッドから起動できません");
  }

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  parentPort.postMessage({ ready: true });

  parentPort.on("message", (msg: WorkerRequest) => {
    if (isShutdown(msg)) {
      process.exit(0);
    }
    const task = msg;
    const result = checkForcedWin(
      engine,
      task.board,
      task.side,
      task.hardTimeMs,
    );

    let verifiedAtFullHardTime = task.hardTimeMs === undefined;
    if (!verifiedAtFullHardTime && result.forcedWinKind !== null) {
      const fullCheck = checkForcedWin(
        engine,
        task.board,
        task.side,
        undefined,
      );
      verifiedAtFullHardTime =
        fullCheck.forcedWinKind !== null &&
        fullCheck.chosenMoveStr === result.chosenMoveStr;
    }

    const survivorMoves =
      task.dumpBook === true && result.forcedWinKind !== null
        ? findSurvivorMoves(engine, task.board, task.side, result.chosenMove)
            .survivors
        : null;

    const response: CheckTaskResult = {
      taskId: task.taskId,
      forcedWinKind: result.forcedWinKind,
      chosenMoveStr: result.chosenMoveStr,
      forcedWinSequenceStr: result.forcedWinSequenceStr,
      verifiedAtFullHardTime,
      survivorMoves,
    };
    parentPort!.postMessage(response);
  });
}

main().catch((err: unknown) => {
  console.error("trap-mining-worker fatal error:", err);
  process.exit(1);
});
