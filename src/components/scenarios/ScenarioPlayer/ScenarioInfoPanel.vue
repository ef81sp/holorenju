<script setup lang="ts">
interface Props {
  title: string;
  description: string;
  sectionIndex: number;
  totalSections: number;
  canProceed: boolean;
  isLastSection: boolean;
  showHint: boolean;
}

defineProps<Props>();

const emits = defineEmits<{
  toggleHint: [];
  nextSection: [];
}>();
</script>

<template>
  <div class="info-section">
    <!-- 説明 -->
    <div class="step-description">
      <h3>{{ title }}</h3>
      <p>{{ description }}</p>
    </div>

    <!-- コントロール -->
    <div class="controls">
      <button
        class="hint-button"
        @click="emits('toggleHint')"
      >
        {{ showHint ? "ヒントを隠す" : "ヒントを見る" }}
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
  display: flex;
  flex-direction: column;
  gap: var(--size-20);
}

.step-description {
  padding: var(--size-20);
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.step-description h3 {
  margin: 0 0 var(--size-10);
  color: #333;
}

.step-description p {
  margin: 0;
  color: #666;
  line-height: 1.6;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
}

.hint-button,
.next-button {
  padding: var(--size-12) var(--size-24);
  border: none;
  border-radius: 8px;
  font-size: var(--size-16);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.hint-button {
  background: var(--color-fubuki-primary);
  color: var(--color-text-primary);
}

.hint-button:hover {
  background: #4a9ec9;
  transform: translateY(-2px);
}

.next-button {
  background: var(--color-holo-purple);
  color: var(--color-text-primary);
}

.next-button:hover {
  background: #5e3f7a;
  transform: translateY(-2px);
}
</style>
