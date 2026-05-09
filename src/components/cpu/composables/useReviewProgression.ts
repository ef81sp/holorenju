/**
 * 振り返り進行ツリー（最善・実際・被詰）の状態と行構築ロジック
 *
 * - basePV と分岐（forcedWinBranches / forcedLossBranches）を、
 *   タブごとの InlineBranch[] に正規化する
 * - 行（rows）は単一手 or 分岐タブ群の判別共用体として展開し、
 *   ユーザー選択（selections）に応じて続きをブランチの continuation に切り替える
 * - step / showAll でステップ送り、jumpTo / selectBranchOption で位置やブランチを切替
 * - emit 関数を引数で受け取り、preview の発火を担当
 */

import { type ComputedRef, type Ref, computed, ref, watch } from "vue";

import type { Position } from "@/types/game";
import type { EvaluatedMove, ReviewCandidate } from "@/types/review";

import { SHORT_LABELS } from "@/logic/forcedTypeLabels";
import { formatMove } from "@/logic/gameRecordParser";

export interface PVDisplayItem {
  isSelf: boolean;
  position: Position;
  coord: string;
  /** 対局全体での手番（Verdict の moveIndex を起点とする1始まり） */
  moveNum: number;
}

export interface InlineBranch {
  id: string;
  /** basePV のどのインデックスで分岐するか */
  pvIdx: number;
  defenseMove: PVDisplayItem;
  continuation: PVDisplayItem[];
}

export interface ProgressionTab {
  id: string;
  label: string;
  sub?: string;
  emitType: "best" | "played";
  basePV: PVDisplayItem[];
  branches: InlineBranch[];
}

export type Row =
  | { type: "move"; key: string; item: PVDisplayItem }
  | {
      type: "branch";
      key: string;
      pvIdx: number;
      options: { id: string; item: PVDisplayItem }[];
    };

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
  isOptionSelected: (pvIdx: number, optId: string) => boolean;
  getSelectedOptionId: (pvIdx: number) => string;
  previewHoverMove: (rowIdx: number) => void;
  previewHoverOption: (rowIdx: number, optId: string) => void;
  previewLeave: () => void;
}

function buildPV(
  candidate: ReviewCandidate,
  startMoveIndex: number,
  selfFirst: boolean,
): PVDisplayItem[] {
  if (
    !candidate.principalVariation ||
    candidate.principalVariation.length === 0
  ) {
    return [];
  }
  const items: PVDisplayItem[] = [];
  for (let i = 0; i < candidate.principalVariation.length; i++) {
    const pos = candidate.principalVariation[i];
    if (!pos) {
      break;
    }
    items.push({
      isSelf: selfFirst ? i % 2 === 0 : i % 2 !== 0,
      position: pos,
      coord: formatMove(pos),
      moveNum: startMoveIndex + i,
    });
  }
  return items;
}

export function useReviewProgression(
  params: UseReviewProgressionParams,
): UseReviewProgressionReturn {
  const { evaluation, moveIndex, emitHover, emitLeave } = params;

  const forcedLossLabel = computed(() => {
    const type = evaluation.value?.forcedLossType;
    return type ? `被${SHORT_LABELS[type]}` : null;
  });

  const bestCandidate = computed<ReviewCandidate | null>(() => {
    const eval_ = evaluation.value;
    if (!eval_ || eval_.candidates.length === 0) {
      return null;
    }
    return (
      eval_.candidates.find(
        (c) =>
          c.position.row === eval_.bestMove.row &&
          c.position.col === eval_.bestMove.col,
      ) ??
      eval_.candidates[0] ??
      null
    );
  });

  const playedCandidate = computed<ReviewCandidate | null>(() => {
    const eval_ = evaluation.value;
    if (!eval_) {
      return null;
    }
    return (
      eval_.candidates.find(
        (c) =>
          c.position.row === eval_.position.row &&
          c.position.col === eval_.position.col,
      ) ?? null
    );
  });

  const bestPV = computed<PVDisplayItem[]>(() => {
    const eval_ = evaluation.value;
    const best = bestCandidate.value;
    if (!eval_ || !best) {
      return [];
    }
    return buildPV(best, moveIndex.value, true);
  });

  const playedPV = computed<PVDisplayItem[]>(() => {
    const eval_ = evaluation.value;
    if (!eval_) {
      return [];
    }
    if (eval_.forcedLossSequence && eval_.forcedLossSequence.length > 0) {
      return [];
    }
    const played = playedCandidate.value;
    if (!played) {
      return [];
    }
    return buildPV(played, moveIndex.value, true);
  });

  const forcedLossPV = computed<PVDisplayItem[]>(() => {
    const eval_ = evaluation.value;
    if (!eval_?.forcedLossSequence || eval_.forcedLossSequence.length === 0) {
      return [];
    }
    const items: PVDisplayItem[] = [
      {
        isSelf: true,
        position: eval_.position,
        coord: formatMove(eval_.position),
        moveNum: moveIndex.value,
      },
    ];
    let n = moveIndex.value + 1;
    for (let i = 0; i < eval_.forcedLossSequence.length; i++) {
      const pos = eval_.forcedLossSequence[i];
      if (!pos) {
        break;
      }
      items.push({
        isSelf: i % 2 !== 0,
        position: pos,
        coord: formatMove(pos),
        moveNum: n,
      });
      n++;
    }
    return items;
  });

  const topTabs = computed<ProgressionTab[]>(() => {
    const eval_ = evaluation.value;
    if (!eval_) {
      return [];
    }
    const result: ProgressionTab[] = [];

    if (bestPV.value.length > 0) {
      const branches: InlineBranch[] = [];
      const winBranches = eval_.forcedWinBranches ?? [];
      for (let idx = 0; idx < winBranches.length; idx++) {
        const branch = winBranches[idx];
        if (!branch) {
          continue;
        }
        const branchMoveNum = moveIndex.value + branch.defenseIndex;
        const continuation: PVDisplayItem[] = [];
        for (let j = 0; j < branch.continuation.length; j++) {
          const pos = branch.continuation[j];
          if (!pos) {
            break;
          }
          continuation.push({
            isSelf: j % 2 === 0,
            position: pos,
            coord: formatMove(pos),
            moveNum: branchMoveNum + 1 + j,
          });
        }
        branches.push({
          id: `win-${idx}`,
          pvIdx: branch.defenseIndex,
          defenseMove: {
            isSelf: false,
            position: branch.defenseMove,
            coord: formatMove(branch.defenseMove),
            moveNum: branchMoveNum,
          },
          continuation,
        });
      }
      result.push({
        id: "best",
        label: "最善",
        sub: formatMove(eval_.bestMove),
        emitType: "best",
        basePV: bestPV.value,
        branches,
      });
    }

    if (playedPV.value.length > 0) {
      result.push({
        id: "played",
        label: "実際",
        sub: formatMove(eval_.position),
        emitType: "played",
        basePV: playedPV.value,
        branches: [],
      });
    }

    if (forcedLossPV.value.length > 0) {
      const branches: InlineBranch[] = [];
      const lossBranches = eval_.forcedLossBranches ?? [];
      for (let idx = 0; idx < lossBranches.length; idx++) {
        const branch = lossBranches[idx];
        if (!branch) {
          continue;
        }
        const branchMoveNum = moveIndex.value + branch.defenseIndex + 1;
        const continuation: PVDisplayItem[] = [];
        for (let j = 0; j < branch.continuation.length; j++) {
          const pos = branch.continuation[j];
          if (!pos) {
            break;
          }
          continuation.push({
            isSelf: j % 2 !== 0,
            position: pos,
            coord: formatMove(pos),
            moveNum: branchMoveNum + 1 + j,
          });
        }
        branches.push({
          id: `loss-${idx}`,
          // forcedLossPV[0] = プレイヤーの着手なので、forcedLossSequence の index は basePV では +1 される
          pvIdx: branch.defenseIndex + 1,
          defenseMove: {
            isSelf: true,
            position: branch.defenseMove,
            coord: formatMove(branch.defenseMove),
            moveNum: branchMoveNum,
          },
          continuation,
        });
      }
      result.push({
        id: "loss",
        label: forcedLossLabel.value ?? "被詰",
        sub: formatMove(eval_.position),
        emitType: "played",
        basePV: forcedLossPV.value,
        branches,
      });
    }

    return result;
  });

  // ── State ──
  const activeTabId = ref<string | null>(null);
  const step = ref(0);
  const showAll = ref(false);
  const selections = ref<Record<string, Record<number, string>>>({});

  const activeTab = computed<ProgressionTab | null>(
    () => topTabs.value.find((t) => t.id === activeTabId.value) ?? null,
  );

  const rows = computed<Row[]>(() => {
    const tab = activeTab.value;
    if (!tab) {
      return [];
    }
    const sel = selections.value[tab.id] ?? {};
    const branchesByIdx = new Map<number, InlineBranch[]>();
    for (const b of tab.branches) {
      const list = branchesByIdx.get(b.pvIdx) ?? [];
      list.push(b);
      branchesByIdx.set(b.pvIdx, list);
    }

    const result: Row[] = [];
    let i = 0;
    let inBranch: InlineBranch | null = null;
    let branchOff = 0;

    while (true) {
      if (inBranch) {
        if (branchOff >= inBranch.continuation.length) {
          break;
        }
        const item = inBranch.continuation[branchOff];
        if (!item) {
          break;
        }
        result.push({
          type: "move",
          key: `${tab.id}-${inBranch.id}-${branchOff}`,
          item,
        });
        branchOff++;
        continue;
      }

      if (i >= tab.basePV.length) {
        break;
      }

      const branchesHere = branchesByIdx.get(i);
      const baseItem = tab.basePV[i];
      if (branchesHere && branchesHere.length > 0 && baseItem) {
        const options = [
          { id: "best", item: baseItem },
          ...branchesHere.map((b) => ({ id: b.id, item: b.defenseMove })),
        ];
        result.push({
          type: "branch",
          key: `${tab.id}-br-${i}`,
          pvIdx: i,
          options,
        });

        const selected = sel[i] ?? "best";
        if (selected !== "best") {
          const branch = branchesHere.find((b) => b.id === selected);
          if (branch) {
            inBranch = branch;
            branchOff = 0;
          }
        }
        i++;
      } else {
        if (baseItem) {
          result.push({ type: "move", key: `${tab.id}-${i}`, item: baseItem });
        }
        i++;
      }
    }

    return result;
  });

  const hasSelections = computed(() => {
    const id = activeTabId.value;
    if (!id) {
      return false;
    }
    return Object.keys(selections.value[id] ?? {}).length > 0;
  });

  // ── Helpers ──

  function getVisibleItems(
    upToRowIdx: number,
  ): { position: Position; isSelf: boolean }[] {
    const tab = activeTab.value;
    if (!tab) {
      return [];
    }
    const sel = selections.value[tab.id] ?? {};
    const items: { position: Position; isSelf: boolean }[] = [];
    const allRows = rows.value;
    for (let r = 0; r < upToRowIdx && r < allRows.length; r++) {
      const row = allRows[r];
      if (!row) {
        break;
      }
      if (row.type === "move") {
        items.push({ position: row.item.position, isSelf: row.item.isSelf });
      } else {
        const selectedId = sel[row.pvIdx] ?? "best";
        const opt =
          row.options.find((o) => o.id === selectedId) ?? row.options[0];
        if (opt) {
          items.push({ position: opt.item.position, isSelf: opt.item.isSelf });
        }
      }
    }
    return items;
  }

  function emitPreview(): void {
    const tab = activeTab.value;
    if (!tab || step.value <= 0) {
      emitLeave();
      return;
    }
    emitHover(getVisibleItems(step.value), tab.emitType);
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
      const next: Record<string, Record<number, string>> = {};
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
        [row.pvIdx]: optId,
      },
    };
    step.value = Math.max(step.value, rowIdx + 1);
    showAll.value = step.value >= rows.value.length;
    emitPreview();
  }

  function isOptionSelected(pvIdx: number, optId: string): boolean {
    return getSelectedOptionId(pvIdx) === optId;
  }

  function getSelectedOptionId(pvIdx: number): string {
    const tab = activeTab.value;
    if (!tab) {
      return "best";
    }
    const sel = selections.value[tab.id] ?? {};
    return sel[pvIdx] ?? "best";
  }

  function previewHoverMove(rowIdx: number): void {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    emitHover(getVisibleItems(rowIdx + 1), tab.emitType);
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
    const items = getVisibleItems(rowIdx);
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
    isOptionSelected,
    getSelectedOptionId,
    previewHoverMove,
    previewHoverOption,
    previewLeave,
  };
}
