<script setup lang="ts">
/**
 * CPU対戦画面
 *
 * ScenarioPlayerと同じグリッドレイアウトを使用
 * CPUはWeb Worker経由で非同期実行してUIブロッキングを回避
 */

import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

import BackButton from "@/components/common/BackButton.vue";
import FeatureConfirmDialog from "@/components/common/FeatureConfirmDialog.vue";
import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import CutinOverlay from "@/components/common/CutinOverlay.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import SettingsControl from "@/components/common/SettingsControl.vue";
import GamePlayerLayout from "@/components/common/GamePlayerLayout.vue";
import DialogText from "@/components/common/DialogText.vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import CpuGameStatus from "./CpuGameStatus.vue";
import CpuCharacterPanel from "./CpuCharacterPanel.vue";
import CompactCharacterDialog from "@/components/character/CompactCharacterDialog.vue";
import CpuDebugInfo from "./CpuDebugInfo.vue";
import { useCpuPlayer } from "./composables/useCpuPlayer";
import { useCpuDialogue } from "./composables/useCpuDialogue";
import { useForbiddenMark } from "./composables/useForbiddenMark";
import { useBoardAnnouncer } from "@/composables/useBoardAnnouncer";
import { useCutinDisplay } from "@/composables/useCutinDisplay";
import { useKeyboardNavigation } from "@/composables/useKeyboardNavigation";
import { useAppStore } from "@/stores/appStore";
import { useCpuGameStore } from "@/stores/cpuGameStore";
import { useCpuRecordStore } from "@/stores/cpuRecordStore";
import { useBoardStore, type Mark } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useAudioStore } from "@/stores/audioStore";
import { checkForbiddenMove } from "@/logic/renjuRules";
import { formatMove } from "@/logic/gameRecordParser";
import type { BattleResult } from "@/types/cpu";
import type { Position } from "@/types/game";

const appStore = useAppStore();
const cpuGameStore = useCpuGameStore();
const cpuRecordStore = useCpuRecordStore();
const boardStore = useBoardStore();
const dialogStore = useDialogStore();
const preferencesStore = usePreferencesStore();
const audioStore = useAudioStore();

// CPU Player (Web Worker経由)
const { isThinking, lastResponse, requestMove } = useCpuPlayer();

// セリフ・表情管理
const { cpuCharacter, currentEmotion, showDialogue, initCharacter } =
  useCpuDialogue();

// 禁手マーク表示
const { showForbiddenMark, clearForbiddenMark } = useForbiddenMark();

// CPUの着手マークを宣言的に計算
// boardStore.marksには禁手マークが含まれるため、それと結合
const displayMarks = computed<Mark[]>(() => {
  const marks: Mark[] = [...boardStore.marks];

  // CPUの最後の着手位置があれば、circleマークを追加
  const cpuPos = cpuGameStore.lastCpuMovePosition;
  if (cpuPos) {
    marks.push({
      id: "cpu-last-move",
      positions: [cpuPos],
      markType: "circle",
      placedAtDialogueIndex: -2,
    });
  }

  return marks;
});

// レイアウトコンポーネントの参照
const layoutRef = ref<InstanceType<typeof GamePlayerLayout> | null>(null);

// カットイン
const cutinRef = ref<InstanceType<typeof CutinOverlay> | null>(null);
const cutinType = ref<"win" | "draw" | "lose">("win");
const { isCutinVisible, showCutin, hideCutin } = useCutinDisplay(cutinRef);

// 戻る確認ダイアログ
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

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

// キーボード操作（WASD + Space/Enter で石配置）

let boardAnnouncer: ReturnType<typeof useBoardAnnouncer> | undefined =
  undefined;
const keyboardNav = useKeyboardNavigation(
  () => handlePlaceStone({ ...keyboardNav.cursorPosition.value }),
  undefined,
  isBoardDisabled,
  () => boardAnnouncer?.announceCursorMove(),
);

// 盤面読み上げ（ARIAライブリージョン）
boardAnnouncer = useBoardAnnouncer({
  board: computed(() => boardStore.board),
  cursorPosition: keyboardNav.cursorPosition,
  isCursorActivated: keyboardNav.isCursorActivated,
});

// Escキー用の追加ハンドラー
function handleEscapeKey(event: KeyboardEvent): void {
  if (isCutinVisible.value) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    showBackConfirmDialog();
  }
}

// ゲーム開始
onMounted(async () => {
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

  await nextTick();
  const boardElement = layoutRef.value?.boardFrameRef;
  if (boardElement) {
    keyboardNav.attachKeyListener(boardElement);
    boardElement.focus({ focusVisible: false } as FocusOptions);
  }
  window.addEventListener("keydown", handleEscapeKey);

  // 盤面拡大確認ダイアログ
  if (
    !preferencesStore.largeBoardHasBeenAsked &&
    !preferencesStore.largeBoardEnabled
  ) {
    largeBoardConfirmRef.value?.showModal();
  }
});

onUnmounted(() => {
  keyboardNav.detachKeyListener();
  window.removeEventListener("keydown", handleEscapeKey);
  // セリフをクリア
  dialogStore.reset();
});

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

  // 禁手マークをクリア
  clearForbiddenMark();

  // 石を配置
  cpuGameStore.addMove(position, cpuGameStore.currentTurn);
  audioStore.playSfx("stone-place");
  boardAnnouncer?.announcePlayerMove(position);

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
    preferencesStore.fastCpuMove,
  );

  // 石を配置
  cpuGameStore.addMove(response.position, cpuGameStore.currentTurn);
  audioStore.playSfx("stone-place");
  boardAnnouncer?.announceCpuMove(response.position);

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
    cutinType.value = "draw";
  } else if (winner === cpuGameStore.playerColor) {
    result = "win";
    cutinType.value = "win";
    showDialogue("playerWin");
    audioStore.playSfx("clear");
  } else {
    result = "lose";
    cutinType.value = "lose";
    showDialogue("cpuWin");
    audioStore.playSfx("incorrect");
  }

  // 棋譜を文字列化
  const moveHistoryStr = cpuGameStore.moveHistory
    .map((pos) => formatMove(pos))
    .join(" ");

  // 記録を保存
  cpuRecordStore.addRecord(
    cpuGameStore.difficulty,
    cpuGameStore.playerFirst,
    result,
    cpuGameStore.moveCount,
    moveHistoryStr,
  );

  // 勝敗結果を読み上げ
  boardAnnouncer?.announceGameResult(result);

  // カットイン表示（自動消滅タイマー付き）
  showCutin(cutinType.value);
}

// 待った機能（2手戻す）
function handleUndo(): void {
  if (cpuGameStore.moveCount < 2 || isThinking.value) {
    return;
  }
  hideCutin();
  cpuGameStore.undoMoves(2);
  clearForbiddenMark();

  if (!cpuGameStore.isPlayerTurn) {
    cpuMove();
  }
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

// 振り返りを開く
function handleOpenReview(): void {
  const [latestRecord] = cpuRecordStore.records;
  if (latestRecord?.moveHistory) {
    appStore.openCpuReview(latestRecord.id);
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

// 盤面拡大確認ダイアログ
const largeBoardConfirmRef = ref<InstanceType<
  typeof FeatureConfirmDialog
> | null>(null);

function handleLargeBoardEnable(): void {
  preferencesStore.largeBoardEnabled = true;
  preferencesStore.largeBoardHasBeenAsked = true;
}

function handleLargeBoardDismiss(): void {
  preferencesStore.largeBoardHasBeenAsked = true;
}

// 盤面拡大モード
const isLargeBoard = computed(() => preferencesStore.isLargeBoardForCpuPlay);

// ゲーム終了メッセージ
const gameEndMessage = computed(() => {
  if (!cpuGameStore.isGameOver) {
    return "";
  }
  if (cpuGameStore.winner === cpuGameStore.playerColor) {
    return "あなたの勝ち！";
  }
  if (cpuGameStore.winner === cpuGameStore.cpuColor) {
    return "相手の勝ち...";
  }
  return "引き分け";
});
</script>

<template>
  <div class="cpu-game-player">
    <h1 class="visually-hidden">ホロメン対戦</h1>
    <GamePlayerLayout
      ref="layoutRef"
      :large-board="isLargeBoard"
    >
      <template #back-button>
        <BackButton @back="showBackConfirmDialog" />
      </template>

      <template #header-controls>
        <SettingsControl />
      </template>

      <template #control-info>
        <CpuGameStatus />
      </template>

      <template #board="{ boardSize }">
        <RenjuBoard
          :disabled="isBoardDisabled"
          :stage-size="boardSize"
          :player-color="playerColor"
          :board-state="boardStore.board"
          :marks="displayMarks"
          :cursor-position="
            keyboardNav.isCursorActivated.value
              ? keyboardNav.cursorPosition.value
              : undefined
          "
          @place-stone="handlePlaceStone"
        />
        <CutinOverlay
          ref="cutinRef"
          :type="cutinType"
          :anchor="'board-anchor'"
        />
      </template>

      <template #info>
        <div
          class="info-content"
          :class="{ 'large-board-info': isLargeBoard }"
        >
          <!-- 拡大モード時: CpuGameStatus を右パネル上部に移動 -->
          <CpuGameStatus
            v-if="isLargeBoard"
            compact
          />
          <!-- キャラクター表示（通常モードのみ） -->
          <CpuCharacterPanel
            v-if="!isLargeBoard"
            :character="cpuCharacter"
            :emotion-id="currentEmotion"
          />
          <!-- 拡大モード時: ダイアログを右パネルに統合 -->
          <CompactCharacterDialog
            v-if="isLargeBoard && dialogStore.currentMessage"
            :message="dialogStore.currentMessage"
          />

          <div class="game-controls">
            <button
              class="control-button"
              :disabled="cpuGameStore.moveCount < 2 || isThinking"
              @click="handleUndo"
            >
              待った
            </button>
            <div class="endgame-controls">
              <button
                v-if="cpuGameStore.isGameOver"
                class="control-button primary"
                @click="handleRematch"
              >
                もう一度
              </button>
              <button
                v-if="cpuGameStore.isGameOver"
                class="control-button"
                @click="handleOpenReview"
              >
                振り返り
              </button>
            </div>
          </div>

          <!-- CPUデバッグ情報 -->
          <CpuDebugInfo
            v-if="preferencesStore.showCpuInfo"
            :response="lastResponse"
          />

          <!-- ゲーム終了時のメッセージ（通常モードのみ） -->
          <div
            v-if="cpuGameStore.isGameOver && !isLargeBoard"
            class="game-result"
          >
            <p class="result-message">{{ gameEndMessage }}</p>
            <p class="result-moves">{{ cpuGameStore.moveCount }}手</p>
          </div>
        </div>
      </template>

      <template #dialog>
        <div
          v-if="!isLargeBoard && dialogStore.currentMessage"
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
          v-else-if="!isLargeBoard"
          class="help-text"
        >
          <p v-if="!cpuGameStore.isGameOver && cpuGameStore.isPlayerTurn">
            盤面をクリック、またはWASDキー+Spaceで石を置けます
          </p>
          <p v-else-if="!cpuGameStore.isGameOver && !cpuGameStore.isPlayerTurn">
            考え中です...
          </p>
        </div>
      </template>
    </GamePlayerLayout>

    <!-- 盤面読み上げ用ARIAライブリージョン -->
    <div
      aria-live="polite"
      class="visually-hidden"
    >
      {{ boardAnnouncer?.politeMessage.value }}
    </div>
    <div
      aria-live="assertive"
      class="visually-hidden"
    >
      {{ boardAnnouncer?.assertiveMessage.value }}
    </div>

    <!-- 盤面拡大確認ダイアログ -->
    <FeatureConfirmDialog
      ref="largeBoardConfirmRef"
      title="盤面拡大設定"
      message="盤面を拡大して表示しますか？"
      note="この設定は後から設定画面で変更できます"
      primary-text="拡大する"
      secondary-text="そのまま"
      @primary="handleLargeBoardEnable"
      @secondary="handleLargeBoardDismiss"
    />

    <!-- 戻る確認ダイアログ -->
    <ConfirmDialog
      ref="confirmDialogRef"
      title="対局を中断しますか？"
      message="現在の対局を終了して、設定画面に戻ります。"
      confirm-text="戻る"
      cancel-text="続ける"
      @confirm="handleConfirmBack"
    />
  </div>
</template>

<style scoped>
.cpu-game-player {
  width: 100%;
  height: 100%;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-16);
  padding: var(--size-12);
  height: 100%;
}

.info-content.large-board-info {
  gap: var(--size-8);
  overflow-y: auto;
}

.game-controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.endgame-controls {
  display: flex;
  gap: var(--size-8);
  min-height: var(--size-48);
}

.endgame-controls .control-button {
  flex: 1;
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
  background: var(--gradient-button-primary);
  border-color: transparent;
  color: var(--color-text-primary);
}

.control-button.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(95, 222, 236, 0.4);
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
  text-align: center;
}

.help-text p {
  margin: 0;
  font-size: var(--size-14);
  color: var(--color-text-secondary);
}

.character-dialog {
  display: grid;
  grid-template-columns: 4fr 8fr 4fr;
  gap: var(--size-12);
  align-items: stretch;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
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
  font-size: var(--font-size-14);
}
</style>
