<script setup lang="ts">
import type { TextNode, InlineTextNode } from "@/types/text";

interface Props {
  nodes: TextNode[];
}

const props = defineProps<Props>();

// インラインノードをレンダリング（再帰対応）
function renderInlineNodes(nodes: InlineTextNode[]): InlineTextNode[] {
  return nodes;
}
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
        <template
          v-for="(child, childIndex) in node.content"
          :key="childIndex"
        >
          <span v-if="child.type === 'text'">{{ child.content }}</span>
          <ruby v-else-if="child.type === 'ruby'">
            {{ child.base }}
            <rt>{{ child.ruby }}</rt>
          </ruby>
          <a
            v-else-if="child.type === 'link'"
            :href="child.url"
            target="_blank"
            rel="noopener noreferrer"
            class="rich-text-link"
          >
            <template
              v-for="(linkChild, linkChildIndex) in child.content"
              :key="linkChildIndex"
            >
              <span v-if="linkChild.type === 'text'">
                {{ linkChild.content }}
              </span>
              <ruby v-else-if="linkChild.type === 'ruby'">
                {{ linkChild.base }}
                <rt>{{ linkChild.ruby }}</rt>
              </ruby>
            </template>
          </a>
        </template>
      </strong>

      <a
        v-else-if="node.type === 'link'"
        :href="node.url"
        target="_blank"
        rel="noopener noreferrer"
        class="rich-text-link"
      >
        <template
          v-for="(child, childIndex) in node.content"
          :key="childIndex"
        >
          <span v-if="child.type === 'text'">{{ child.content }}</span>
          <ruby v-else-if="child.type === 'ruby'">
            {{ child.base }}
            <rt>{{ child.ruby }}</rt>
          </ruby>
          <strong v-else-if="child.type === 'emphasis'">
            <template
              v-for="(grandchild, grandchildIndex) in child.content"
              :key="grandchildIndex"
            >
              <span v-if="grandchild.type === 'text'">
                {{ grandchild.content }}
              </span>
              <ruby v-else-if="grandchild.type === 'ruby'">
                {{ grandchild.base }}
                <rt>{{ grandchild.ruby }}</rt>
              </ruby>
            </template>
          </strong>
        </template>
      </a>

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
              <template
                v-for="(grandchild, grandchildIndex) in child.content"
                :key="grandchildIndex"
              >
                <span v-if="grandchild.type === 'text'">
                  {{ grandchild.content }}
                </span>
                <ruby v-else-if="grandchild.type === 'ruby'">
                  {{ grandchild.base }}
                  <rt>{{ grandchild.ruby }}</rt>
                </ruby>
                <a
                  v-else-if="grandchild.type === 'link'"
                  :href="grandchild.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rich-text-link"
                >
                  <template
                    v-for="(linkChild, linkChildIndex) in grandchild.content"
                    :key="linkChildIndex"
                  >
                    <span v-if="linkChild.type === 'text'">
                      {{ linkChild.content }}
                    </span>
                    <ruby v-else-if="linkChild.type === 'ruby'">
                      {{ linkChild.base }}
                      <rt>{{ linkChild.ruby }}</rt>
                    </ruby>
                  </template>
                </a>
              </template>
            </strong>
            <a
              v-else-if="child.type === 'link'"
              :href="child.url"
              target="_blank"
              rel="noopener noreferrer"
              class="rich-text-link"
            >
              <template
                v-for="(linkChild, linkChildIndex) in child.content"
                :key="linkChildIndex"
              >
                <span v-if="linkChild.type === 'text'">
                  {{ linkChild.content }}
                </span>
                <ruby v-else-if="linkChild.type === 'ruby'">
                  {{ linkChild.base }}
                  <rt>{{ linkChild.ruby }}</rt>
                </ruby>
                <strong v-else-if="linkChild.type === 'emphasis'">
                  <template
                    v-for="(grandchild, grandchildIndex) in linkChild.content"
                    :key="grandchildIndex"
                  >
                    <span v-if="grandchild.type === 'text'">
                      {{ grandchild.content }}
                    </span>
                    <ruby v-else-if="grandchild.type === 'ruby'">
                      {{ grandchild.base }}
                      <rt>{{ grandchild.ruby }}</rt>
                    </ruby>
                  </template>
                </strong>
              </template>
            </a>
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

.rich-text-link {
  color: var(--color-holo-blue);
  text-decoration: underline;
}
</style>
