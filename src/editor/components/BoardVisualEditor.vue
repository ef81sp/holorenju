<script setup lang="ts">
import { computed, ref } from "vue";
import RenjuBoard from "@/components/game/RenjuBoard.vue";
import { cycleBoardCell, boardToASCII } from "@/logic/scenarioFileHandler";
import type { Position, BoardState } from "@/types/game";

// Props
interface Props {
  board: string[];
  stageSize?: number;
}

const props = withDefaults(defineProps<Props>(), {
  stageSize: 400,
});

// Emits
const emit = defineEmits<{
  "update:board": [board: string[]];
}>();

// State
const showDebugInfo = ref(false);
const hoveredPosition = ref<Position | null>(null);

// Convert board string array to BoardState
const boardState = computed(() => {
  const state: (string | null)[][] = [];
  for (let row = 0; row < 15; row++) {
    state[row] = [];
    for (let col = 0; col < 15; col++) {
      const char = props.board[row]?.[col] ?? "-";
      if (char === "x") {
        state[row][col] = "black";
      } else if (char === "o") {
        state[row][col] = "white";
      } else {
        state[row][col] = null;
      }
    }
  }
  return state as unknown as BoardState;
});

// Debug info
const boardDebugText = computed(() => boardToASCII(props.board));

// Methods
const handleCellClick = (position: Position): void => {
  const newBoard = cycleBoardCell(props.board, position);
  emit("update:board", newBoard);
};

const handleReset = (): void => {
  const emptyBoard = Array(15).fill("-".repeat(15));
  emit("update:board", emptyBoard);
};

const handleLoadFromClipboard = async (): Promise<void> => {
  try {
    const text = await navigator.clipboard.readText();
    const lines = text.split("\n").filter((line) => line.trim());

    if (lines.length !== 15) {
      console.warn(`盤面は15行である必要があります。現在: ${lines.length}行`);
      return;
    }

    for (const line of lines) {
      if (line.length !== 15) {
        console.warn("各行は15文字である必要があります。");
        return;
      }
      if (!/^[-xo]{15}$/.test(line)) {
        console.warn(
          "無効な文字が含まれています。-(未指定), x(黒), o(白) のみ使用可能です。",
        );
        return;
      }
    }

    emit("update:board", lines);
  } catch (err) {
    console.error("クリップボードの読み取りに失敗しました", err);
  }
};

const handleCopyToClipboard = async (): Promise<void> => {
  try {
    const text = props.board.join("\n");
    await navigator.clipboard.writeText(text);
    console.warn("クリップボードにコピーしました");
  } catch (err) {
    console.error("クリップボードへのコピーに失敗しました", err);
  }
};

const handleHover = (position: Position | null): void => {
  hoveredPosition.value = position;
};
</script>

<template>
  <div class="board-visual-editor">
    <div class="editor-header">
      <h3>盤面エディタ</h3>
      <div class="editor-controls">
        <button
          class="btn-small"
          @click="handleLoadFromClipboard"
        >
          クリップボードから読み込み
        </button>
        <button
          class="btn-small"
          @click="handleCopyToClipboard"
        >
          クリップボードにコピー
        </button>
        <button
          class="btn-small btn-danger"
          @click="handleReset"
        >
          リセット
        </button>
        <button
          class="btn-small"
          @click="showDebugInfo = !showDebugInfo"
        >
          {{ showDebugInfo ? "デバッグ非表示" : "デバッグ表示" }}
        </button>
      </div>
    </div>

    <div class="editor-content">
      <div class="board-container">
        <RenjuBoard
          :board-state="boardState"
          :stage-size="stageSize"
          :allow-overwrite="true"
          @place-stone="handleCellClick"
          @hover-cell="handleHover"
        />
        <div class="board-info">
          <small>
            クリックで石を置く（e→黒→白→空のサイクル）
            <span v-if="hoveredPosition">| 座標: ({{ hoveredPosition.row }},
              {{ hoveredPosition.col }})</span>
          </small>
        </div>
      </div>

      <div
        v-if="showDebugInfo"
        class="debug-panel"
      >
        <h4>デバッグ情報</h4>
        <pre class="board-text">{{ boardDebugText }}</pre>
        <div class="board-code">
          <h5>盤面コード:</h5>
          <pre>{{ JSON.stringify(board, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board-visual-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background-color: var(--color-background-soft);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.editor-controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-small {
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  border: 1px solid var(--color-border);
  background-color: white;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-small:hover {
  background-color: var(--color-background-soft);
  border-color: var(--color-primary);
}

.btn-small.btn-danger {
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.btn-small.btn-danger:hover {
  background-color: #ffe0e0;
}

.editor-content {
  display: flex;
  gap: 1rem;
}

.board-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.board-container :deep(.stage) {
  border: 2px solid var(--color-border);
  border-radius: 4px;
}

.board-info {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.debug-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background-color: #f5f5f5;
  border-radius: 4px;
  border: 1px solid #ddd;
  overflow-y: auto;
  max-height: 500px;
}

.debug-panel h4 {
  margin: 0;
  font-size: 0.95rem;
}

.debug-panel h5 {
  margin: 0.5rem 0 0.25rem 0;
  font-size: 0.85rem;
}

.board-text {
  font-family: monospace;
  font-size: 0.75rem;
  background-color: white;
  padding: 0.5rem;
  border-radius: 3px;
  border: 1px solid #ddd;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.board-code {
  flex: 1;
  overflow-y: auto;
}

.board-code pre {
  font-family: monospace;
  font-size: 0.75rem;
  background-color: white;
  padding: 0.5rem;
  border-radius: 3px;
  border: 1px solid #ddd;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 768px) {
  .editor-controls {
    flex-direction: column;
  }

  .editor-content {
    flex-direction: column;
  }

  .debug-panel {
    max-height: 300px;
  }
}
</style>
