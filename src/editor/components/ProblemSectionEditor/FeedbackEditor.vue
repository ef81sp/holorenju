<script setup lang="ts">
import type { ProblemSection } from "@/types/scenario";
import { useFeedbackEditor } from "@/editor/composables/useFeedbackEditor";
import FeedbackLineItem from "./FeedbackLineItem.vue";

type FeedbackKey = "success" | "failure" | "progress";

const props = defineProps<{
  feedback: ProblemSection["feedback"];
  getCurrentSection: () => ProblemSection | null;
  updateSection: (updates: Partial<ProblemSection>) => void;
}>();

const {
  getFeedbackLines,
  addFeedbackLine,
  updateFeedbackLine,
  removeFeedbackLine,
} = useFeedbackEditor(props.getCurrentSection, props.updateSection);

// フィードバックグループの定義
const feedbackGroups: { key: FeedbackKey; label: string }[] = [
  { key: "success", label: "成功時" },
  { key: "failure", label: "失敗時" },
  { key: "progress", label: "進行中" },
];
</script>

<template>
  <details
    class="feedback-section"
    open
  >
    <summary class="feedback-header">
      <span>フィードバック</span>
    </summary>

    <div class="feedback-groups">
      <div
        v-for="group in feedbackGroups"
        :key="group.key"
        class="feedback-group"
      >
        <div class="feedback-group-header">
          <span>{{ group.label }}</span>
          <button
            type="button"
            class="btn-add-small"
            @click.stop.prevent="addFeedbackLine(group.key)"
          >
            + 行を追加
          </button>
        </div>
        <div
          v-if="getFeedbackLines(group.key).length === 0"
          class="empty-state"
        >
          メッセージがありません
        </div>
        <div
          v-else
          class="feedback-lines"
        >
          <FeedbackLineItem
            v-for="(line, index) in getFeedbackLines(group.key)"
            :key="`${group.key}-${index}`"
            :line="line"
            :index="index"
            @update="
              (idx, updates) => updateFeedbackLine(group.key, idx, updates)
            "
            @remove="(idx) => removeFeedbackLine(group.key, idx)"
          />
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.feedback-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.feedback-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
  user-select: none;
}

.feedback-section summary:hover {
  color: #4a90e2;
}

.feedback-groups {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.feedback-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.feedback-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.feedback-header span {
  flex: 1;
}

.feedback-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-add-small {
  padding: var(--size-2) var(--size-6);
  background-color: #4a90e2;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
  transition: opacity 0.2s;
}

.btn-add-small:hover {
  opacity: 0.9;
}

.empty-state {
  padding: var(--size-8);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  font-size: var(--size-12);
}

.feedback-lines {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}
</style>
