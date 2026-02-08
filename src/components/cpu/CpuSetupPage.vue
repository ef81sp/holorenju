<script setup lang="ts">
/**
 * ホロメン対戦設定画面
 *
 * キャラクターと先後手を選択してゲームを開始する
 */

import { ref } from "vue";

import PageHeader from "@/components/common/PageHeader.vue";
// oxlint-disable-next-line consistent-type-imports
import CpuRecordDialog from "./CpuRecordDialog.vue";
import { getCharacterSpriteUrl } from "@/logic/characterSprites";
import { useAppStore } from "@/stores/appStore";
import type { CharacterType } from "@/types/character";
import type { CpuDifficulty } from "@/types/cpu";

const appStore = useAppStore();

const recordDialogRef = ref<InstanceType<typeof CpuRecordDialog> | null>(null);

// 選択状態
const selectedDifficulty = ref<CpuDifficulty>("medium");
const selectedFirst = ref(true);

/**
 * キャラクターカードの定義
 * TODO: 将来的にキャラクターを追加する際はここに追加
 * - キャラクターごとに複数の難易度を持つ構成
 * - 星の数で強さを表現
 */
interface CharacterCard {
  key: CpuDifficulty;
  character: CharacterType;
  name: string;
  stars: number;
}

const characterCards: CharacterCard[] = [
  { key: "beginner", character: "miko", name: "みこ", stars: 1 },
  { key: "easy", character: "miko", name: "みこ", stars: 2 },
  { key: "medium", character: "fubuki", name: "フブキ", stars: 3 },
  { key: "hard", character: "fubuki", name: "フブキ", stars: 4 },
];

/** スプライトシートからキャラクター顔画像のスタイルを取得（emotionId=0） */
const getFaceStyle = (
  character: CharacterType,
): { backgroundImage: string; backgroundPosition: string } => ({
  backgroundImage: `url(${getCharacterSpriteUrl(character, 1)})`,
  backgroundPosition: "0px 0px",
});

const handleStartGame = (): void => {
  appStore.startCpuGame(selectedDifficulty.value, selectedFirst.value);
};

const handleBack = (): void => {
  appStore.goToMenu();
};
</script>

<template>
  <div class="cpu-setup-page">
    <PageHeader
      title="ホロメン対戦"
      show-back
      @back="handleBack"
    />
    <div class="content">
      <div class="setup-container">
        <!-- キャラクター選択 -->
        <fieldset class="setup-section">
          <legend class="section-title">キャラクターを選択</legend>
          <div class="character-grid">
            <label
              v-for="card in characterCards"
              :key="card.key"
              class="character-card"
            >
              <input
                v-model="selectedDifficulty"
                type="radio"
                name="character"
                :value="card.key"
                class="visually-hidden"
              />
              <span
                class="card-face"
                :style="getFaceStyle(card.character)"
              />
              <span class="card-name">{{ card.name }}</span>
              <span class="card-stars">{{ "★".repeat(card.stars) }}</span>
            </label>
          </div>
        </fieldset>

        <!-- 先後手選択 -->
        <fieldset class="setup-section">
          <legend class="section-title">先後手を選択</legend>
          <div class="order-buttons">
            <label class="order-button">
              <input
                v-model="selectedFirst"
                type="radio"
                name="player-order"
                :value="true"
                class="visually-hidden"
              />
              <span class="order-icon">●</span>
              <div class="order-text">
                <span class="order-label">先手（黒）</span>
                <span class="order-description">あなたから打ち始めます</span>
              </div>
            </label>
            <label class="order-button">
              <input
                v-model="selectedFirst"
                type="radio"
                name="player-order"
                :value="false"
                class="visually-hidden"
              />
              <span class="order-icon white">○</span>
              <div class="order-text">
                <span class="order-label">後手（白）</span>
                <span class="order-description">CPUから打ち始めます</span>
              </div>
            </label>
          </div>
        </fieldset>

        <!-- ボタン群 -->
        <div class="action-buttons">
          <button
            class="start-button"
            @click="handleStartGame"
          >
            対戦開始
          </button>
          <button
            class="record-button"
            @click="recordDialogRef?.showModal()"
          >
            対戦記録
          </button>
        </div>
      </div>
    </div>

    <CpuRecordDialog ref="recordDialogRef" />
  </div>
</template>

<style scoped>
.cpu-setup-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: var(--size-24) var(--size-20);
  box-sizing: border-box;
}

.content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.setup-container {
  display: flex;
  flex-direction: column;
  gap: var(--size-16);
  max-width: var(--size-600);
  width: 100%;
}

.setup-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
  border: none;
  padding: 0;
  margin: 0;
}

.section-title {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
  padding: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.character-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--size-6);
}

.character-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2);
  padding: var(--size-6);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-10);
  cursor: pointer;
  transition: all 0.2s ease;
}

.character-card:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

.character-card:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.character-card:has(input:focus-visible) {
  animation: focus-pulse 1.5s ease-in-out infinite;
}

.card-face {
  width: var(--size-48);
  height: var(--size-48);
  background-size: calc(var(--size-48) * 4) calc(var(--size-48) * 2);
  border-radius: 50%;
}

.card-name {
  font-size: var(--size-10);
  font-weight: 500;
  color: var(--color-text-primary);
}

.card-stars {
  font-size: var(--size-10);
  color: #f59e0b;
  letter-spacing: -0.1em;
}

.order-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--size-8);
}

.order-button {
  display: flex;
  align-items: center;
  gap: var(--size-10);
  padding: var(--size-10) var(--size-16);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-10);
  cursor: pointer;
  transition: all 0.2s ease;
}

.order-button:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

.order-button:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.order-button:has(input:focus-visible) {
  animation: focus-pulse 1.5s ease-in-out infinite;
}

.order-icon {
  font-size: var(--size-24);
  line-height: 1;
  flex-shrink: 0;
}

.order-icon.white {
  color: #888;
}

.order-text {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  text-align: left;
}

.order-label {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
}

.order-description {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
}

.action-buttons {
  display: flex;
  gap: var(--size-8);
}

.start-button {
  flex: 1;
  padding: var(--size-12) var(--size-24);
  background: var(--gradient-button-primary);
  border: none;
  border-radius: var(--size-10);
  font-size: var(--size-16);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.start-button:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-6) var(--size-16) rgba(0, 0, 0, 0.2);
}

.start-button:active {
  transform: translateY(0);
}

.record-button {
  padding: var(--size-12) var(--size-16);
  background: var(--color-background-secondary);
  border: var(--size-2) solid var(--color-border-light);
  border-radius: var(--size-10);
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.record-button:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  border-color: var(--color-primary);
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

@keyframes focus-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 1px var(--color-primary),
      0 0 0 var(--size-2) rgba(95, 222, 236, 0.4);
  }
  50% {
    box-shadow:
      0 0 0 var(--size-2) var(--color-primary),
      0 0 0 var(--size-6) rgba(95, 222, 236, 0.2);
  }
}
</style>
