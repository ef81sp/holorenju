<script setup lang="ts">
/**
 * 振り返り評価結果パネル
 *
 * 「結論＋スコア」「候補手」「最善の進行＋分岐」の 3 セクション構成。
 * 候補手・進行手のホバーで盤面に想定石をプレビュー、進行はタブと
 * 「全表示／1つ進む／リセット」ボタンで明示的に操作する。
 */

import { computed, ref, watch } from "vue";

import type { EvaluatedMove, ReviewCandidate } from "@/types/review";
import type { Position } from "@/types/game";
import { CPU_WIN_LABELS, SHORT_LABELS } from "@/logic/forcedTypeLabels";
import { formatMove } from "@/logic/gameRecordParser";
import { getQualityLabel, getQualityColor } from "@/logic/reviewLogic";
import { formatScore as formatScoreUtil } from "@/logic/cpu/evaluation/breakdownUtils";

const props = defineProps<{
  /** 現在の手の評価データ */
  evaluation: EvaluatedMove | null;
  /** 表示中の手数（1始まり） */
  moveIndex: number;
  /** 現在の手の位置（evaluation がない場合にCPU手の座標表示用） */
  currentPosition: Position | null;
  /** 評価中かどうか */
  isEvaluating?: boolean;
  /** この手が敗着かどうか */
  isLosingMove?: boolean;
}>();

const emit = defineEmits<{
  hoverCandidate: [position: Position];
  leaveCandidate: [];
  hoverPvMove: [
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ];
  leavePvMove: [];
}>();

const formatScore = formatScoreUtil;

// ────────────────────────────────────────────────────────────────
// Verdict / Score
// ────────────────────────────────────────────────────────────────

/** 品質ラベルの色 */
const qualityColor = computed(() => {
  if (!props.evaluation) {
    return undefined;
  }
  return getQualityColor(props.evaluation.quality);
});

/** 品質ラベルのテキスト */
const qualityLabel = computed(() => {
  if (!props.evaluation) {
    return "";
  }
  return getQualityLabel(props.evaluation.quality);
});

/** 必勝手順インジケーターのテキスト（プレイヤー手用） */
const forcedWinLabel = computed(() => {
  const type = props.evaluation?.forcedWinType;
  if (!type) {
    return null;
  }
  if (type === "double-mise") {
    const missed = props.evaluation?.missedDoubleMise;
    return missed && missed.length > 0 ? null : SHORT_LABELS[type];
  }
  return SHORT_LABELS[type];
});

/** 負け確定インジケーターのテキスト */
const forcedLossLabel = computed(() => {
  const type = props.evaluation?.forcedLossType;
  return type ? `被${SHORT_LABELS[type]}` : null;
});

/** 両ミセ見逃しラベル */
const missedDoubleMiseLabel = computed(() => {
  const moves = props.evaluation?.missedDoubleMise;
  if (!moves || moves.length === 0) {
    return null;
  }
  return "両ミセ見逃";
});

/** コンピュータ手の強制勝ちラベル（「〜中」） */
const cpuForcedWinLabel = computed(() => {
  const type = props.evaluation?.forcedWinType;
  return type ? CPU_WIN_LABELS[type] : null;
});

/** ヘッダの座標表示 */
const moveCoord = computed(() => {
  if (props.evaluation) {
    return formatMove(props.evaluation.position);
  }
  if (props.currentPosition) {
    return formatMove(props.currentPosition);
  }
  return "";
});

/** 着手側が黒か（手番バッジ色用） */
const isBlackMove = computed(
  () => props.moveIndex > 0 && props.moveIndex % 2 === 1,
);

// ────────────────────────────────────────────────────────────────
// Candidates
// ────────────────────────────────────────────────────────────────

/** 最善手の候補データ */
const bestCandidate = computed<ReviewCandidate | null>(() => {
  const eval_ = props.evaluation;
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

interface CandidateView {
  rank: number;
  position: Position;
  coord: string;
  /** searchScore を最善との差分として表示（負値 / ±0） */
  delta: number;
  kind: "best" | "actual" | "alt";
  isFukumi: boolean;
  fukumiDepth?: number;
  opponentForcedWinShort?: string;
}

const candidateViews = computed<CandidateView[]>(() => {
  const eval_ = props.evaluation;
  if (!eval_ || eval_.candidates.length === 0) {
    return [];
  }
  const bestSearchScore =
    bestCandidate.value?.searchScore ?? eval_.candidates[0]?.searchScore ?? 0;
  return eval_.candidates.map((c, idx) => {
    const isBest =
      c.position.row === eval_.bestMove.row &&
      c.position.col === eval_.bestMove.col;
    const isPlayed =
      c.position.row === eval_.position.row &&
      c.position.col === eval_.position.col;
    let kind: "best" | "actual" | "alt" = "alt";
    if (isBest) {
      kind = "best";
    } else if (isPlayed) {
      kind = "actual";
    }
    return {
      rank: idx + 1,
      position: c.position,
      coord: formatMove(c.position),
      delta: c.searchScore - bestSearchScore,
      kind,
      isFukumi: c.isFukumi ?? false,
      fukumiDepth: c.fukumiDepth,
      opponentForcedWinShort: c.opponentForcedWin
        ? SHORT_LABELS[c.opponentForcedWin]
        : undefined,
    };
  });
});

function formatDelta(delta: number): string {
  if (delta === 0) {
    return "±0";
  }
  return delta.toLocaleString("en");
}

function handleCandidateEnter(position: Position): void {
  emit("hoverCandidate", position);
}

function handleCandidateLeave(): void {
  emit("leaveCandidate");
}

// ────────────────────────────────────────────────────────────────
// Best line / Branches → tabs
// ────────────────────────────────────────────────────────────────

interface PVDisplayItem {
  isSelf: boolean;
  position: Position;
  coord: string;
  /** 対局全体での手番（Verdict の moveIndex を起点とする1始まり） */
  moveNum: number;
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

/** 最善手の PV */
const bestPV = computed<PVDisplayItem[]>(() => {
  const eval_ = props.evaluation;
  const best = bestCandidate.value;
  if (!eval_ || !best) {
    return [];
  }
  return buildPV(best, props.moveIndex, true);
});

/** 実際の手の候補データ */
const playedCandidate = computed<ReviewCandidate | null>(() => {
  const eval_ = props.evaluation;
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

/** 実際の手の PV（被詰がある場合は省略） */
const playedPV = computed<PVDisplayItem[]>(() => {
  const eval_ = props.evaluation;
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
  return buildPV(played, props.moveIndex, true);
});

/** 被詰手順（プレイヤー着手 + 相手の必勝手順） */
const forcedLossPV = computed<PVDisplayItem[]>(() => {
  const eval_ = props.evaluation;
  if (!eval_?.forcedLossSequence || eval_.forcedLossSequence.length === 0) {
    return [];
  }
  const items: PVDisplayItem[] = [
    {
      isSelf: true,
      position: eval_.position,
      coord: formatMove(eval_.position),
      moveNum: props.moveIndex,
    },
  ];
  let n = props.moveIndex + 1;
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

/** 進行ツリー上の分岐（同一深度に複数の代替手が存在する場合） */
interface InlineBranch {
  id: string;
  /** basePV のどのインデックスで分岐するか（このインデックスの best 手の代替） */
  pvIdx: number;
  /** 代替手（このタブの emitType により isSelf の意味が決まる） */
  defenseMove: PVDisplayItem;
  /** defenseMove の後に続く手列（isSelf, moveNum 付き） */
  continuation: PVDisplayItem[];
}

interface ProgressionTab {
  id: string;
  label: string;
  sub?: string;
  emitType: "best" | "played";
  basePV: PVDisplayItem[];
  branches: InlineBranch[];
}

const topTabs = computed<ProgressionTab[]>(() => {
  const eval_ = props.evaluation;
  if (!eval_) {
    return [];
  }
  const result: ProgressionTab[] = [];

  // 最善 + forcedWinBranches
  if (bestPV.value.length > 0) {
    const branches: InlineBranch[] = [];
    const winBranches = eval_.forcedWinBranches ?? [];
    for (let idx = 0; idx < winBranches.length; idx++) {
      const branch = winBranches[idx];
      if (!branch) {
        continue;
      }
      const moveNum = props.moveIndex + branch.defenseIndex;
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
          moveNum: moveNum + 1 + j,
        });
      }
      branches.push({
        id: `win-${idx}`,
        pvIdx: branch.defenseIndex,
        defenseMove: {
          isSelf: false,
          position: branch.defenseMove,
          coord: formatMove(branch.defenseMove),
          moveNum,
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

  // 実際（被詰がない場合のみ・分岐なし）
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

  // 被詰 + forcedLossBranches
  if (forcedLossPV.value.length > 0) {
    const branches: InlineBranch[] = [];
    const lossBranches = eval_.forcedLossBranches ?? [];
    for (let idx = 0; idx < lossBranches.length; idx++) {
      const branch = lossBranches[idx];
      if (!branch) {
        continue;
      }
      const moveNum = props.moveIndex + branch.defenseIndex + 1;
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
          moveNum: moveNum + 1 + j,
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
          moveNum,
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

// ────────────────────────────────────────────────────────────────
// Tab / row state
// ────────────────────────────────────────────────────────────────

const activeTabId = ref<string | null>(null);
const step = ref(0);
const showAll = ref(false);
/** タブごとの選択状態: tabId -> { pvIdx -> optionId } */
const selections = ref<Record<string, Record<number, string>>>({});

const activeTab = computed<ProgressionTab | null>(
  () => topTabs.value.find((t) => t.id === activeTabId.value) ?? null,
);

type Row =
  | { type: "move"; key: string; item: PVDisplayItem }
  | {
      type: "branch";
      key: string;
      pvIdx: number;
      options: { id: string; item: PVDisplayItem }[];
    };

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
    emit("leavePvMove");
    return;
  }
  const items = getVisibleItems(step.value);
  emit("hoverPvMove", items, tab.emitType);
}

function switchTab(id: string): void {
  if (activeTabId.value === id) {
    return;
  }
  activeTabId.value = id;
  step.value = 0;
  showAll.value = false;
  emit("leavePvMove");
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
  emit("leavePvMove");
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
  const tab = activeTab.value;
  if (!tab) {
    return false;
  }
  const sel = selections.value[tab.id] ?? {};
  const current = sel[pvIdx] ?? "best";
  return current === optId;
}

function previewHoverMove(rowIdx: number): void {
  const tab = activeTab.value;
  if (!tab) {
    return;
  }
  const items = getVisibleItems(rowIdx + 1);
  emit("hoverPvMove", items, tab.emitType);
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
  emit("hoverPvMove", items, tab.emitType);
}

function previewLeave(): void {
  emitPreview();
}

const hasSelections = computed(() => {
  const id = activeTabId.value;
  if (!id) {
    return false;
  }
  return Object.keys(selections.value[id] ?? {}).length > 0;
});

watch(
  () => props.moveIndex,
  () => {
    step.value = 0;
    showAll.value = false;
    selections.value = {};
  },
);

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
</script>

<template>
  <div class="review-eval-panel">
    <!-- 初期状態 -->
    <div
      v-if="moveIndex === 0"
      class="empty"
    >
      <span>手を選択してください</span>
    </div>

    <!-- 解析中 -->
    <div
      v-else-if="!evaluation && isEvaluating"
      class="cpu-move"
    >
      <div class="verdict-head">
        <span class="verdict-num">
          <span
            class="n"
            :class="{ 'is-white': !isBlackMove }"
          >
            {{ moveIndex }}
          </span>
          <span class="coord">{{ moveCoord }}</span>
        </span>
      </div>
      <div class="cpu-move-text analyzing">解析中...</div>
    </div>

    <!-- CPU の手 / 軽量評価 -->
    <div
      v-else-if="!evaluation || evaluation.isLightEval"
      class="cpu-move"
    >
      <div class="verdict-head">
        <span class="verdict-num">
          <span
            class="n"
            :class="{ 'is-white': !isBlackMove }"
          >
            {{ moveIndex }}
          </span>
          <span class="coord">{{ moveCoord }}</span>
        </span>
        <span
          v-if="cpuForcedWinLabel"
          class="tag forced"
        >
          {{ cpuForcedWinLabel }}
        </span>
      </div>
      <div class="cpu-move-text">相手の手</div>
    </div>

    <!-- プレイヤーの手の評価 -->
    <div
      v-else
      class="player-eval"
    >
      <!-- (1) 結論 + スコア -->
      <section class="panel-section verdict-section">
        <div class="verdict-head">
          <span class="verdict-num">
            <span
              class="n"
              :class="{ 'is-white': !isBlackMove }"
            >
              {{ moveIndex }}
            </span>
            <span class="coord">{{ moveCoord }}</span>
          </span>
          <span
            v-if="props.isLosingMove"
            class="tag losing"
          >
            敗着
          </span>
          <span
            v-else
            class="tag quality"
            :style="{ backgroundColor: qualityColor }"
          >
            {{ qualityLabel }}
          </span>
          <span
            v-if="forcedWinLabel"
            class="tag forced"
          >
            {{ forcedWinLabel }}
          </span>
          <span
            v-if="forcedLossLabel && !props.isLosingMove"
            class="tag loss"
          >
            {{ forcedLossLabel }}
          </span>
          <span
            v-if="missedDoubleMiseLabel"
            class="tag miss"
          >
            {{ missedDoubleMiseLabel }}
          </span>
        </div>

        <div class="score-block">
          <div class="score-cell">
            <div class="label">実際</div>
            <div class="v actual">
              {{ formatScore(evaluation.playedScore) }}
            </div>
          </div>
          <div class="score-cell">
            <div class="label">最善</div>
            <div class="v best">{{ formatScore(evaluation.bestScore) }}</div>
          </div>
        </div>
      </section>

      <!-- (2) 候補手 -->
      <section
        v-if="candidateViews.length > 0"
        class="panel-section cand-section"
      >
        <div class="panel-label">
          <span>候補手</span>
          <span class="panel-label-count">{{ candidateViews.length }}件</span>
        </div>
        <div class="cand-scroll">
          <div class="cand-grid">
            <button
              v-for="c in candidateViews"
              :key="`${c.position.row},${c.position.col}`"
              type="button"
              class="cand-card"
              :class="{
                'is-best': c.kind === 'best',
                'is-actual': c.kind === 'actual',
                'is-danger': c.opponentForcedWinShort,
                'is-fukumi': c.isFukumi,
              }"
              @mouseenter="handleCandidateEnter(c.position)"
              @mouseleave="handleCandidateLeave"
              @focus="handleCandidateEnter(c.position)"
              @blur="handleCandidateLeave"
            >
              <span
                class="cand-rank"
                :class="c.kind"
              >
                {{ c.rank }}
              </span>
              <span class="cand-coord">{{ c.coord }}</span>
              <span
                class="cand-delta"
                :class="c.delta === 0 ? 'zero' : 'neg'"
              >
                {{ formatDelta(c.delta) }}
              </span>
              <span
                v-if="c.opponentForcedWinShort"
                class="cand-flag danger"
              >
                危{{ c.opponentForcedWinShort }}
              </span>
              <span
                v-else-if="c.isFukumi"
                class="cand-flag fukumi"
              >
                フクミ{{ c.fukumiDepth ? c.fukumiDepth : "" }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- (3) 進行 + 分岐 -->
      <section
        v-if="topTabs.length > 0"
        class="panel-section tree-section"
      >
        <div class="panel-label">
          <span>最善の進行</span>
          <span
            v-if="rows.length > 0"
            class="panel-label-count"
          >
            {{ rows.length }}手
          </span>
        </div>

        <div
          v-if="topTabs.length > 1"
          class="tree-tabs"
          role="tablist"
        >
          <button
            v-for="t in topTabs"
            :key="t.id"
            type="button"
            role="tab"
            class="tree-tab"
            :class="{
              'is-on': activeTabId === t.id,
              'is-loss': t.id === 'loss',
            }"
            @click="switchTab(t.id)"
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

        <div class="tree-controls">
          <button
            type="button"
            class="ctl-btn primary"
            :class="{ 'is-on': showAll }"
            :disabled="rows.length === 0"
            @click="toggleShowAll"
          >
            全表示
          </button>
          <button
            type="button"
            class="ctl-btn"
            :disabled="step >= rows.length"
            @click="stepForward"
          >
            1つ進む
          </button>
          <button
            type="button"
            class="ctl-btn"
            :disabled="step === 0 && !showAll && !hasSelections"
            @click="resetTree"
          >
            リセット
          </button>
        </div>

        <div class="tree-scroll">
          <div
            v-if="rows.length > 0"
            class="prog-list"
          >
            <template
              v-for="(row, i) in rows"
              :key="row.key"
            >
              <button
                v-if="row.type === 'move'"
                type="button"
                class="prog-move"
                :class="[
                  row.item.moveNum % 2 === 1 ? 'black' : 'white',
                  {
                    'is-played': i < step,
                    'is-current': i === step - 1,
                  },
                ]"
                @mouseenter="previewHoverMove(i)"
                @mouseleave="previewLeave"
                @focus="previewHoverMove(i)"
                @blur="previewLeave"
                @click="jumpTo(i)"
              >
                <span class="m-num">{{ row.item.moveNum }}</span>
                <span class="m-coord">{{ row.item.coord }}</span>
              </button>
              <div
                v-else
                class="prog-branch"
                :class="{
                  'is-played': i < step,
                  'is-current-row': i === step - 1,
                }"
              >
                <button
                  v-for="opt in row.options"
                  :key="opt.id"
                  type="button"
                  class="prog-opt"
                  :class="[
                    opt.item.moveNum % 2 === 1 ? 'black' : 'white',
                    {
                      'is-best-opt': opt.id === 'best',
                      'is-selected': isOptionSelected(row.pvIdx, opt.id),
                    },
                  ]"
                  @mouseenter="previewHoverOption(i, opt.id)"
                  @mouseleave="previewLeave"
                  @focus="previewHoverOption(i, opt.id)"
                  @blur="previewLeave"
                  @click="selectBranchOption(i, opt.id)"
                >
                  <span class="m-num">{{ opt.item.moveNum }}</span>
                  <span class="m-coord">{{ opt.item.coord }}</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.review-eval-panel {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--size-10);
  padding: var(--size-10);
  background: var(--color-bg-white);
  border-radius: var(--size-12);
  box-shadow: 0 var(--size-2) var(--size-8) rgba(0, 0, 0, 0.08);
  overflow: hidden;
  min-height: 0;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  font-size: var(--font-size-13);
}

.cpu-move {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.cpu-move-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-13);
}

.analyzing {
  animation: analyzing-pulse 1.5s ease-in-out infinite;
}

@keyframes analyzing-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.player-eval {
  display: flex;
  flex-direction: column;
  gap: var(--size-10);
  height: 100%;
  min-height: 0;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.panel-section + .panel-section {
  padding-top: var(--size-10);
  border-top: 1px solid var(--color-border-light);
}

.panel-label {
  display: flex;
  align-items: center;
  gap: var(--size-6);
  font-size: var(--font-size-11);
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.05em;
}

.panel-label::before {
  content: "";
  width: var(--size-3);
  height: var(--size-10);
  background: var(--color-fubuki-primary);
  border-radius: var(--size-2);
}

.panel-label-count {
  font-weight: var(--font-weight-normal);
  color: var(--color-text-secondary);
  margin-left: auto;
}

/* ── Verdict header ─────────────────────────────────────── */

.verdict-section {
  flex-shrink: 0;
}

.verdict-head {
  display: flex;
  align-items: center;
  gap: var(--size-6);
  flex-wrap: wrap;
}

.verdict-num {
  display: inline-flex;
  align-items: center;
  gap: var(--size-6);
  font-size: var(--font-size-16);
  font-weight: 500;
  font-feature-settings: "tnum";
}

.verdict-num .n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-24);
  height: var(--size-24);
  border-radius: 50%;
  background: #1a1a1a;
  color: #fff;
  font-size: var(--font-size-11);
  font-weight: 500;
}

.verdict-num .n.is-white {
  background: #fff;
  color: #1a1a1a;
  border: 1px solid var(--color-border-heavy);
}

.verdict-num .coord {
  font-size: var(--font-size-16);
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: var(--size-2) var(--size-8);
  border-radius: 999px;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
  color: #fff;
}

.tag.quality {
  background: var(--color-fubuki-primary);
}

.tag.forced {
  background: hsl(270, 50%, 55%);
}

.tag.loss {
  background: hsl(0, 65%, 50%);
}

.tag.miss {
  background: var(--color-fubuki-primary);
}

.tag.losing {
  background: hsl(0, 80%, 40%);
}

/* ── Score block ────────────────────────────────────────── */

.score-block {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--size-2) var(--size-12);
}

.score-cell {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.score-cell .label {
  font-size: var(--font-size-10);
  color: var(--color-text-secondary);
}

.score-cell .v {
  font-size: var(--font-size-14);
  font-weight: 500;
  font-feature-settings: "tnum";
}

.score-cell .v.actual {
  color: var(--color-miko-primary);
}

.score-cell .v.best {
  color: var(--color-blue-500);
}

/* ── Candidate grid ─────────────────────────────────────── */

.cand-section {
  flex-shrink: 0;
}

.cand-scroll {
  max-height: var(--size-150);
  overflow-y: auto;
  padding-right: var(--size-2);
  margin-right: calc(var(--size-2) * -1);
}

.cand-scroll::-webkit-scrollbar {
  width: 6px;
}

.cand-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.cand-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.cand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--size-56), 1fr));
  gap: var(--size-4);
}

.cand-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-12) var(--size-4) var(--size-4);
  border-radius: var(--size-8);
  border: 1px solid var(--color-border);
  background: #fff;
  cursor: pointer;
  font-family: inherit;
  font-feature-settings: "tnum";
  transition:
    transform 0.12s,
    border-color 0.12s,
    box-shadow 0.12s;
}

.cand-card:hover,
.cand-card:focus-visible {
  border-color: var(--color-fubuki-primary);
  transform: translateY(-1px);
  box-shadow: 0 var(--size-2) var(--size-6) rgba(0, 0, 0, 0.08);
  outline: none;
}

.cand-card.is-best {
  border-color: var(--color-blue-400);
  background: var(--color-blue-100);
}

.cand-card.is-actual {
  border-color: var(--color-miko-primary);
  background: var(--color-miko-bg-light);
}

.cand-card.is-danger {
  border-color: hsl(0, 65%, 50%);
}

.cand-card.is-best::after,
.cand-card.is-actual::after {
  content: "";
  position: absolute;
  top: var(--size-3);
  right: var(--size-3);
  width: var(--size-6);
  height: var(--size-6);
  border-radius: 50%;
}

.cand-card.is-best::after {
  background: var(--color-blue-500);
}

.cand-card.is-actual::after {
  background: var(--color-miko-primary);
}

.cand-rank {
  position: absolute;
  top: var(--size-2);
  left: var(--size-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-12);
  height: var(--size-12);
  border-radius: 50%;
  background: var(--color-text-light);
  color: #fff;
  font-size: var(--font-size-9);
  font-weight: 500;
}

.cand-rank.best {
  background: var(--color-blue-500);
}

.cand-rank.actual {
  background: var(--color-miko-primary);
}

.cand-coord {
  font-size: var(--font-size-13);
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.cand-delta {
  font-size: var(--font-size-9);
  line-height: 1.1;
  white-space: nowrap;
}

.cand-delta.zero {
  color: var(--color-blue-500);
}

.cand-delta.neg {
  color: var(--color-miko-primary);
}

.cand-flag {
  font-size: var(--font-size-8);
  line-height: 1.1;
  margin-top: var(--size-1);
  padding: 0 var(--size-3);
  border-radius: var(--size-2);
  white-space: nowrap;
}

.cand-flag.danger {
  background: hsl(0, 65%, 95%);
  color: hsl(0, 65%, 45%);
}

.cand-flag.fukumi {
  background: hsl(270, 50%, 95%);
  color: hsl(270, 50%, 45%);
}

/* ── Tree (tabs + controls + grid) ──────────────────────── */

.tree-section {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.tree-tabs {
  display: flex;
  gap: var(--size-1);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  scrollbar-width: thin;
  flex-shrink: 0;
}

.tree-tabs::-webkit-scrollbar {
  height: 4px;
}

.tree-tabs::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.tree-tab {
  flex: 1 0 auto;
  min-width: var(--size-60);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-4) var(--size-6) var(--size-5);
  margin-bottom: -1px;
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

.tree-tab:hover {
  background: var(--color-bg-white);
  color: var(--color-fubuki-name);
}

.tree-tab.is-on {
  background: #fff;
  color: var(--color-fubuki-name);
  border-bottom: 1px solid #fff;
  z-index: 1;
}

.tree-tab.is-loss {
  color: hsl(0, 55%, 45%);
}

.tree-tab.is-on.is-loss {
  color: hsl(0, 65%, 45%);
}

.tree-tab .tab-sub {
  font-size: var(--font-size-9);
  font-weight: var(--font-weight-normal);
  opacity: 0.85;
}

.tree-controls {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--size-4);
  flex-shrink: 0;
}

.ctl-btn {
  font-family: inherit;
  font-size: var(--font-size-10);
  font-weight: 500;
  padding: var(--size-5) var(--size-3);
  border-radius: var(--size-6);
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-text-primary);
  cursor: pointer;
  transition:
    transform 0.12s,
    border-color 0.12s,
    background 0.12s;
}

.ctl-btn:hover:not(:disabled) {
  border-color: var(--color-fubuki-primary);
  transform: translateY(-1px);
}

.ctl-btn:active:not(:disabled) {
  transform: translateY(0);
}

.ctl-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ctl-btn.primary {
  background: var(--color-fubuki-primary);
  color: #fff;
  border-color: var(--color-fubuki-primary);
}

.ctl-btn.primary:hover:not(:disabled) {
  background: var(--color-blue-500);
  border-color: var(--color-blue-500);
}

.ctl-btn.primary.is-on {
  background: var(--color-blue-500);
  border-color: var(--color-blue-500);
}

.tree-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--size-2);
  margin-right: calc(var(--size-2) * -1);
}

.tree-scroll::-webkit-scrollbar {
  width: 6px;
}

.tree-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.prog-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--size-56), 1fr));
  gap: var(--size-4);
  padding: var(--size-2) 0;
  align-content: start;
}

/* 単一手のセル（カード形式・グリッドの1セル分） */
.prog-move {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-12) var(--size-4) var(--size-4);
  border-radius: var(--size-8);
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-13);
  font-weight: 500;
  font-feature-settings: "tnum";
  cursor: pointer;
  opacity: 0.7;
  min-height: 0;
  transition:
    opacity 0.15s,
    border-color 0.15s,
    background 0.15s,
    transform 0.12s;
}

.prog-move:hover,
.prog-move:focus-visible {
  border-color: var(--color-fubuki-primary);
  opacity: 1;
  outline: none;
}

.prog-move.is-played {
  opacity: 1;
  border-color: var(--color-fubuki-primary);
  background: var(--color-fubuki-bg-light);
}

.prog-move.is-current {
  background: var(--color-fubuki-primary);
  color: #fff;
  border-color: var(--color-fubuki-primary);
  box-shadow: 0 var(--size-2) var(--size-8) rgba(84, 199, 234, 0.45);
  opacity: 1;
}

.prog-move.is-current .m-coord {
  color: #fff;
}

/* 分岐行（タブ付きコンテナ・横幅いっぱいに広げる） */
.prog-branch {
  grid-column: 1 / -1;
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  border-radius: var(--size-8);
  background: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-bottom-color: var(--color-border-heavy);
  overflow: hidden;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s,
    opacity 0.15s;
}

.prog-branch:not(.is-played) {
  opacity: 0.85;
}

.prog-branch.is-played {
  background: #fff;
  border-bottom-color: var(--color-fubuki-primary);
}

.prog-branch.is-current-row {
  border-bottom-color: var(--color-fubuki-primary);
  box-shadow: 0 var(--size-2) var(--size-8) rgba(84, 199, 234, 0.25);
}

/* 分岐タブボタン（コンテナ内で等分） */
.prog-opt {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-12) var(--size-4) var(--size-4);
  margin: 0;
  border: none;
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-gray);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-13);
  font-weight: 500;
  font-feature-settings: "tnum";
  cursor: pointer;
  flex: 1 1 0;
  min-width: 0;
  transition:
    background 0.15s,
    color 0.15s;
}

.prog-opt:last-child {
  border-right: none;
}

.prog-opt:hover,
.prog-opt:focus-visible {
  background: #fff;
  outline: none;
}

/* 推奨手にはタブ右上にドット */
.prog-opt.is-best-opt::after {
  content: "";
  position: absolute;
  top: var(--size-3);
  right: var(--size-3);
  width: var(--size-5);
  height: var(--size-5);
  border-radius: 50%;
  background: var(--color-blue-500);
}

/* 選択中タブ（active） */
.prog-opt.is-selected {
  background: #fff;
  color: var(--color-fubuki-name);
}

.prog-opt.is-selected::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 2px;
  background: var(--color-fubuki-primary);
}

/* 共通: 手番バッジ（カード左肩） */
.prog-move .m-num,
.prog-opt .m-num {
  position: absolute;
  top: var(--size-2);
  left: var(--size-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-14);
  height: var(--size-14);
  border-radius: 50%;
  font-size: var(--font-size-9);
  font-weight: 500;
}

.prog-move.black .m-num,
.prog-opt.black .m-num {
  background: #1a1a1a;
  color: #fff;
}

.prog-move.white .m-num,
.prog-opt.white .m-num {
  background: #fff;
  color: #1a1a1a;
  border: 1px solid var(--color-border-heavy);
}

.prog-move.is-current .m-num {
  box-shadow: 0 0 0 1.5px #fff;
}

.prog-move .m-coord,
.prog-opt .m-coord {
  font-size: var(--font-size-13);
  color: var(--color-text-primary);
  line-height: 1.1;
  text-align: center;
}
</style>
