<script setup lang="ts">
import RichText from "./RichText.vue";
import type { TextNode } from "@/types/text";

interface Props {
  nodes: TextNode[];
}

const props = defineProps<Props>();
</script>

<template>
  <RichText
    class="dialog-text"
    :nodes="nodes"
  />
</template>

<style scoped>
.dialog-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
