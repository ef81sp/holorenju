<script setup lang="ts">
/**
 * CPU対戦振り返り画面
 *
 * 棋譜を手順ごとに再生し、各手の評価をフブキのコメント付きで表示
 */

import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import SettingsControl from "@/components/common/SettingsControl.vue";
import GamePlayerLayout from "@/components/common/GamePlayerLayout.vue";
import DialogText from "@/components/common/DialogText.vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import ReviewControls from "./ReviewControls.vue";
import ReviewStatus from "./ReviewStatus.vue";
import ReviewEvalPanel from "./ReviewEvalPanel.vue";
import { useReviewEvaluator } from "./composables/useReviewEvaluator";
import { useReviewDialogue } from "./composables/useReviewDialogue";
import { useReviewBoardOverlay } from "./composables/useReviewBoardOverlay";
import { buildEvaluatedMove } from "@/logic/reviewLogic";
import { useAppStore } from "@/stores/appStore";
import { useCpuReviewStore } from "@/stores/cpuReviewStore";
import { useCpuRecordStore } from "@/stores/cpuRecordStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useBoardStore } from "@/stores/boardStore";
import type { Position } from "@/types/game";

const appStore = useAppStore();
const boardStore = useBoardStore();
const reviewStore = useCpuReviewStore();
const cpuRecordStore = useCpuRecordStore();
const dialogStore = useDialogStore();

const layoutRef = ref<InstanceType<typeof GamePlayerLayout> | null>(null);

// Composables
const evaluator = useReviewEvaluator();
const dialogue = useReviewDialogue();
const overlay = useReviewBoardOverlay();

// 初期化
onMounted(() => {
  // 対戦画面から遷移した場合、boardStoreに残っている石をクリア
  boardStore.resetBoard();

  const recordId = appStore.reviewRecordId;
  if (!recordId) {
    appStore.goToCpuSetup();
    return;
  }

  const record = cpuRecordStore.records.find((r) => r.id === recordId);
  if (!record?.moveHistory) {
    appStore.goToCpuSetup();
    return;
  }

  reviewStore.openReview(record);
  dialogue.showInitialDialogue();

  // キャッシュがなければ評価を開始
  if (reviewStore.evaluatedMoves.length === 0) {
    startEvaluation();
  }

  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  evaluator.cancel();
  reviewStore.closeReview();
  dialogStore.reset();
});

// 評価を開始
async function startEvaluation(): Promise<void> {
  const record = reviewStore.currentRecord;
  if (!record?.moveHistory) {
    return;
  }

  reviewStore.isEvaluating = true;
  dialogue.showEvaluatingDialogue();

  const { moveHistory } = record;
  const results = await evaluator.evaluate(moveHistory, record.playerFirst);

  // 結果を変換
  const evaluated = results.map((r) =>
    buildEvaluatedMove(r, moveHistory, record.playerFirst),
  );

  reviewStore.setEvaluationResults(evaluated);
  reviewStore.isEvaluating = false;

  const accuracy = reviewStore.playerAccuracy;
  dialogue.showEvaluationCompleteDialogue(accuracy ?? 100);
}

// 評価進捗を同期
watch(
  () => evaluator.progress.value,
  (val) => {
    reviewStore.evaluationProgress = val;
  },
);

// 手数変更時にセリフを更新・プレビューをクリア
watch(
  () => reviewStore.currentMoveIndex,
  () => {
    overlay.clearPreview();

    const evaluation = reviewStore.currentEvaluation;
    if (evaluation?.isPlayerMove) {
      dialogue.showQualityDialogue(evaluation.quality, evaluation.bestMove);
    } else if (evaluation) {
      dialogue.clearDialogue();
    }
  },
);

// 現在の手の位置（CPU手の座標表示用）
const currentMovePosition = computed<Position | null>(() => {
  if (reviewStore.currentMoveIndex === 0) {
    return null;
  }
  const move = reviewStore.moves[reviewStore.currentMoveIndex - 1];
  return move?.position ?? null;
});

// キーボード操作
function handleKeyDown(event: KeyboardEvent): void {
  switch (event.key) {
    case "ArrowLeft":
      event.preventDefault();
      reviewStore.prevMove();
      break;
    case "ArrowRight":
      event.preventDefault();
      reviewStore.nextMove();
      break;
    case "Home":
      event.preventDefault();
      reviewStore.goToStart();
      break;
    case "End":
      event.preventDefault();
      reviewStore.goToEnd();
      break;
    case "Escape":
      event.preventDefault();
      handleBack();
      break;
    default:
      break;
  }
}

// 戻る
function handleBack(): void {
  appStore.goToCpuSetup();
}
</script>

<template>
  <div class="cpu-review-player">
    <GamePlayerLayout ref="layoutRef">
      <template #back-button>
        <button
          class="back-button"
          @click="handleBack"
        >
          ← 戻る
        </button>
      </template>

      <template #header-controls>
        <SettingsControl />
      </template>

      <template #control-info>
        <div class="control-info-content">
          <ReviewStatus
            v-if="reviewStore.currentRecord"
            :is-evaluating="evaluator.isEvaluating.value"
            :completed-count="evaluator.completedCount.value"
            :total-count="evaluator.totalCount.value"
            :accuracy="reviewStore.playerAccuracy"
            :critical-errors="reviewStore.criticalErrors"
            :difficulty="reviewStore.currentRecord.difficulty"
            :move-count="reviewStore.currentRecord.moves"
            :player-first="reviewStore.currentRecord.playerFirst"
            :move-history="reviewStore.currentRecord.moveHistory ?? null"
          />
          <ReviewControls
            :current-move-index="reviewStore.currentMoveIndex"
            :total-moves="reviewStore.moves.length"
            :evaluated-moves="reviewStore.evaluatedMoves"
            @go-to-move="reviewStore.goToMove"
            @go-to-start="reviewStore.goToStart"
            @go-to-end="reviewStore.goToEnd"
            @prev-move="reviewStore.prevMove"
            @next-move="reviewStore.nextMove"
          />
        </div>
      </template>

      <template #board="{ boardSize }">
        <RenjuBoard
          :disabled="true"
          :stage-size="boardSize"
          :board-state="overlay.displayBoardState.value"
          :marks="overlay.displayMarks.value"
          :stone-labels="overlay.stoneLabels.value"
        />
      </template>

      <template #info>
        <ReviewEvalPanel
          :evaluation="reviewStore.currentEvaluation ?? null"
          :move-index="reviewStore.currentMoveIndex"
          :current-position="currentMovePosition"
          @hover-candidate="overlay.handleHoverCandidate"
          @leave-candidate="overlay.handleLeaveCandidate"
          @hover-pv-move="overlay.handleHoverPVMove"
          @leave-pv-move="overlay.handleLeavePVMove"
          @show-pv-line="overlay.handleShowPvLine"
          @hide-pv-line="overlay.handleHidePvLine"
        />
      </template>

      <template #dialog>
        <div
          v-if="dialogStore.currentMessage"
          class="character-dialog"
        >
          <div
            class="dialog-avatar"
            :style="{ backgroundColor: 'var(--color-fubuki-bg)' }"
          >
            <CharacterSprite
              character="fubuki"
              :emotion-id="dialogue.currentEmotion.value"
              :is-active="true"
            />
          </div>
          <div
            class="dialog-bubble"
            :style="{ borderColor: 'var(--color-fubuki-primary)' }"
          >
            <div
              class="dialog-character-name"
              :style="{ color: 'var(--color-fubuki-primary)' }"
            >
              フブキ
            </div>
            <div class="dialog-text-wrapper">
              <DialogText :nodes="dialogStore.currentMessage.text" />
            </div>
          </div>
        </div>
      </template>
    </GamePlayerLayout>
  </div>
</template>

<style scoped>
.cpu-review-player {
  width: 100%;
  height: 100%;

  /* 右パネルを縦ぶち抜き（4×9）にしてスクロール回避 */
  :deep(.info-section-slot) {
    grid-row: 1 / -1;
  }

  :deep(.dialog-section-slot) {
    grid-column: 1 / span 2;
  }
}

.back-button {
  width: fit-content;
  padding: var(--size-10) var(--size-20);
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--size-16);
  font-weight: 500;
  transition: all 0.2s;
}

.back-button:hover {
  background: #f5f5f5;
  border-color: #4a9eff;
}

.control-info-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
  flex: 1;
  min-height: 0;
}

.character-dialog {
  display: grid;
  grid-template-columns: 4fr 8fr;
  gap: var(--size-12);
  align-items: stretch;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: clip;
}

.dialog-avatar {
  grid-column: 1;
  justify-self: end;
  align-self: flex-start;
  height: calc(100% - var(--size-8));
  aspect-ratio: 1;
  border-radius: var(--size-8);
  border: var(--size-2) solid var(--color-border);
  box-shadow: 0 var(--size-5) var(--size-5) rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.dialog-bubble {
  grid-column: 2;
  height: 100%;
  padding: var(--size-8);
  background: white;
  border-radius: var(--size-12);
  border: var(--size-2) solid;
  box-shadow: 0 var(--size-5) var(--size-8) rgba(0, 0, 0, 0.1);
  position: relative;
}

.dialog-character-name {
  font-weight: 500;
  font-size: var(--size-14);
}

.dialog-text-wrapper {
  font-size: calc(var(--size-16) * var(--text-size-multiplier));
}
</style>
