<script setup lang="ts">
interface ScenarioCardProps {
  id: string;
  title: string;
  description: string;
  isCompleted?: boolean;
}

const props = defineProps<ScenarioCardProps>();

const emit = defineEmits<{
  select: [scenarioId: string];
}>();

const handleStart = () => {
  emit("select", props.id);
};
</script>

<template>
  <div
    class="scenario-card"
    :class="{ completed: isCompleted }"
  >
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
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  border: 2px solid transparent;
}

.scenario-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  border-color: #667eea;
}

.scenario-card.completed {
  background: linear-gradient(135deg, #fff 0%, #f0fff4 100%);
  border-color: #68d391;
}

.completed-badge {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  background: #48bb78;
  color: white;
  font-size: 0.8rem;
  padding: 0.35rem 0.75rem;
  border-radius: 1rem;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(72, 187, 120, 0.4);
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.card-title {
  font-size: 1.25rem;
  font-weight: bold;
  color: #333;
  margin: 0;
}

.card-description {
  font-size: 0.95rem;
  color: #666;
  margin: 0;
  line-height: 1.5;
}

.start-button {
  align-self: flex-end;
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
}

.start-button:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.start-button:active {
  transform: scale(0.98);
}

.scenario-card.completed .start-button {
  background: linear-gradient(135deg, #68d391 0%, #38b2ac 100%);
}
</style>
