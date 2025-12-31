<script setup lang="ts">
import { useAppStore } from "@/stores/appStore";

const appStore = useAppStore();

const handleSelectTraining = () => {
  appStore.selectMode("training");
};

const handleSelectCPU = () => {
  // CPU対戦は未実装
  appStore.selectMode("cpu");
};
</script>

<template>
  <div class="menu-page">
    <h1 class="title">ホロ連珠</h1>
    <div class="menu-buttons">
      <button
        class="menu-button"
        @click="handleSelectTraining"
      >
        <div class="button-content">
          <span class="button-icon">📚</span>
          <span class="button-text">学習</span>
        </div>
      </button>
      <button
        class="menu-button"
        :disabled="true"
        @click="handleSelectCPU"
      >
        <div class="button-content">
          <span class="button-icon">🎮</span>
          <span class="button-text">CPU対戦</span>
          <span class="badge">未実装</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: var(--size-32);
}

.title {
  font-size: var(--size-48);
  font-weight: bold;
  color: var(--primary-color, #333);
  margin: 0;
}

.menu-buttons {
  display: flex;
  flex-direction: column;
  gap: var(--size-24);
  width: min(var(--size-500), 80%);
}

.menu-button {
  padding: var(--size-24) var(--size-32);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: var(--size-16);
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 var(--size-5) var(--size-16) rgba(0, 0, 0, 0.2);
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

.button-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-16);
  position: relative;
}

.button-icon {
  font-size: var(--size-32);
}

.button-text {
  font-size: var(--size-24);
  font-weight: bold;
  color: white;
}

.badge {
  position: absolute;
  right: calc(-1 * var(--size-8));
  top: calc(-1 * var(--size-8));
  background: #ff6b6b;
  color: white;
  font-size: var(--size-12);
  padding: var(--size-5) var(--size-8);
  border-radius: var(--size-8);
  font-weight: bold;
}
</style>
