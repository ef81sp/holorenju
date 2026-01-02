<script setup lang="ts">
import type { Position } from "@/types/game";

interface Props {
  cursorPosition: Position;
}

defineProps<Props>();
</script>

<template>
  <div class="keyboard-control-info">
    <div class="control-title">キーボード操作</div>
    <div class="control-keys">
      <span class="key">W/A/S/D</span>: カーソル移動
    </div>
    <div class="control-keys"><span class="key">Space/Enter</span>: 配置</div>
    <div class="cursor-position">
      位置: ({{ cursorPosition.row }}, {{ cursorPosition.col }})
    </div>
  </div>
</template>

<style scoped>
.keyboard-control-info {
  background: rgba(255, 255, 255, 0.95);
  border: 2px solid var(--color-fubuki-primary);
  padding: var(--size-12) var(--size-16);
  border-radius: 8px;
  font-size: var(--size-12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 1;
  min-width: 0;
}

.control-title {
  font-weight: 500;
  color: var(--color-fubuki-primary);
  margin-bottom: var(--size-8);
  font-size: var(--size-14);
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
  margin-top: var(--size-8);
  padding-top: var(--size-8);
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  color: #333;
  font-weight: 500;
  font-size: var(--size-12);
}
</style>
