<script setup lang="ts">
interface ScenarioCardProps {
  id: string;
  title: string;
  description: string;
  isCompleted?: boolean;
  scenarioIndex: number;
}

const props = defineProps<ScenarioCardProps>();

const emit = defineEmits<{
  select: [scenarioId: string];
}>();

const handleStart = (): void => {
  emit("select", props.id);
};
</script>

<template>
  <div
    class="scenario-card"
    :class="{ completed: isCompleted }"
  >
    <div class="scenario-index">{{ scenarioIndex }}</div>
    <div
      v-if="isCompleted"
      class="completed-badge"
    >
      ✓ クリア済み
    </div>
    <div class="card-content">
      <h3 class="card-title">{{ title }}</h3>
      <p class="card-description">{{ description }}</p>
      <button
        class="start-button"
        @click="handleStart"
      >
        {{ isCompleted ? "再挑戦" : "開始" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.scenario-card {
  position: relative;
  background: white;
  border-radius: var(--size-12);
  padding: var(--size-16);
  box-shadow: 0 var(--size-5) var(--size-16) rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  border: var(--size-2) solid transparent;
  height: var(--size-180);

  &:hover {
    box-shadow: 0 var(--size-8) var(--size-20) rgba(0, 0, 0, 0.15);
    border-color: #667eea;
  }
}

.scenario-card.completed {
  background: linear-gradient(135deg, #fff 0%, #f0fff4 100%);
  border-color: #68d391;
}

.scenario-index {
  position: absolute;
  top: var(--size-6);
  right: var(--size-6);
  background: var(--color-holo-cyan);
  color: white;
  width: var(--size-28);
  height: var(--size-28);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: var(--size-12);
  font-weight: bold;
}

.completed-badge {
  position: absolute;
  top: calc(-1 * var(--size-20));
  left: calc(-1 * var(--size-8));
  background: #48bb78;
  color: white;
  font-size: var(--size-12);
  padding: var(--size-5) var(--size-10);
  border-radius: var(--size-12);
  font-weight: bold;
  box-shadow: 0 var(--size-2) var(--size-8) rgba(72, 187, 120, 0.4);
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
  height: 100%;
}

.card-title {
  font-size: var(--size-16);
  font-weight: bold;
  color: #333;
  margin: 0;
}

.card-description {
  font-size: var(--size-12);
  color: #666;
  margin: 0;
  line-height: 1.4;
  word-break: auto-phrase;
  overflow: hidden;
  flex-grow: 1;
}

.start-button {
  align-self: flex-end;
  padding: var(--size-8) var(--size-16);
  background: var(--gradient-main);
  color: var(--color-text-primary);
  border: none;
  border-radius: var(--size-6);
  font-size: var(--size-12);
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: scale(1.05);
    box-shadow: 0 var(--size-5) var(--size-12) rgba(102, 126, 234, 0.4);
  }
  &:active {
    transform: scale(0.98);
  }
}

.scenario-card.completed .start-button {
  background: linear-gradient(135deg, #68d391 0%, #38b2ac 100%);
}
</style>
