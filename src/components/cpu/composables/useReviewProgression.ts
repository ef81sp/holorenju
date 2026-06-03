/**
 * 振り返り進行ツリー（最善・実際・被詰）の状態管理と emit
 *
 * - PV 構築・分岐正規化・行展開・可視手列の純粋ロジックは progressionModel に分離。
 *   このファイルは ref/computed/watch とプレビュー emit のみを担当する。
 * - step / showAll でステップ送り、jumpTo / selectBranchOption で位置やブランチを切替。
 */

import { type ComputedRef, type Ref, computed, ref, watch } from "vue";

import type { Position } from "@/types/game";
import type { EvaluatedMove } from "@/types/review";

import {
  type ProgressionTab,
  type Row,
  buildRows,
  buildTopTabs,
  buildVisibleItems,
  forcedLossLabelOf,
} from "./progressionModel";

interface UseReviewProgressionParams {
  evaluation: Ref<EvaluatedMove | null>;
  moveIndex: Ref<number>;
  emitHover: (
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ) => void;
  emitLeave: () => void;
}

interface UseReviewProgressionReturn {
  topTabs: ComputedRef<ProgressionTab[]>;
  activeTabId: Ref<string | null>;
  activeTab: ComputedRef<ProgressionTab | null>;
  rows: ComputedRef<Row[]>;
  step: Ref<number>;
  showAll: Ref<boolean>;
  hasSelections: ComputedRef<boolean>;
  forcedLossLabel: ComputedRef<string | null>;
  switchTab: (id: string) => void;
  toggleShowAll: () => void;
  stepForward: () => void;
  resetTree: () => void;
  jumpTo: (rowIdx: number) => void;
  selectBranchOption: (rowIdx: number, optId: string) => void;
  getSelectedOptionId: (selKey: string) => string;
  previewHoverMove: (rowIdx: number) => void;
  previewHoverOption: (rowIdx: number, optId: string) => void;
  previewLeave: () => void;
}

export function useReviewProgression(
  params: UseReviewProgressionParams,
): UseReviewProgressionReturn {
  const { evaluation, moveIndex, emitHover, emitLeave } = params;

  const forcedLossLabel = computed(() =>
    evaluation.value ? forcedLossLabelOf(evaluation.value) : null,
  );

  const topTabs = computed<ProgressionTab[]>(() =>
    buildTopTabs(evaluation.value, moveIndex.value),
  );

  // ── State ──
  const activeTabId = ref<string | null>(null);
  const step = ref(0);
  const showAll = ref(false);
  const selections = ref<Record<string, Record<string, string>>>({});

  const activeTab = computed<ProgressionTab | null>(
    () => topTabs.value.find((t) => t.id === activeTabId.value) ?? null,
  );

  /** アクティブタブ1つ分の selection マップ（タブ解決はここで吸収） */
  function activeSelection(): Record<string, string> {
    const tab = activeTab.value;
    return (tab && selections.value[tab.id]) ?? {};
  }

  const rows = computed<Row[]>(() => {
    const tab = activeTab.value;
    return tab ? buildRows(tab, activeSelection()) : [];
  });

  const hasSelections = computed(() => {
    const id = activeTabId.value;
    if (!id) {
      return false;
    }
    return Object.keys(selections.value[id] ?? {}).length > 0;
  });

  // ── Preview emit ──

  function emitPreview(): void {
    const tab = activeTab.value;
    if (!tab || step.value <= 0) {
      emitLeave();
      return;
    }
    emitHover(
      buildVisibleItems(rows.value, step.value, activeSelection()),
      tab.emitType,
    );
  }

  // ── Actions ──

  function switchTab(id: string): void {
    if (activeTabId.value === id) {
      return;
    }
    activeTabId.value = id;
    step.value = 0;
    showAll.value = false;
    emitLeave();
  }

  function toggleShowAll(): void {
    const total = rows.value.length;
    showAll.value = !showAll.value;
    step.value = showAll.value ? total : 0;
    emitPreview();
  }

  function stepForward(): void {
    const total = rows.value.length;
    if (step.value < total) {
      step.value++;
      if (step.value === total) {
        showAll.value = true;
      }
      emitPreview();
    }
  }

  function resetTree(): void {
    const tab = activeTab.value;
    if (tab) {
      const next: Record<string, Record<string, string>> = {};
      for (const [k, v] of Object.entries(selections.value)) {
        if (k !== tab.id) {
          next[k] = v;
        }
      }
      selections.value = next;
    }
    step.value = 0;
    showAll.value = false;
    emitLeave();
  }

  function jumpTo(rowIdx: number): void {
    step.value = rowIdx + 1;
    showAll.value = step.value >= rows.value.length;
    emitPreview();
  }

  function selectBranchOption(rowIdx: number, optId: string): void {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    const row = rows.value[rowIdx];
    if (!row || row.type !== "branch") {
      return;
    }
    selections.value = {
      ...selections.value,
      [tab.id]: {
        ...(selections.value[tab.id] ?? {}),
        [row.selKey]: optId,
      },
    };
    step.value = Math.max(step.value, rowIdx + 1);
    showAll.value = step.value >= rows.value.length;
    emitPreview();
  }

  function getSelectedOptionId(selKey: string): string {
    return activeSelection()[selKey] ?? "best";
  }

  function previewHoverMove(rowIdx: number): void {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    emitHover(
      buildVisibleItems(rows.value, rowIdx + 1, activeSelection()),
      tab.emitType,
    );
  }

  function previewHoverOption(rowIdx: number, optId: string): void {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    const row = rows.value[rowIdx];
    if (!row || row.type !== "branch") {
      return;
    }
    // rowIdx までの可視手 + ホバー中のオプション1手を末尾に合成（emit 依存のため非純粋）
    const items = buildVisibleItems(rows.value, rowIdx, activeSelection());
    const opt = row.options.find((o) => o.id === optId);
    if (opt) {
      items.push({ position: opt.item.position, isSelf: opt.item.isSelf });
    }
    emitHover(items, tab.emitType);
  }

  function previewLeave(): void {
    emitPreview();
  }

  // ── Watches: 手数 / タブ集合の変化でローカル状態をリセット ──

  watch(moveIndex, () => {
    step.value = 0;
    showAll.value = false;
    selections.value = {};
  });

  watch(
    topTabs,
    (next) => {
      if (next.length === 0) {
        activeTabId.value = null;
        return;
      }
      if (!next.some((t) => t.id === activeTabId.value)) {
        activeTabId.value = next[0]?.id ?? null;
        step.value = 0;
        showAll.value = false;
      }
    },
    { immediate: true },
  );

  return {
    topTabs,
    activeTabId,
    activeTab,
    rows,
    step,
    showAll,
    hasSelections,
    forcedLossLabel,
    switchTab,
    toggleShowAll,
    stepForward,
    resetTree,
    jumpTo,
    selectBranchOption,
    getSelectedOptionId,
    previewHoverMove,
    previewHoverOption,
    previewLeave,
  };
}
