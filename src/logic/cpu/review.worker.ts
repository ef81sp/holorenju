/**
 * 振り返り評価用 Web Worker
 *
 * 1手を受け取り、その局面でhard準拠の探索を実行して評価結果を返す
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import ReviewWorker from './review.worker?worker'
 */

import type { Position } from "@/types/game";
import type {
  ForcedLossType,
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
} from "@/types/review";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import type { WasmModuleContext } from "./wasm/types";

import { countStones } from "./core/boardUtils";
import { detectOpponentThreats } from "./evaluation";
import { FORCED_LOSS_VCT_OPTIONS } from "./review/forcedLossCheck";
import { detectForcedWin } from "./review/forcedWinDetection";
import { executeFullEval } from "./review/fullEval";
import { wasmFindVCTSequence } from "./review/wasmAdapters";
import { VCT_STONE_THRESHOLD } from "./search/types";
import { loadWasmModule } from "./wasm/loader";
import { WasmSearchEngine } from "./wasm/searchEngine";

/** WASM モジュール（初回ロード後にキャッシュ） */
let cachedWasm: WasmModuleContext | null = null;

async function getWasmModule(): Promise<WasmModuleContext> {
  if (cachedWasm) {
    return cachedWasm;
  }
  cachedWasm = await loadWasmModule();
  return cachedWasm;
}

self.onmessage = async (event: MessageEvent<ReviewEvalRequest>) => {
  const {
    moveHistory,
    moveIndex,
    playerFirst: _playerFirst,
    isLightEval,
    vctCheckOnly,
    skipStoneThreshold,
    candidatePosition,
    preciseAnalysis,
  } = event.data;

  try {
    const wasm = await getWasmModule();
    const searchEngine = new WasmSearchEngine(wasm);
    const moves = moveHistory.trim().split(/\s+/);

    // Phase 2/3: VCTチェックのみ実行
    if (vctCheckOnly) {
      // candidatePosition 指定時: 実際の着手の代わりに候補手を置いた盤面を構築
      const boardRecord = candidatePosition
        ? moves.slice(0, moveIndex).join(" ")
        : moves.slice(0, moveIndex + 1).join(" ");
      const { board: boardAfter } = createBoardFromRecord(boardRecord);
      const color = moveIndex % 2 === 0 ? "black" : "white";
      if (candidatePosition) {
        const row = boardAfter[candidatePosition.row];
        if (row) {
          row[candidatePosition.col] = color;
        }
      }
      const opponentColor = color === "black" ? "white" : "black";
      const stoneCountAfter = countStones(boardAfter);

      // 自分に四があれば相手はVCT不可
      const selfThreats = detectOpponentThreats(boardAfter, color);
      const selfHasFour =
        selfThreats.fours.length > 0 || selfThreats.openFours.length > 0;

      let forcedLossType: ForcedLossType | undefined = undefined;
      let forcedLossSequence: Position[] | undefined = undefined;
      if (
        !selfHasFour &&
        (skipStoneThreshold || stoneCountAfter >= VCT_STONE_THRESHOLD)
      ) {
        const oppVCT = wasmFindVCTSequence(
          searchEngine,
          boardAfter,
          opponentColor,
          FORCED_LOSS_VCT_OPTIONS,
        );
        if (oppVCT) {
          forcedLossType = oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct";
          forcedLossSequence = oppVCT.sequence;
        }
      }

      const response: VCTCheckResult = {
        mode: "vctCheck",
        moveIndex,
        forcedLossType,
        forcedLossSequence,
      };
      self.postMessage(response);
      return;
    }

    // moveIndex時点の盤面を再構築（lightEval用に強制勝ち検出）
    if (isLightEval) {
      const { board, nextColor } = createBoardFromRecord(
        moves.slice(0, moveIndex).join(" "),
      );
      const color = nextColor as "black" | "white";
      const opponentColor = color === "black" ? "white" : "black";
      const opponentThreats = detectOpponentThreats(board, opponentColor);
      const opponentHasFour =
        opponentThreats.fours.length > 0 ||
        opponentThreats.openFours.length > 0;

      const { forcedWin, forcedWinType, doubleMiseBestMove } = detectForcedWin(
        board,
        color,
        opponentHasFour,
        true,
        searchEngine,
      );

      const response: LightEvalResult = {
        mode: "lightEval",
        moveIndex,
        bestMove: forcedWin?.firstMove ??
          doubleMiseBestMove ?? { row: 7, col: 7 },
        forcedWinType,
      };
      self.postMessage(response);
      return;
    }

    // fullEval: 共通ロジックに委譲
    const result = executeFullEval({
      moveHistory,
      moveIndex,
      preciseAnalysis,
      wasmSearchEngine: searchEngine,
    });

    // timings は Worker の結果には不要なので除外
    const { timings: _timings, ...response } = result;
    self.postMessage(response as FullEvalResult);
  } catch (error) {
    console.error("Review Worker error:", error);
    // エラー時はデフォルト結果を返す
    const response: FullEvalResult = {
      mode: "fullEval",
      moveIndex,
      bestMove: { row: 7, col: 7 },
      bestScore: 0,
      playedScore: 0,
      candidates: [],
      completedDepth: 0,
    };
    self.postMessage(response);
  }
};

export type {
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
};
