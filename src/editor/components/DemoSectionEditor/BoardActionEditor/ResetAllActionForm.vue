<script setup lang="ts">
// ResetAllアクションには編集可能なフィールドがないため、
// 説明メッセージのみを表示する
</script>

<template>
  <div class="action-form">
    <p class="reset-all-message">
      盤面上のすべての石・マーク・ラインを初期化します
    </p>
  </div>
</template>

<style scoped>
.action-form {
  display: flex;
  gap: var(--size-4);
}

.reset-all-message {
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
