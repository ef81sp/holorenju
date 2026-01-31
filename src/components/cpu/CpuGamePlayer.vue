<script setup lang="ts">
/**
 * CPU対戦画面
 *
 * ScenarioPlayerと同じグリッドレイアウトを使用
 * AIはWeb Worker経由で非同期実行してUIブロッキングを回避
 */

import { computed, onMounted, onUnmounted, ref } from "vue";

import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import CutinOverlay from "@/components/common/CutinOverlay.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import SettingsControl from "@/components/common/SettingsControl.vue";
import DialogText from "@/components/common/DialogText.vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import CpuGameStatus from "./CpuGameStatus.vue";
import CpuCharacterPanel from "./CpuCharacterPanel.vue";
import CpuRecordDialog from "./CpuRecordDialog.vue";
import { useCpuPlayer } from "./composables/useCpuPlayer";
import { useCpuDialogue } from "./composables/useCpuDialogue";
import { useForbiddenMark } from "./composables/useForbiddenMark";
import { useBoardSize } from "@/components/scenarios/ScenarioPlayer/composables/useBoardSize";
import { useAppStore } from "@/stores/appStore";
import { useCpuGameStore } from "@/stores/cpuGameStore";
import { useCpuRecordStore } from "@/stores/cpuRecordStore";
import { useBoardStore } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { checkForbiddenMove } from "@/logic/renjuRules";
import type { BattleResult } from "@/types/cpu";
import type { Position } from "@/types/game";

const appStore = useAppStore();
const cpuGameStore = useCpuGameStore();
const cpuRecordStore = useCpuRecordStore();
const boardStore = useBoardStore();
const dialogStore = useDialogStore();
const preferencesStore = usePreferencesStore();

// CPU Player (Web Worker経由)
const { isThinking, requestMove } = useCpuPlayer();

// セリフ・表情管理
const { cpuCharacter, currentEmotion, showDialogue, initCharacter } =
  useCpuDialogue();

// 禁手マーク表示
const { showForbiddenMark, clearForbiddenMark } = useForbiddenMark();

// 対戦記録ダイアログ
const recordDialogRef = ref<InstanceType<typeof CpuRecordDialog> | null>(null);

// 盤面サイズ計算用
const boardFrameRef = ref<HTMLElement | null>(null);
const { boardSize: boardSizeValue } = useBoardSize(boardFrameRef);
const boardSize = computed(() => boardSizeValue.value);

// カットイン
const cutinRef = ref<InstanceType<typeof CutinOverlay> | null>(null);
const cutinType = ref<"correct" | "wrong">("correct");
const isCutinVisible = ref(false);
let cutinAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

// 戻る確認ダイアログ
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

// キーボードイベント処理
function handleKeyDown(event: KeyboardEvent): void {
  // カットイン表示中は任意キーでスキップ
  if (isCutinVisible.value) {
    event.stopPropagation();
    event.preventDefault();
    hideCutin();
    return;
  }

  // Escキーで戻る確認ダイアログを表示
  if (event.key === "Escape") {
    event.preventDefault();
    showBackConfirmDialog();
  }
}

// カットインを表示
function showCutin(): void {
  if (!cutinRef.value) {
    return;
  }

  // 既存のタイマーをクリア
  if (cutinAutoHideTimer) {
    clearTimeout(cutinAutoHideTimer);
    cutinAutoHideTimer = null;
  }

  isCutinVisible.value = true;
  cutinRef.value.showPopover();

  // 自動消滅タイマーを設定（秒→ミリ秒に変換）
  const durationMs = preferencesStore.cutinDisplayDuration * 1000;
  cutinAutoHideTimer = setTimeout(() => {
    hideCutin();
  }, durationMs);
}

// カットインを非表示
function hideCutin(): void {
  if (!isCutinVisible.value) {
    return;
  }

  if (cutinAutoHideTimer) {
    clearTimeout(cutinAutoHideTimer);
    cutinAutoHideTimer = null;
  }

  if (cutinRef.value) {
    cutinRef.value.hidePopover();
  }

  isCutinVisible.value = false;
}

// ゲーム開始
onMounted(() => {
  if (appStore.cpuDifficulty && appStore.cpuPlayerFirst !== null) {
    cpuGameStore.startGame(appStore.cpuDifficulty, appStore.cpuPlayerFirst);

    // キャラクター初期化とゲーム開始セリフ
    initCharacter(appStore.cpuDifficulty);
    showDialogue("gameStart");

    // 後手の場合はCPUが最初に打つ
    if (!appStore.cpuPlayerFirst) {
      cpuMove();
    }
  }

  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);

  // カットインタイマーをクリア
  if (cutinAutoHideTimer) {
    clearTimeout(cutinAutoHideTimer);
    cutinAutoHideTimer = null;
  }

  // セリフをクリア
  dialogStore.reset();
});

// プレイヤーの石色
const playerColor = computed(() => cpuGameStore.playerColor);

// 盤面無効化
const isBoardDisabled = computed(
  () =>
    cpuGameStore.isGameOver ||
    !cpuGameStore.isPlayerTurn ||
    isThinking.value ||
    isCutinVisible.value,
);

// プレイヤーの着手処理
function handlePlaceStone(position: Position): void {
  if (isBoardDisabled.value) {
    return;
  }

  // 黒番の場合は禁手チェック
  if (cpuGameStore.currentTurn === "black") {
    const forbidden = checkForbiddenMove(
      boardStore.board,
      position.row,
      position.col,
    );
    if (forbidden.isForbidden) {
      // 禁手位置にcrossマークを表示
      showForbiddenMark(position);
      return;
    }
  }

  // 既存の禁手マークをクリア
  clearForbiddenMark();

  // 石を配置
  cpuGameStore.addMove(position, cpuGameStore.currentTurn);

  // 勝敗判定
  if (cpuGameStore.isGameOver) {
    handleGameEnd();
    return;
  }

  // CPUの手番
  cpuMove();
}

// CPUの着手処理（Web Worker経由）
async function cpuMove(): Promise<void> {
  if (cpuGameStore.isGameOver) {
    return;
  }

  // 思考中セリフを表示
  showDialogue("cpuThinking");

  // 少し待ってからUI更新（思考開始を見せる）
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  // Worker経由でAIに着手をリクエスト
  const response = await requestMove(
    boardStore.board,
    cpuGameStore.currentTurn,
    cpuGameStore.difficulty,
  );

  // 石を配置
  cpuGameStore.addMove(response.position, cpuGameStore.currentTurn);

  // 勝敗判定
  if (cpuGameStore.isGameOver) {
    handleGameEnd();
  } else {
    // CPUが着手した後、プレイヤーの番
    showDialogue("cpuAdvantage");
  }
}

// ゲーム終了処理
function handleGameEnd(): void {
  const { winner } = cpuGameStore;
  let result: BattleResult = "draw";

  if (winner === null) {
    result = "draw";
  } else if (winner === cpuGameStore.playerColor) {
    result = "win";
    cutinType.value = "correct";
    showDialogue("playerWin");
  } else {
    result = "lose";
    cutinType.value = "wrong";
    showDialogue("cpuWin");
  }

  // 記録を保存
  cpuRecordStore.addRecord(
    cpuGameStore.difficulty,
    cpuGameStore.playerFirst,
    result,
    cpuGameStore.moveCount,
  );

  // カットイン表示（自動消滅タイマー付き）
  showCutin();
}

// 待った機能（2手戻す）
function handleUndo(): void {
  if (cpuGameStore.moveCount < 2 || isThinking.value) {
    return;
  }
  cpuGameStore.undoMoves(2);
}

// もう一度
function handleRematch(): void {
  if (appStore.cpuDifficulty && appStore.cpuPlayerFirst !== null) {
    cpuGameStore.startGame(appStore.cpuDifficulty, appStore.cpuPlayerFirst);
    clearForbiddenMark();
    isCutinVisible.value = false;

    // キャラクター初期化とゲーム開始セリフ
    initCharacter(appStore.cpuDifficulty);
    showDialogue("gameStart");

    // 後手の場合はCPUが最初に打つ
    if (!appStore.cpuPlayerFirst) {
      cpuMove();
    }
  }
}

// 戻る確認ダイアログを表示
function showBackConfirmDialog(): void {
  // ゲーム終了後は確認不要
  if (cpuGameStore.isGameOver) {
    handleConfirmBack();
    return;
  }
  confirmDialogRef.value?.showModal();
}

// 戻る確認
function handleConfirmBack(): void {
  cpuGameStore.resetGame();
  appStore.goToCpuSetup();
}

// ゲーム終了メッセージ
const gameEndMessage = computed(() => {
  if (!cpuGameStore.isGameOver) {
    return "";
  }
  if (cpuGameStore.winner === cpuGameStore.playerColor) {
    return "あなたの勝ち！";
  }
  if (cpuGameStore.winner === cpuGameStore.cpuColor) {
    return "CPUの勝ち...";
  }
  return "引き分け";
});
</script>

<template>
  <div class="cpu-game-player">
    <!-- 操作セクション（左上）-->
    <div class="control-section-slot">
      <div class="control-header">
        <button
          class="back-button"
          @click="showBackConfirmDialog"
        >
          ← 戻る
        </button>
        <div class="header-controls">
          <SettingsControl />
        </div>
      </div>
      <CpuGameStatus :is-thinking="isThinking" />
    </div>

    <!-- 盤面セクション（中央）-->
    <div
      id="board-anchor"
      ref="boardFrameRef"
      class="board-section-wrapper"
      style="anchor-name: --board-area"
      @click="isCutinVisible && hideCutin()"
    >
      <RenjuBoard
        :disabled="isBoardDisabled"
        :stage-size="boardSize"
        :player-color="playerColor"
        @place-stone="handlePlaceStone"
      />
      <CutinOverlay
        ref="cutinRef"
        :type="cutinType"
        :anchor="'board-anchor'"
      />
    </div>

    <!-- コントロールセクション（右側）-->
    <div class="info-section-slot">
      <!-- キャラクター表示 -->
      <CpuCharacterPanel
        :character="cpuCharacter"
        :emotion-id="currentEmotion"
      />

      <div class="game-controls">
        <button
          class="control-button"
          @click="recordDialogRef?.showModal()"
        >
          対戦記録
        </button>
        <button
          class="control-button"
          :disabled="cpuGameStore.moveCount < 2 || isThinking"
          @click="handleUndo"
        >
          待った
        </button>
        <button
          v-if="cpuGameStore.isGameOver"
          class="control-button primary"
          @click="handleRematch"
        >
          もう一度
        </button>
      </div>

      <!-- ゲーム終了時のメッセージ -->
      <div
        v-if="cpuGameStore.isGameOver"
        class="game-result"
      >
        <p class="result-message">{{ gameEndMessage }}</p>
        <p class="result-moves">{{ cpuGameStore.moveCount }}手</p>
      </div>
    </div>

    <!-- セリフ部（左下）-->
    <div class="dialog-section-slot">
      <div
        v-if="dialogStore.currentMessage"
        class="character-dialog"
      >
        <div
          class="dialog-avatar"
          :style="{
            backgroundColor:
              cpuCharacter === 'fubuki'
                ? 'var(--color-fubuki-bg)'
                : 'var(--color-miko-bg)',
          }"
        >
          <CharacterSprite
            :character="cpuCharacter"
            :emotion-id="currentEmotion"
            :is-active="true"
          />
        </div>
        <div
          class="dialog-bubble"
          :style="{
            borderColor:
              cpuCharacter === 'fubuki'
                ? 'var(--color-fubuki-primary)'
                : 'var(--color-miko-primary)',
          }"
        >
          <div
            class="dialog-character-name"
            :style="{
              color:
                cpuCharacter === 'fubuki'
                  ? 'var(--color-fubuki-primary)'
                  : 'var(--color-miko-primary)',
            }"
          >
            {{ cpuCharacter === "fubuki" ? "フブキ" : "みこ" }}
          </div>
          <div class="dialog-text-wrapper">
            <DialogText :nodes="dialogStore.currentMessage.text" />
          </div>
        </div>
      </div>
      <div
        v-else
        class="help-text"
      >
        <p v-if="!cpuGameStore.isGameOver && cpuGameStore.isPlayerTurn">
          盤面をクリックして石を置いてください
        </p>
        <p v-else-if="!cpuGameStore.isGameOver && !cpuGameStore.isPlayerTurn">
          CPUが考え中です...
        </p>
      </div>
    </div>

    <!-- 戻る確認ダイアログ -->
    <ConfirmDialog
      ref="confirmDialogRef"
      title="対局を中断しますか？"
      message="現在の対局を終了して、設定画面に戻ります。"
      confirm-text="戻る"
      cancel-text="続ける"
      @confirm="handleConfirmBack"
    />

    <!-- 対戦記録ダイアログ -->
    <CpuRecordDialog ref="recordDialogRef" />
  </div>
</template>

<style scoped>
.cpu-game-player {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 4fr 7fr 5fr;
  grid-template-rows: 7fr 2fr;
  padding: var(--size-14);
  gap: var(--size-14);
  box-sizing: border-box;
  position: relative;
}

.control-section-slot {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--size-12);
  overflow: hidden;
}

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: var(--size-8);
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

.board-section-wrapper {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.info-section-slot {
  grid-column: 3;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: var(--size-16);
  padding: var(--size-12);
}

.game-controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.control-button {
  padding: var(--size-12) var(--size-16);
  background: var(--color-background-secondary);
  border: 2px solid var(--color-border-light);
  border-radius: var(--size-8);
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
}

.control-button:hover:not(:disabled) {
  background: var(--color-background-hover);
  border-color: var(--color-primary);
}

.control-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.control-button.primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: transparent;
  color: white;
}

.control-button.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.game-result {
  margin-top: var(--size-16);
  padding: var(--size-16);
  background: var(--color-background-secondary);
  border-radius: var(--size-12);
  text-align: center;
}

.result-message {
  font-size: var(--size-20);
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 var(--size-8) 0;
}

.result-moves {
  font-size: var(--size-14);
  color: var(--color-text-secondary);
  margin: 0;
}

.dialog-section-slot {
  grid-column: 1 / 3;
  grid-row: 2;
  display: flex;
  align-items: center;
}

.help-text {
  padding: var(--size-12);
  background: var(--color-background-secondary);
  border-radius: var(--size-8);
  width: 100%;
}

.help-text p {
  margin: 0;
  font-size: var(--size-14);
  color: var(--color-text-secondary);
}

.character-dialog {
  display: flex;
  gap: var(--size-12);
  align-items: stretch;
  padding-block: var(--size-5);
  width: 100%;
  height: 100%;
}

.dialog-avatar {
  flex-shrink: 0;
  width: var(--size-100);
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
  flex: 1;
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
  font-size: calc(var(--size-20) * var(--text-size-multiplier));
}
</style>
