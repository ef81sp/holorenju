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
  gap: 2rem;
}

.title {
  font-size: 3rem;
  font-weight: bold;
  color: var(--primary-color, #333);
  margin: 0;
}

.menu-buttons {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: min(400px, 80%);
}

.menu-button {
  padding: 1.5rem 2rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.menu-button:hover:not(:disabled) {
  transform: translateY(-4px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}

.menu-button:active:not(:disabled) {
  transform: translateY(-2px);
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
  gap: 1rem;
  position: relative;
}

.button-icon {
  font-size: 2rem;
}

.button-text {
  font-size: 1.5rem;
  font-weight: bold;
  color: white;
}

.badge {
  position: absolute;
  right: -0.5rem;
  top: -0.5rem;
  background: #ff6b6b;
  color: white;
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.5rem;
  font-weight: bold;
}
</style>
