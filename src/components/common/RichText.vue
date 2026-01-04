<script setup lang="ts">
import type { TextNode } from "@/types/text";

interface Props {
  nodes: TextNode[];
}

const props = defineProps<Props>();
</script>

<template>
  <div class="rich-text">
    <template
      v-for="(node, index) in nodes"
      :key="index"
    >
      <span v-if="node.type === 'text'">{{ node.content }}</span>

      <ruby v-else-if="node.type === 'ruby'">
        {{ node.base }}
        <rt>{{ node.ruby }}</rt>
      </ruby>

      <strong v-else-if="node.type === 'emphasis'">
        {{ node.content }}
      </strong>

      <br v-else-if="node.type === 'lineBreak'" />

      <ul
        v-else-if="node.type === 'list'"
        class="bullet-list"
      >
        <li
          v-for="(item, itemIndex) in node.items"
          :key="itemIndex"
        >
          <template
            v-for="(child, childIndex) in item"
            :key="childIndex"
          >
            <span v-if="child.type === 'text'">{{ child.content }}</span>
            <ruby v-else-if="child.type === 'ruby'">
              {{ child.base }}
              <rt>{{ child.ruby }}</rt>
            </ruby>
            <strong v-else-if="child.type === 'emphasis'">
              {{ child.content }}
            </strong>
          </template>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.rich-text {
  line-height: 1.6;
  color: var(--color-text-primary);
}

.bullet-list {
  padding-left: var(--size-20);
  list-style: disc;
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}
</style>
