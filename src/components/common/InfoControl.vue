<script setup lang="ts">
import { ref } from "vue";
import IconButton from "./IconButton.vue";
import InfoIcon from "@/assets/icons/info.svg?component";
// oxlint-disable-next-line consistent-type-imports
import InfoDialog from "./InfoDialog.vue";

const dialogRef = ref<InstanceType<typeof InfoDialog> | null>(null);

const handleClick = (): void => {
  dialogRef.value?.showModal();
};
</script>

<template>
  <div class="info-control">
    <IconButton
      size="lg"
      variant="toolbar"
      label="情報"
      @click="handleClick"
    >
      <InfoIcon />
    </IconButton>
    <InfoDialog ref="dialogRef" />
  </div>
</template>

<style scoped>
.info-control {
  flex-shrink: 0;
}
</style>
