<script setup lang="ts">
/**
 * CPU対戦画面
 *
 * ScenarioPlayerと同じグリッドレイアウトを使用
 * CPUはWeb Worker経由で非同期実行してUIブロッキングを回避
 */

import { computed, onMounted, onUnmounted, ref } from "vue";

import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import CutinOverlay from "@/components/common/CutinOverlay.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import SettingsControl from "@/components/common/SettingsControl.vue";
import GamePlayerLayout from "@/components/common/GamePlayerLayout.vue";
import DialogText from "@/components/common/DialogText.vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import CpuGameStatus from "./CpuGameStatus.vue";
import CpuCharacterPanel from "./CpuCharacterPanel.vue";
import CpuRecordDialog from "./CpuRecordDialog.vue";
import CpuDebugInfo from "./CpuDebugInfo.vue";
import { useCpuPlayer } from "./composables/useCpuPlayer";
import { useCpuDialogue } from "./composables/useCpuDialogue";
import { useForbiddenMark } from "./composables/useForbiddenMark";
import { useCutinDisplay } from "@/composables/useCutinDisplay";
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
const { isThinking, lastResponse, requestMove } = useCpuPlayer();

// セリフ・表情管理
const { cpuCharacter, currentEmotion, showDialogue, initCharacter } =
  useCpuDialogue();

// 禁手マーク表示
const { showForbiddenMark, clearForbiddenMark } = useForbiddenMark();

// 対戦記録ダイアログ
const recordDialogRef = ref<InstanceType<typeof CpuRecordDialog> | null>(null);

// レイアウトコンポーネントの参照
const layoutRef = ref<InstanceType<typeof GamePlayerLayout> | null>(null);

// カットイン
const cutinRef = ref<InstanceType<typeof CutinOverlay> | null>(null);
const cutinType = ref<"correct" | "wrong">("correct");
const { isCutinVisible, showCutin, hideCutin } = useCutinDisplay(cutinRef);

// 戻る確認ダイアログ
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

// キーボードイベント処理
function handleKeyDown(event: KeyboardEvent): void {
  // カットイン表示中のキースキップはcomposableが処理するためスキップ
  if (isCutinVisible.value) {
    return;
  }

  // Escキーで戻る確認ダイアログを表示
  if (event.key === "Escape") {
    event.preventDefault();
    showBackConfirmDialog();
  }
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
  showCutin(cutinType.value);
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
    hideCutin();

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
    <GamePlayerLayout ref="layoutRef">
      <template #back-button>
        <button
          class="back-button"
          @click="showBackConfirmDialog"
        >
          ← 戻る
        </button>
      </template>

      <template #header-controls>
        <SettingsControl />
      </template>

      <template #control-info>
        <CpuGameStatus :is-thinking="isThinking" />
      </template>

      <template #board="{ boardSize }">
        <RenjuBoard
          :disabled="isBoardDisabled"
          :stage-size="boardSize"
          :player-color="playerColor"
          :board-state="boardStore.board"
          @place-stone="handlePlaceStone"
        />
        <CutinOverlay
          ref="cutinRef"
          :type="cutinType"
          :anchor="'board-anchor'"
        />
      </template>

      <template #info>
        <div class="info-content">
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

          <!-- CPUデバッグ情報 -->
          <CpuDebugInfo
            v-if="preferencesStore.showCpuInfo"
            :response="lastResponse"
          />

          <!-- ゲーム終了時のメッセージ -->
          <div
            v-if="cpuGameStore.isGameOver"
            class="game-result"
          >
            <p class="result-message">{{ gameEndMessage }}</p>
            <p class="result-moves">{{ cpuGameStore.moveCount }}手</p>
          </div>
        </div>
      </template>

      <template #dialog>
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
      </template>
    </GamePlayerLayout>

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

.info-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-16);
  padding: var(--size-12);
  height: 100%;
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
  margin-top: auto;
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
