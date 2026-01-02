<script setup lang="ts">
import type { TextNode } from "@/types/text";

interface Props {
  nodes: TextNode[];
}

const props = defineProps<Props>();
</script>

<template>
  <div class="dialog-text">
    <template
      v-for="(node, index) in nodes"
      :key="index"
    >
      <!-- テキスト -->
      <span v-if="node.type === 'text'">{{ node.content }}</span>

      <!-- ルビ -->
      <ruby v-else-if="node.type === 'ruby'">
        {{ node.base }}
        <rt>{{ node.ruby }}</rt>
      </ruby>

      <!-- 強調 -->
      <strong v-else-if="node.type === 'emphasis'">
        {{ node.content }}
      </strong>
    </template>
  </div>
</template>

<style scoped>
.dialog-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
