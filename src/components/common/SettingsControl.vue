<script setup lang="ts">
import { ref } from "vue";
import IconButton from "./IconButton.vue";
import SettingsIcon from "@/assets/icons/settings.svg?component";
// oxlint-disable-next-line consistent-type-imports
import PreferencesDialog from "./PreferencesDialog.vue";

const dialogRef = ref<InstanceType<typeof PreferencesDialog> | null>(null);

const handleClick = (): void => {
  dialogRef.value?.showModal();
};
</script>

<template>
  <div class="settings-control">
    <IconButton
      size="lg"
      variant="toolbar"
      label="設定"
      @click="handleClick"
    >
      <SettingsIcon />
    </IconButton>
    <PreferencesDialog ref="dialogRef" />
  </div>
</template>

<style scoped>
.settings-control {
  flex-shrink: 0;
}
</style>
