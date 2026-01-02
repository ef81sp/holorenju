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
    <div class="control-keys">
      <span class="key">Space/Enter</span>: 配置
    </div>
    <div class="cursor-position">
      位置: ({{ cursorPosition.row }}, {{ cursorPosition.col }})
    </div>
  </div>
</template>

<style scoped>
.keyboard-control-info {
  background: rgba(255, 255, 255, 0.95);
  border: 2px solid var(--color-fubuki-primary);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 7px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
  min-width: 150px;
}

.control-title {
  font-weight: 500;
  color: var(--color-fubuki-primary);
  margin-bottom: 8px;
  font-size: 13px;
}

.control-keys {
  margin-bottom: 4px;
  color: #666;
}

.key {
  display: inline-block;
  padding: 2px 6px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 500;
  margin-right: 4px;
}

.cursor-position {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  color: #333;
  font-weight: 500;
}
</style>
