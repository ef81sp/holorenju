<script setup lang="ts">
interface Props {
  scenarioTitle: string;
  currentSectionTitle: string;
  sectionIndex: number;
  totalSections: number;
}

defineProps<Props>();

const emits = defineEmits<{
  back: [];
}>();
</script>

<template>
  <div class="header">
    <button
      class="back-button"
      @click="emits('back')"
    >
      ← 戻る
    </button>
    <div class="scenario-info">
      <h2>{{ scenarioTitle }}</h2>
      <p>
        {{ currentSectionTitle }} ({{ sectionIndex + 1 }}/{{
          totalSections
        }})
      </p>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: var(--size-20);
}

.back-button {
  padding: var(--size-10) var(--size-20);
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--size-16);
  transition: all 0.2s;
}

.back-button:hover {
  background: #f5f5f5;
  border-color: #4a9eff;
}

.scenario-info h2 {
  margin: 0;
  color: #333;
}

.scenario-info p {
  margin: var(--size-5) 0 0;
  color: #666;
  font-size: var(--size-14);
}
</style>
