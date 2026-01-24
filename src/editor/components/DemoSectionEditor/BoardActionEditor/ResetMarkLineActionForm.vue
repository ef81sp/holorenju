<script setup lang="ts">
// ResetMarkLineアクションには編集可能なフィールドがないため、
// 説明メッセージのみを表示する
</script>

<template>
  <div class="action-form">
    <p class="reset-mark-line-message">
      盤面上のマーク・ラインのみを消去します（石は残ります）
    </p>
  </div>
</template>

<style scoped>
.action-form {
  display: flex;
  gap: var(--size-4);
}

.reset-mark-line-message {
  margin: 0;
  padding: var(--size-6);
  background: var(--color-holo-cyan-light, rgba(0, 255, 255, 0.1));
  border-left: 3px solid var(--color-holo-cyan);
  border-radius: 3px;
  font-size: var(--size-11);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-normal);
}
</style>
