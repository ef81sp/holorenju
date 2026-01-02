<script setup lang="ts">
import { useAppStore } from "@/stores/appStore";
import PageHeader from "@/components/common/PageHeader.vue";
const appStore = useAppStore();

const handleSelectTraining = (): void => {
  appStore.selectMode("training");
};

const handleSelectCPU = (): void => {
  // CPU対戦は未実装
  appStore.selectMode("cpu");
};

const handleSelectEditor = (): void => {
  appStore.goToEditor();
};
</script>

<template>
  <div class="menu-page">
    <PageHeader title="ホロ連珠" />
    <div class="content">
      <div class="menu-buttons">
        <button
          class="menu-button"
          @click="handleSelectTraining"
        >
          <div class="button-icon">📚</div>
          <div class="button-text-area">
            <span class="button-text">学習</span>
            <p class="button-description">難易度別シナリオで五目並べを学習</p>
          </div>
        </button>
        <button
          class="menu-button"
          :disabled="true"
          @click="handleSelectCPU"
        >
          <div class="button-icon">🎮</div>
          <div class="button-text-area">
            <span class="button-text">CPU対戦</span>
            <p class="button-description">今後実装予定</p>
          </div>
          <span class="badge">未実装</span>
        </button>
        <button
          class="menu-button"
          style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
          @click="handleSelectEditor"
        >
          <div class="button-icon">⚙️</div>
          <div class="button-text-area">
            <span class="button-text">シナリオ編集</span>
            <p class="button-description">シナリオを作成・編集</p>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: var(--size-40) var(--size-20);
  overflow-y: auto;
  box-sizing: border-box;
}

.content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-buttons {
  display: flex;
  flex-direction: row;
  gap: var(--size-30);
  max-width: var(--size-600);
  width: 100%;
}

.menu-button {
  flex: 1;
  padding: var(--size-24);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: var(--size-2) solid rgba(255, 255, 255, 0.3);
  border-radius: var(--size-16);
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 var(--size-5) var(--size-16) rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-12);
  position: relative;
}

.menu-button:hover:not(:disabled) {
  transform: translateY(calc(-1 * var(--size-5)));
  box-shadow: 0 var(--size-8) var(--size-20) rgba(0, 0, 0, 0.3);
}

.menu-button:active:not(:disabled) {
  transform: translateY(calc(-1 * var(--size-2)));
}

.menu-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: linear-gradient(135deg, #999 0%, #666 100%);
}

.button-icon {
  font-size: var(--size-32);
}

.button-text-area {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  text-align: center;
}

.button-text {
  font-size: var(--size-20);
  font-weight: bold;
  color: var(--color-text-primary);
}

.button-description {
  font-size: var(--size-12);
  color: #eeeeee;
  margin: 0;
  padding: 0;
  word-break: auto-phrase;
}

.badge {
  position: absolute;
  right: var(--size-8);
  top: var(--size-8);
  background: #ff6b6b;
  color: white;
  font-size: var(--size-12);
  padding: var(--size-5) var(--size-8);
  border-radius: var(--size-8);
  font-weight: bold;
}
</style>
