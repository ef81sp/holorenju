<script setup lang="ts">
import { ref } from "vue";
import SettingsButton from "./SettingsButton.vue";
// oxlint-disable-next-line consistent-type-imports
import PreferencesDialog from "./PreferencesDialog.vue";

const dialogRef = ref<InstanceType<typeof PreferencesDialog> | null>(null);

const handleClick = (): void => {
  dialogRef.value?.showModal();
};
</script>

<template>
  <div class="settings-control">
    <SettingsButton @click="handleClick" />
    <PreferencesDialog ref="dialogRef" />
  </div>
</template>

<style scoped>
.settings-control {
  flex-shrink: 0;
}
</style>
