<script setup lang="ts">
interface Props {
  scenarioTitle: string;
  sectionTitle: string;
  sectionIndex: number;
  totalSections: number;
  description: string;
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
    <!-- タイトルブロック -->
    <div class="title-block">
      <h2>{{ scenarioTitle }}</h2>
      <p class="section-info">
        {{ sectionTitle }} ({{ sectionIndex + 1 }}/{{ totalSections }})
      </p>
    </div>

    <!-- 説明・コントロールブロック -->
    <div class="content-block">
      <div class="step-description">
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
  </div>
</template>

<style scoped>
.info-section {
  display: grid;
  grid-template-rows: 1fr 8fr;
  gap: var(--size-20);
  height: 100%;
}

.title-block {
  padding: var(--size-16);
  background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
  border-radius: 8px;
  border-left: 4px solid var(--color-holo-purple);
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

.content-block {
  display: flex;
  flex-direction: column;
  gap: var(--size-16);
  overflow-y: auto;
}

.step-description {
  padding: var(--size-16);
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.step-description p {
  margin: 0;
  color: #555;
  line-height: 1.6;
  font-size: var(--size-14);
}

.controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
}

.hint-button,
.next-button {
  padding: var(--size-12) var(--size-20);
  border: none;
  border-radius: 8px;
  font-size: var(--size-14);
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
