<script setup lang="ts">
import { ref } from "vue";
import InfoButton from "./InfoButton.vue";
// oxlint-disable-next-line consistent-type-imports
import InfoDialog from "./InfoDialog.vue";

const dialogRef = ref<InstanceType<typeof InfoDialog> | null>(null);

const handleClick = (): void => {
  dialogRef.value?.showModal();
};
</script>

<template>
  <div class="info-control">
    <InfoButton @click="handleClick" />
    <InfoDialog ref="dialogRef" />
  </div>
</template>

<style scoped>
.info-control {
  flex-shrink: 0;
}
</style>
