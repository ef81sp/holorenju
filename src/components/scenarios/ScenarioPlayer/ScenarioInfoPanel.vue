<script setup lang="ts">
interface Props {
  scenarioTitle: string;
  sectionTitle: string;
  sectionIndex: number;
  totalSections: number;
  description: string;
  canProceed: boolean;
  isLastSection: boolean;
  showAnswerButton?: boolean;
  answerDisabled?: boolean;
}

defineProps<Props>();

const emits = defineEmits<{
  nextSection: [];
  submitAnswer: [];
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
    <p class="description">{{ description }}</p>

    <!-- コントロール -->
    <div class="controls">
      <button
        v-if="showAnswerButton"
        class="answer-button"
        :disabled="answerDisabled"
        @click="emits('submitAnswer')"
      >
        回答
      </button>
      <button
        v-if="canProceed"
        class="next-button"
        @click="emits('nextSection')"
      >
        {{ isLastSection ? "シナリオ完了" : "次のセクションへ" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.info-section {
  display: grid;
  grid-template-rows: 1fr 6fr 2fr;
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
  font-size: var(--size-20);
}

.section-info {
  margin: 0;
  color: #666;
  font-size: var(--size-14);
}

.content-container {
  display: none;
}

.description {
  margin: 0;
  padding: var(--size-16);
  background: white;
  border-radius: 8px 8px 0 0;
  overflow-y: auto;
  box-shadow: none;
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

.answer-button {
  padding: var(--size-12) var(--size-20);
  border: none;
  border-radius: 8px;
  font-size: var(--size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  background: var(--color-holo-blue);
  color: var(--color-text-primary);
}

.answer-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.answer-button:not(:disabled):hover {
  background: #3b6eb3;
  transform: translateY(-2px);
}

.next-button {
  padding: var(--size-12) var(--size-20);
  border: none;
  border-radius: 8px;
  font-size: var(--size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  background: var(--color-holo-purple);
  color: var(--color-text-primary);
}

.next-button:hover {
  background: #5e3f7a;
  transform: translateY(-2px);
}
</style>
