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
  ForcedWinNode,
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
} from "@/types/review";

import { createBoardFromRecord, parseMove } from "@/logic/gameRecordParser";

import type { WasmModuleContext } from "./wasm/types";

import { isWithinBookRange } from "./bookGate";
import { countStones } from "./core/boardUtils";
// 注釈専用API（isBookMove）のみを import する。着手API（getBookMove）は
// import しない（opening-book-2026-07-16.md §3: 振り返りの着手選択には
// ブックを使わない構造を保つ）。
import { isBookMove, preloadOpeningBook } from "./openingBook";
import { FORCED_LOSS_VCT_OPTIONS } from "./review/forcedLossCheck";
import { detectForcedWin } from "./review/forcedWinDetection";
import { executeFullEval } from "./review/fullEval";
import { wasmFindVCTSequenceStrict } from "./review/wasmAdapters";
import { VCT_STONE_THRESHOLD } from "./search/types";
import { preloadForbiddenWasm } from "./wasm/forbiddenAdapter";
import { loadWasmModule } from "./wasm/loader";
import { WasmSearchEngine } from "./wasm/searchEngine";
// #37 P3 PR4: 脅威検出も Zig 単一ソース経由に。#43 PR-6 で pure-wasm 化（フォールバックなし）。
import { detectOpponentThreats, preloadThreatWasm } from "./wasm/threatAdapter";

/** WASM モジュール（初回ロード後にキャッシュ） */
let cachedWasm: WasmModuleContext | null = null;

async function getWasmModule(): Promise<WasmModuleContext> {
  if (cachedWasm) {
    return cachedWasm;
  }
  // #43 PR-6: 判定アダプタは pure-wasm 化済み。threat（四/活三/ミセ）と forbidden（禁手）の
  // 両 thin wasm を mount/利用前に await でロードする（フォールバックが無いため必須）。
  cachedWasm = await loadWasmModule();
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
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
      let forcedLossTree: ForcedWinNode | undefined = undefined;
      if (
        !selfHasFour &&
        (skipStoneThreshold || stoneCountAfter >= VCT_STONE_THRESHOLD)
      ) {
        // 被詰み判定なので strict（幻の被詰みを棄却。forcedLossCheck.ts と同じ理由）
        const oppVCT = wasmFindVCTSequenceStrict(
          searchEngine,
          boardAfter,
          opponentColor,
          FORCED_LOSS_VCT_OPTIONS,
        );
        if (oppVCT) {
          forcedLossType = oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct";
          forcedLossSequence = oppVCT.sequence;
          forcedLossTree = oppVCT.tree;
        }
      }

      const response: VCTCheckResult = {
        mode: "vctCheck",
        moveIndex,
        forcedLossType,
        forcedLossSequence,
        forcedLossTree,
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

    // オープニングブック注釈（§3）: 着手選択には使わない。打たれた手が
    // ブック手（対象は白番 ply4〜8・黒番 ply5〜7）と一致するかどうかだけを判定する。
    const moveColor = moveIndex % 2 === 0 ? "black" : "white";
    let isBookMoveAnnotation: boolean | undefined = undefined;
    if (isWithinBookRange(moveColor, moveIndex) && moves[moveIndex]) {
      await preloadOpeningBook();
      const { board: boardBeforeMove } = createBoardFromRecord(
        moves.slice(0, moveIndex).join(" "),
      );
      const played = parseMove(moves[moveIndex]!);
      isBookMoveAnnotation = isBookMove(boardBeforeMove, moveColor, played);
    }

    // timings は Worker の結果には不要なので除外
    const { timings: _timings, ...response } = result;
    self.postMessage({
      ...response,
      isBookMove: isBookMoveAnnotation,
    } as FullEvalResult);
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
