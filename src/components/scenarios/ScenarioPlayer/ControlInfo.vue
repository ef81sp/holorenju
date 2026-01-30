<script setup lang="ts">
import type { Position } from "@/types/game";

interface Props {
  cursorPosition: Position;
  sectionType?: "demo" | "question" | null;
}

withDefaults(defineProps<Props>(), {
  sectionType: null,
});
</script>

<template>
  <div class="control-info">
    <h3 class="control-title">操作方法</h3>

    <div class="control-section">
      <h4 class="section-title">マウス</h4>
      <div class="control-keys">会話をクリック: 会話を進める</div>
      <div
        v-if="sectionType === 'question'"
        class="control-keys"
      >
        2回クリック: 石を置く
      </div>
    </div>

    <div class="control-section">
      <h4 class="section-title">キーボード</h4>
      <div class="control-keys">
        <span class="key">←/→</span>
        : 会話を進める
      </div>
      <template v-if="sectionType === 'question'">
        <div class="control-keys">
          <span class="key">W/A/S/D</span>
          : カーソル移動
        </div>
        <div class="control-keys">
          <span class="key">Space/Enter</span>
          : 配置
        </div>
      </template>
    </div>

    <div
      v-if="sectionType === 'question'"
      class="cursor-position"
    >
      位置: ({{ cursorPosition.row }}, {{ cursorPosition.col }})
    </div>
  </div>
</template>

<style scoped>
.control-info {
  background: rgba(255, 255, 255, 0.95);
  border: 2px solid var(--color-fubuki-primary);
  padding: var(--size-12) var(--size-16);
  border-radius: 8px;
  font-size: var(--size-12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 1;
  min-width: 0;
  word-break: auto-phrase;
}

.control-title {
  font-weight: 500;
  color: var(--color-fubuki-primary);
  margin-bottom: var(--size-12);
  font-size: var(--size-14);
}

.control-section {
  margin-bottom: var(--size-8);
}

.control-section:last-of-type {
  margin-bottom: 0;
}

.section-title {
  font-weight: 500;
  color: #666;
  margin-bottom: var(--size-4);
  font-size: var(--size-12);
}

.control-keys {
  margin-bottom: var(--size-4);
  color: #666;
  font-size: var(--size-12);
}

.key {
  display: inline-block;
  padding: var(--size-2) var(--size-6);
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-family: monospace;
  font-size: var(--size-12);
  font-weight: 500;
  margin-right: var(--size-4);
}

.cursor-position {
  margin-top: var(--size-12);
  padding-top: var(--size-8);
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  color: #333;
  font-weight: 500;
  font-size: var(--size-12);
}
</style>
