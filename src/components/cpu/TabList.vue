<script
  setup
  lang="ts"
  generic="T extends { id: string; label: string; sub?: string }"
>
/**
 * APG tabs パターンのタブリスト＋タブパネル
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * - role=tablist / role=tab / role=tabpanel と関連 ARIA を全て内部で構築
 * - 一意な id は useId() で発行、`aria-controls` / `aria-labelledby` を自動連結
 * - Roving tabindex（選択中タブのみ tabindex=0）
 * - キーボード（自動アクティベーション）:
 *   - ArrowLeft / ArrowRight: 前後タブに移動 + 切替
 *   - Home / End: 先頭・末尾タブに移動 + 切替
 * - イベント伝播は内部で停止（親 window で同じキーが使われていても干渉しない）
 *
 * 親は `tabs` / `activeId` を渡し、`change` を受けるだけでよい。
 * panel コンテンツはデフォルトスロットで渡す。
 *
 * tabs.length が 1 以下のときはタブリストを描画しない（パネルだけ表示）。
 */

import { nextTick, useId, useTemplateRef } from "vue";

const props = defineProps<{
  tabs: T[];
  activeId: string;
  /** スクリーンリーダー向けタブリスト全体のラベル */
  ariaLabel: string;
  /** タブごとに動的クラスを返す（is-loss など装飾用） */
  tabClass?: (tab: T) => Record<string, boolean>;
}>();

const emit = defineEmits<{
  change: [id: string];
}>();

const uid = useId();
const tabIdFor = (id: string): string => `${uid}-tab-${id}`;
const panelIdFor = (id: string): string => `${uid}-panel-${id}`;

const tabsRef = useTemplateRef<HTMLButtonElement[]>("tabButtons");

function focusTabAt(idx: number): void {
  nextTick(() => {
    tabsRef.value?.[idx]?.focus();
  });
}

function onKeydown(event: KeyboardEvent, currentId: string): void {
  const list = props.tabs;
  const currentIdx = list.findIndex((t) => t.id === currentId);
  if (currentIdx < 0) {
    return;
  }
  let nextIdx = -1;
  switch (event.key) {
    case "ArrowLeft":
      nextIdx = (currentIdx - 1 + list.length) % list.length;
      break;
    case "ArrowRight":
      nextIdx = (currentIdx + 1) % list.length;
      break;
    case "Home":
      nextIdx = 0;
      break;
    case "End":
      nextIdx = list.length - 1;
      break;
    default:
      return;
  }
  // 親側 window で ArrowLeft/Right を使っているケースに干渉しないよう停止
  event.preventDefault();
  event.stopPropagation();
  const next = list[nextIdx];
  if (next) {
    emit("change", next.id);
    focusTabAt(nextIdx);
  }
}
</script>

<template>
  <div
    v-if="tabs.length > 1"
    class="tablist"
    role="tablist"
    :aria-label="ariaLabel"
    aria-orientation="horizontal"
  >
    <button
      v-for="t in tabs"
      :id="tabIdFor(t.id)"
      :key="t.id"
      ref="tabButtons"
      type="button"
      role="tab"
      :aria-selected="activeId === t.id"
      :aria-controls="panelIdFor(activeId)"
      :tabindex="activeId === t.id ? 0 : -1"
      class="tab"
      :class="[{ 'is-on': activeId === t.id }, tabClass ? tabClass(t) : {}]"
      @click="emit('change', t.id)"
      @keydown="onKeydown($event, t.id)"
    >
      <span class="tab-label">{{ t.label }}</span>
      <span
        v-if="t.sub"
        class="tab-sub"
      >
        {{ t.sub }}
      </span>
    </button>
  </div>

  <div
    v-if="tabs.length > 0"
    :id="panelIdFor(activeId)"
    class="tabpanel"
    :role="tabs.length > 1 ? 'tabpanel' : undefined"
    :aria-labelledby="tabs.length > 1 ? tabIdFor(activeId) : undefined"
  >
    <slot />
  </div>
</template>

<style scoped>
.tablist {
  display: flex;
  gap: var(--size-1);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  scrollbar-width: thin;
  flex-shrink: 0;
}

.tablist::-webkit-scrollbar {
  height: 4px;
}

.tablist::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.tab {
  flex: 1 0 auto;
  min-width: var(--size-60);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--size-4) var(--size-6) var(--size-5);
  background: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-bottom: none;
  border-radius: var(--size-6) var(--size-6) 0 0;
  font-family: inherit;
  font-size: var(--font-size-11);
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  line-height: 1.2;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.tab:hover {
  background: var(--color-bg-white);
  color: var(--color-fubuki-name);
}

.tab.is-on {
  background: #fff;
  color: var(--color-fubuki-name);
  border-bottom: 1px solid #fff;
  z-index: 1;
}

.tab:focus-visible {
  outline: var(--size-2) solid var(--color-fubuki-primary);
  outline-offset: -2px;
  z-index: 2;
}

.tab .tab-sub {
  font-size: var(--font-size-9);
  font-weight: var(--font-weight-normal);
  opacity: 0.85;
}

.tabpanel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
