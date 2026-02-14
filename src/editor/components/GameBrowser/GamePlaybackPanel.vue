<script setup lang="ts">
import { computed, ref } from "vue";
import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import type { StoneLabel } from "@/components/game/RenjuBoard/RenjuBoard.vue";
import { boardStateToStringArray } from "@/editor/logic/boardCalculator";
import type { BoardState } from "@/types/game";
import type { GameAnalysis, MoveAnalysis } from "@scripts/types/analysis";

interface Props {
  game: GameAnalysis;
  boardState: BoardState;
  moveIndex: number;
  totalMoves: number;
  currentMoveAnalysis: MoveAnalysis | null;
  stoneLabels: Map<string, StoneLabel>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  first: [];
  prev: [];
  next: [];
  last: [];
  "go-to-move": [n: number];
}>();

const copyLabel = ref("📋 盤面コピー");

const handleCopyBoard = async (): Promise<void> => {
  const text = boardStateToStringArray(props.boardState).join("\n");
  await navigator.clipboard.writeText(text);
  copyLabel.value = "✓ コピー済み";
  setTimeout(() => {
    copyLabel.value = "📋 盤面コピー";
  }, 1500);
};

const moveInfo = computed(() => {
  const move = props.currentMoveAnalysis;
  if (!move) {
    return "初期盤面";
  }
  const color = move.color === "black" ? "黒" : "白";
  return `${props.moveIndex}手目: ${color} ${move.notation}`;
});

const moveTags = computed(() => {
  const move = props.currentMoveAnalysis;
  if (!move || move.tags.length === 0) {
    return "";
  }
  return move.tags.join(", ");
});

const gameRecordUpToMove = computed(() => {
  const moves = props.game.moves.slice(0, props.moveIndex);
  return moves.map((m: { notation: string }) => m.notation).join(" ");
});
</script>

<template>
  <div class="game-playback-panel">
    <div class="board-area">
      <RenjuBoard
        :board-state="boardState"
        :disabled="true"
        :stage-size="340"
        :stone-labels="stoneLabels"
      />
    </div>

    <div class="controls">
      <div class="move-info">{{ moveInfo }}</div>
      <div
        v-if="moveTags"
        class="move-tags"
      >
        {{ moveTags }}
      </div>

      <div class="nav-buttons">
        <button
          :disabled="moveIndex === 0"
          @click="emit('first')"
        >
          ⏮
        </button>
        <button
          :disabled="moveIndex === 0"
          @click="emit('prev')"
        >
          ◀
        </button>
        <input
          type="range"
          :min="0"
          :max="totalMoves"
          :value="moveIndex"
          class="move-slider"
          @input="
            emit(
              'go-to-move',
              Number(($event.target as HTMLInputElement).value),
            )
          "
        />
        <button
          :disabled="moveIndex >= totalMoves"
          @click="emit('next')"
        >
          ▶
        </button>
        <button
          :disabled="moveIndex >= totalMoves"
          @click="emit('last')"
        >
          ⏭
        </button>
      </div>

      <div class="move-counter">{{ moveIndex }} / {{ totalMoves }}</div>

      <div class="game-record">
        <label>棋譜:</label>
        <div class="record-text">{{ gameRecordUpToMove || "(空)" }}</div>
      </div>

      <button
        class="copy-button"
        @click="handleCopyBoard"
      >
        {{ copyLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.game-playback-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  align-items: center;
}

.board-area {
  flex-shrink: 0;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  align-items: center;
}

.move-info {
  font-size: 14px;
  font-weight: 500;
}

.move-tags {
  font-size: 11px;
  color: #666;
  background: #f5f5f5;
  padding: 2px 8px;
  border-radius: 3px;
}

.nav-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.nav-buttons button {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: white;
  cursor: pointer;
  font-size: 14px;
}

.nav-buttons button:hover:not(:disabled) {
  background: #f0f0f0;
}

.nav-buttons button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.move-slider {
  flex: 1;
  min-width: 0;
}

.move-counter {
  font-size: 12px;
  color: #666;
}

.game-record {
  width: 100%;
  font-size: 11px;
}

.game-record label {
  font-weight: 500;
  color: #666;
}

.record-text {
  font-family: monospace;
  font-size: 11px;
  background: #f9f9f9;
  padding: 4px 6px;
  border: 1px solid #eee;
  border-radius: 3px;
  max-height: 40px;
  overflow-y: auto;
  word-break: break-all;
}

.copy-button {
  width: 100%;
  padding: 8px;
  background: #4a90e2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.copy-button:hover {
  opacity: 0.9;
}
</style>
