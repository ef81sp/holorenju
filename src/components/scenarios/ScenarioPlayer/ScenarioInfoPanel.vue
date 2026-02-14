<script setup lang="ts">
import RichText from "@/components/common/RichText.vue";
import type { TextNode } from "@/types/text";

interface Props {
  scenarioTitle: string;
  sectionTitle: string;
  sectionIndex: number;
  totalSections: number;
  description: TextNode[];
  showNextSectionButton: boolean;
  showCompleteButton: boolean;
  showAnswerButton?: boolean;
  answerDisabled?: boolean;
  showResetButton?: boolean;
}

defineProps<Props>();

const emits = defineEmits<{
  nextSection: [];
  submitAnswer: [];
  resetPuzzle: [];
  completeScenario: [];
}>();
</script>

<template>
  <div class="info-section">
    <!-- タイトルブロック -->
    <div class="title-block">
      <h2>{{ scenarioTitle }}</h2>
      <p class="section-info">
        {{ sectionTitle }} ({{ sectionIndex + 1 }}/{{ totalSections }})
      </p>
    </div>

    <!-- 説明 -->
    <div class="description">
      <RichText :nodes="description" />
    </div>

    <!-- コントロール -->
    <div class="controls">
      <button
        v-if="showResetButton"
        class="reset-button"
        @click="emits('resetPuzzle')"
      >
        やり直す
      </button>
      <button
        v-if="showAnswerButton"
        class="answer-button"
        :disabled="answerDisabled"
        @click="emits('submitAnswer')"
      >
        回答
      </button>
      <button
        v-if="showNextSectionButton"
        class="next-button"
        @click="emits('nextSection')"
      >
        次に進む
      </button>
      <button
        v-if="showCompleteButton"
        class="next-button"
        @click="emits('completeScenario')"
      >
        シナリオ完了！
      </button>
    </div>
  </div>
</template>

<style scoped>
.info-section {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 0;
  height: 100%;
}

.title-block {
  padding: var(--size-16);
  margin-bottom: var(--size-20);
  background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
  border-radius: 8px;
  border-left: 4px solid var(--color-holo-blue);
}

.title-block h2 {
  margin: 0 0 var(--size-8);
  color: #333;
  font-size: var(--font-size-20);
  font-weight: var(--font-weight-bold);
}

.section-info {
  margin: 0;
  color: #666;
  font-size: var(--font-size-14);
}

.description {
  margin: 0;
  padding: var(--size-16);
  background: white;
  border-radius: 8px 8px 0 0;
  overflow-y: auto;
  box-shadow: none;
  font-size: var(--font-size-14);
}

.controls {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--size-12);
  padding: var(--size-16);
  background: white;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
  border-radius: 0 0 8px 8px;
}

.reset-button {
  padding: var(--size-8) var(--size-16);
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: var(--font-size-12);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  background: #f5f5f5;
  color: #666;
}

.reset-button:hover {
  background: #e8e8e8;
  color: #333;
}

.reset-button:active {
  transform: scale(0.98);
}

.answer-button {
  padding: var(--size-12) var(--size-20);
  border: none;
  border-radius: 8px;
  font-size: var(--font-size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  background: var(--color-holo-cyan);
  color: var(--color-text-primary);
}

.answer-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.answer-button:not(:disabled):hover {
  transform: scale(1.02);
  box-shadow: 0 var(--size-5) var(--size-12) rgba(95, 222, 236, 0.4);
}

.answer-button:not(:disabled):active {
  transform: scale(0.98);
}

.next-button {
  padding: var(--size-12) var(--size-20);
  border: 2px solid transparent;
  border-radius: 8px;
  font-size: var(--font-size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  background: var(--color-holo-cyan);
  color: var(--color-text-primary);
  animation: shimmer 2s ease-in-out infinite;
  box-shadow: 0 0 0 0 rgba(95, 222, 236, 0.7);
}

.next-button:hover {
  transform: scale(1.02);
  box-shadow: 0 var(--size-5) var(--size-12) rgba(95, 222, 236, 0.4);
  animation: none;
}

.next-button:active {
  transform: scale(0.98);
  animation: none;
}

@keyframes shimmer {
  0%,
  100% {
    border-color: transparent;
    box-shadow: 0 0 0 0 rgba(95, 222, 236, 0.7);
  }
  50% {
    border-color: var(--color-holo-blue);
    box-shadow: 0 0 var(--size-16) 0 rgba(95, 222, 236, 0.7);
  }
}
</style>
