<script setup lang="ts">
/**
 * 振り返り評価結果パネル
 *
 * 現在表示中の手の評価（スコア・順位・候補手リスト）を表示。
 */

import { computed, ref, watch } from "vue";

import type {
  EvaluatedMove,
  ForcedWinBranch,
  ReviewCandidate,
} from "@/types/review";
import type { Position } from "@/types/game";
import { formatMove } from "@/logic/gameRecordParser";
import { getQualityLabel, getQualityColor } from "@/logic/reviewLogic";
import ReviewEvalHelpDialog from "./ReviewEvalHelpDialog.vue";
import {
  getLeafBreakdownItems,
  formatScore as formatScoreUtil,
  patternLabels,
  type LeafBreakdownItem,
} from "@/logic/cpu/evaluation/breakdownUtils";

const props = defineProps<{
  /** 現在の手の評価データ */
  evaluation: EvaluatedMove | null;
  /** 表示中の手数（1始まり） */
  moveIndex: number;
  /** 現在の手の位置（evaluation がない場合にCPU手の座標表示用） */
  currentPosition: Position | null;
  /** 評価中かどうか */
  isEvaluating?: boolean;
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

/** クリック固定されたPV手 */
const pinnedPv = ref<{ line: "best" | "played"; index: number } | null>(null);

// 手数変更時にリセット
watch(
  () => props.moveIndex,
  () => {
    pinnedPv.value = null;
  },
);

const formatScore = formatScoreUtil;

/** 実際に打った手の順位（候補手の中で何位か、上位5位内のみ） */
const playedRank = computed<number | "unranked" | null>(() => {
  const eval_ = props.evaluation;
  if (!eval_) {
    return null;
  }
  const idx = eval_.candidates.findIndex(
    (c) =>
      c.position.row === eval_.position.row &&
      c.position.col === eval_.position.col,
  );
  if (idx < 0) {
    return null;
  }
  return idx < 5 ? idx + 1 : "unranked";
});

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
  // 両ミセ見逃し時は missedDoubleMiseLabel に委譲（重複バッジを防止）
  const missed = props.evaluation?.missedDoubleMise;
  switch (props.evaluation?.forcedWinType) {
    case "double-mise":
      return missed && missed.length > 0 ? null : "両ミセ";
    case "vcf":
      return "四追";
    case "vct":
      return "追詰";
    case "forbidden-trap":
      return "禁手追込";
    case "mise-vcf":
      return "ミセ四追";
    default:
      return null;
  }
});

/** 負け確定インジケーターのテキスト */
const forcedLossLabel = computed(() => {
  switch (props.evaluation?.forcedLossType) {
    case "double-mise":
      return "被両ミセ";
    case "vcf":
      return "被四追";
    case "vct":
      return "被追詰";
    case "forbidden-trap":
      return "被禁手追込";
    case "mise-vcf":
      return "被ミセ四追";
    default:
      return null;
  }
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
  switch (props.evaluation?.forcedWinType) {
    case "double-mise":
      return "両ミセ中";
    case "vcf":
      return "四追い中";
    case "vct":
      return "追詰中";
    case "forbidden-trap":
      return "禁手追込中";
    case "mise-vcf":
      return "ミセ四追中";
    default:
      return null;
  }
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

/** 末端評価の差分項目 */
interface LeafDiffItem {
  key: string;
  label: string;
  bestValue: number;
  playedValue: number;
  category: string;
}

/**
 * 末端評価の差分を計算（差がある項目のみ）
 */
function diffLeafItems(
  bestItems: LeafBreakdownItem[],
  playedItems: LeafBreakdownItem[],
  category: string,
): LeafDiffItem[] {
  const allKeys = new Set([
    ...bestItems.map((i) => i.key),
    ...playedItems.map((i) => i.key),
  ]);
  const result: LeafDiffItem[] = [];
  for (const key of allKeys) {
    const bestItem = bestItems.find((i) => i.key === key);
    const playedItem = playedItems.find((i) => i.key === key);
    const bestValue = bestItem?.score ?? 0;
    const playedValue = playedItem?.score ?? 0;
    if (bestValue !== playedValue) {
      result.push({
        key,
        label: patternLabels[key] ?? key,
        bestValue,
        playedValue,
        category,
      });
    }
  }
  return result;
}

/** カテゴリごとにグループ化した末端差分 */
interface LeafDiffGroup {
  category: string;
  items: LeafDiffItem[];
  bestTotal: number;
  playedTotal: number;
}

function sumGroup(items: LeafDiffItem[]): {
  bestTotal: number;
  playedTotal: number;
} {
  let bestTotal = 0;
  let playedTotal = 0;
  for (const item of items) {
    bestTotal += item.bestValue;
    playedTotal += item.playedValue;
  }
  return { bestTotal, playedTotal };
}

/** 末端評価の差分をカテゴリ別にグループ化 */
const leafEvalDiffGroups = computed<LeafDiffGroup[]>(() => {
  const eval_ = props.evaluation;
  if (!eval_ || eval_.quality === "excellent") {
    return [];
  }
  const best = bestCandidate.value;
  const played = playedCandidate.value;
  if (!best?.leafEvaluation || !played?.leafEvaluation) {
    return [];
  }

  const groups: LeafDiffGroup[] = [];
  const myItems = diffLeafItems(
    getLeafBreakdownItems(best.leafEvaluation.myBreakdown),
    getLeafBreakdownItems(played.leafEvaluation.myBreakdown),
    "自分",
  );
  if (myItems.length > 0) {
    groups.push({ category: "自分", items: myItems, ...sumGroup(myItems) });
  }
  const oppItems = diffLeafItems(
    getLeafBreakdownItems(best.leafEvaluation.opponentBreakdown),
    getLeafBreakdownItems(played.leafEvaluation.opponentBreakdown),
    "相手",
  );
  if (oppItems.length > 0) {
    groups.push({
      category: "相手",
      items: oppItems,
      ...sumGroup(oppItems),
    });
  }
  return groups;
});

/** 差引（自分 - 相手） */
const leafEvalNet = computed<{
  best: number;
  played: number;
} | null>(() => {
  const groups = leafEvalDiffGroups.value;
  if (groups.length === 0) {
    return null;
  }
  const my = groups.find((g) => g.category === "自分");
  const opp = groups.find((g) => g.category === "相手");
  return {
    best: (my?.bestTotal ?? 0) - (opp?.bestTotal ?? 0),
    played: (my?.playedTotal ?? 0) - (opp?.playedTotal ?? 0),
  };
});

/** PV表示アイテム */
interface PVDisplayItem {
  text: string;
  isSelf: boolean;
  position: Position;
}

/** 読み筋データ */
interface PVLine {
  label: string;
  searchScore: number;
  items: PVDisplayItem[];
}

/** 候補手からPVデータを構築 */
function buildPVLine(
  candidate: ReviewCandidate,
  label: string,
  moveIndex: number,
): PVLine | null {
  if (
    !candidate.principalVariation ||
    candidate.principalVariation.length <= 1
  ) {
    return null;
  }

  const items: PVDisplayItem[] = [];
  for (let i = 0; i < candidate.principalVariation.length; i++) {
    const pos = candidate.principalVariation[i];
    if (!pos) {
      break;
    }
    items.push({
      text: `${moveIndex + i}.${formatMove(pos)}`,
      isSelf: i % 2 === 0,
      position: pos,
    });
  }

  return { label, searchScore: candidate.searchScore, items };
}

/** 最善手のPV+推移 */
const bestPVLine = computed<PVLine | null>(() => {
  const eval_ = props.evaluation;
  const best = bestCandidate.value;
  if (!eval_ || !best) {
    return null;
  }
  return buildPVLine(
    best,
    `最善 ${formatMove(eval_.bestMove)}`,
    props.moveIndex,
  );
});

/** 分岐表示データ */
interface BranchLine {
  key: string;
  label: string;
  prefix: string;
  /** メインPVの分岐点前 + 防御手（ホバー時に先頭に付与） */
  prefixItems: PVDisplayItem[];
  items: PVDisplayItem[];
}

const branchLines = computed<BranchLine[]>(() => {
  const eval_ = props.evaluation;
  if (!eval_?.forcedWinBranches || eval_.forcedWinBranches.length === 0) {
    return [];
  }
  const bestPVItems = bestPVLine.value?.items;
  if (!bestPVItems) {
    return [];
  }

  return eval_.forcedWinBranches.map(
    (branch: ForcedWinBranch, branchIdx: number) => {
      // 防御手の手番号（PVの defenseIndex 位置）
      const moveNum = props.moveIndex + branch.defenseIndex;
      const label = "の場合:";
      const prefix =
        branchIdx === (eval_.forcedWinBranches?.length ?? 0) - 1 ? "└" : "├";

      // メインPVの分岐点前の手（ホバー時に盤面プレビュー用）
      const prefixItems: PVDisplayItem[] = bestPVItems.slice(
        0,
        branch.defenseIndex,
      );

      // 防御手自体 + 継続手順
      const defenseItem: PVDisplayItem = {
        text: `${moveNum}.${formatMove(branch.defenseMove)}`,
        isSelf: false,
        position: branch.defenseMove,
      };
      const items: PVDisplayItem[] = [defenseItem];
      for (let i = 0; i < branch.continuation.length; i++) {
        const pos = branch.continuation[i];
        if (!pos) {
          break;
        }
        const num = moveNum + 1 + i;
        items.push({
          text: `${num}.${formatMove(pos)}`,
          isSelf: i % 2 === 0, // 攻撃手=自分
          position: pos,
        });
      }

      return {
        key: `branch-${branchIdx}`,
        label,
        prefix,
        prefixItems,
        items,
      };
    },
  );
});

/** 実際の手のPV+推移 */
const playedPVLine = computed<PVLine | null>(() => {
  const eval_ = props.evaluation;
  const played = playedCandidate.value;
  if (!eval_ || !played) {
    return null;
  }
  return buildPVLine(
    played,
    `実際 ${formatMove(eval_.position)}`,
    props.moveIndex,
  );
});

/** 負け確定手順の読み筋（相手視点） */
const forcedLossPVLine = computed<PVLine | null>(() => {
  const eval_ = props.evaluation;
  if (!eval_?.forcedLossSequence || eval_.forcedLossSequence.length === 0) {
    return null;
  }

  const label = forcedLossLabel.value ?? "被必勝";
  const items: PVDisplayItem[] = [];

  // プレイヤーの着手を先頭に含める
  // → 'played' モードで盤面ラベル番号(currentMoveIndex + i)と整合させる
  items.push({
    text: `${props.moveIndex}.${formatMove(eval_.position)}`,
    isSelf: true,
    position: eval_.position,
  });

  // 相手の必勝手順（着手後の局面から算出）
  const startMoveNum = props.moveIndex + 1;
  for (let i = 0; i < eval_.forcedLossSequence.length; i++) {
    const pos = eval_.forcedLossSequence[i];
    if (!pos) {
      break;
    }
    items.push({
      text: `${startMoveNum + i}.${formatMove(pos)}`,
      // 相手の必勝手順: 偶数手=相手（攻撃側）、奇数手=自分（防御側）
      isSelf: i % 2 !== 0,
      position: pos,
    });
  }

  return { label, searchScore: 0, items };
});

/** 内訳比較表示が必要か */
const showBreakdown = computed(
  () =>
    leafEvalDiffGroups.value.length > 0 ||
    bestPVLine.value !== null ||
    playedPVLine.value !== null ||
    forcedLossPVLine.value !== null,
);

/** ヘルプダイアログのref */
const helpDialogRef = ref<InstanceType<typeof ReviewEvalHelpDialog> | null>(
  null,
);

function openHelp(): void {
  helpDialogRef.value?.showModal();
}

function handleCandidateEnter(position: Position): void {
  emit("hoverCandidate", position);
}

function handleCandidateLeave(): void {
  emit("leaveCandidate");
}

function emitPvSlice(
  items: PVDisplayItem[],
  index: number,
  type: "best" | "played",
): void {
  emit(
    "hoverPvMove",
    items.slice(0, index + 1).map((item) => ({
      position: item.position,
      isSelf: item.isSelf,
    })),
    type,
  );
}

function handlePVMoveEnter(
  items: PVDisplayItem[],
  index: number,
  type: "best" | "played",
): void {
  if (pinnedPv.value) {
    return;
  }
  emitPvSlice(items, index, type);
}

function handleBranchMoveEnter(branch: BranchLine, index: number): void {
  if (pinnedPv.value) {
    return;
  }
  const allItems = [...branch.prefixItems, ...branch.items.slice(0, index + 1)];
  emit(
    "hoverPvMove",
    allItems.map((item) => ({
      position: item.position,
      isSelf: item.isSelf,
    })),
    "best",
  );
}

function handlePVMoveLeave(): void {
  if (pinnedPv.value) {
    return;
  }
  emit("leavePvMove");
}

function handlePVMoveClick(
  items: PVDisplayItem[],
  index: number,
  type: "best" | "played",
): void {
  // 同じ手をクリック → 固定解除
  if (pinnedPv.value?.line === type && pinnedPv.value.index === index) {
    pinnedPv.value = null;
    emit("leavePvMove");
    return;
  }

  pinnedPv.value = { line: type, index };
  emitPvSlice(items, index, type);
}

/** PV手が固定範囲内か */
function isPvPinned(line: "best" | "played", index: number): boolean {
  const pin = pinnedPv.value;
  return pin !== null && pin.line === line && index <= pin.index;
}

function isPlayed(candidate: { position: Position }): boolean {
  const eval_ = props.evaluation;
  if (!eval_) {
    return false;
  }
  return (
    candidate.position.row === eval_.position.row &&
    candidate.position.col === eval_.position.col
  );
}
</script>

<template>
  <div class="review-eval-panel">
    <!-- 初期状態（手が選択されていない） -->
    <div
      v-if="moveIndex === 0"
      class="no-eval"
    >
      <span class="no-eval-text">手を選択してください</span>
    </div>

    <!-- 解析中（まだ結果が届いていない手） -->
    <div
      v-else-if="!evaluation && isEvaluating"
      class="cpu-move"
    >
      <div class="eval-header">
        <span class="move-label">
          <span class="move-index">{{ moveIndex }}:</span>
          {{ moveCoord }}
        </span>
      </div>
      <div class="cpu-move-text analyzing-text">解析中...</div>
    </div>

    <!-- CPUの手（evaluationがない or 軽量評価） -->
    <div
      v-else-if="!evaluation || evaluation.isLightEval"
      class="cpu-move"
    >
      <div class="eval-header">
        <span class="move-label">
          <span class="move-index">{{ moveIndex }}:</span>
          {{ moveCoord }}
        </span>
        <span
          v-if="cpuForcedWinLabel"
          class="cpu-forced-win-badge"
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
      <!-- ヘッダ: 手番号 + 座標 + 品質ラベル + ヘルプ -->
      <div class="eval-header">
        <span class="move-label">
          <span class="move-index">{{ moveIndex }}:</span>
          {{ moveCoord }}
        </span>
        <span
          class="quality-badge"
          :style="{ backgroundColor: qualityColor }"
        >
          {{ qualityLabel }}
        </span>
        <span
          v-if="forcedWinLabel"
          class="forced-win-badge"
        >
          {{ forcedWinLabel }}
        </span>
        <span
          v-if="forcedLossLabel"
          class="forced-loss-badge"
        >
          {{ forcedLossLabel }}
        </span>
        <span
          v-if="missedDoubleMiseLabel"
          class="missed-double-mise-badge"
        >
          {{ missedDoubleMiseLabel }}
        </span>
        <button
          type="button"
          class="help-button"
          aria-label="評価の読み方ヘルプ"
          @click="openHelp"
        >
          ?
        </button>
      </div>

      <!-- スコア情報（2×2グリッド） -->
      <div class="score-grid">
        <div class="score-cell">
          <span class="score-label">実際:</span>
          <span class="score-value">
            {{ formatScore(evaluation.playedScore) }}
          </span>
        </div>
        <div class="score-cell">
          <span class="score-label">最善:</span>
          <span class="score-value best">
            {{ formatScore(evaluation.bestScore) }}
          </span>
        </div>
        <div class="score-cell">
          <span class="score-label">差:</span>
          <span class="score-value diff">-{{ evaluation.scoreDiff }}</span>
        </div>
        <div
          v-if="playedRank !== null"
          class="score-cell"
        >
          <span class="score-label">順位:</span>
          <span class="score-value">
            {{
              playedRank === "unranked"
                ? "-"
                : `${playedRank}位/${Math.min(evaluation.candidates.length, 5)}候補`
            }}
          </span>
        </div>
      </div>

      <!-- スコアの注意書き -->
      <div class="pv-note">
        ※ スコアは総合評価。末端評価単体の値と傾向が異なる場合あり。
      </div>

      <!-- 候補手チップ -->
      <div
        v-if="evaluation.candidates.length > 0"
        class="candidate-chips"
      >
        <span
          v-for="(candidate, idx) in evaluation.candidates"
          :key="`${candidate.position.row}-${candidate.position.col}`"
          class="candidate-chip"
          :class="{ 'chip-played': isPlayed(candidate) }"
          tabindex="0"
          @mouseenter="handleCandidateEnter(candidate.position)"
          @mouseleave="handleCandidateLeave"
          @focus="handleCandidateEnter(candidate.position)"
          @blur="handleCandidateLeave"
        >
          <span class="chip-rank">{{ idx < 5 ? `#${idx + 1}` : "—" }}</span>
          :
          <span class="chip-pos">{{ formatMove(candidate.position) }}</span>
          /
          <span class="chip-score">
            {{ formatScore(candidate.searchScore ?? candidate.score) }}
          </span>
          <span
            v-if="isPlayed(candidate)"
            class="chip-tag"
          >
            ◂
          </span>
        </span>
      </div>

      <!-- 内訳比較セクション（excellentでない場合 or 強制勝ち/負け確定） -->
      <div
        v-if="
          showBreakdown &&
          (evaluation.quality !== 'excellent' ||
            evaluation.forcedWinType ||
            evaluation.forcedLossType)
        "
        class="breakdown-section"
      >
        <div class="breakdown-divider" />

        <!-- 読み筋（最善手） -->
        <template v-if="bestPVLine">
          <div class="pv-header">
            <span class="pv-label">{{ bestPVLine.label }}</span>
            <span class="pv-search-score pv-best-score">
              {{ formatScore(bestPVLine.searchScore) }}
            </span>
          </div>
          <div class="pv-sequence">
            <button
              v-for="(item, idx) in bestPVLine.items"
              :key="`best-${idx}`"
              type="button"
              class="pv-move"
              :class="{
                'pv-self': item.isSelf,
                'pv-opponent': !item.isSelf,
                'pv-pinned': isPvPinned('best', idx),
              }"
              @mouseenter="handlePVMoveEnter(bestPVLine.items, idx, 'best')"
              @mouseleave="handlePVMoveLeave"
              @focus="handlePVMoveEnter(bestPVLine.items, idx, 'best')"
              @blur="handlePVMoveLeave"
              @click="handlePVMoveClick(bestPVLine.items, idx, 'best')"
            >
              {{ item.text }}
            </button>
          </div>
          <!-- 分岐表示 -->
          <div
            v-for="branch in branchLines"
            :key="branch.key"
            class="pv-branch"
          >
            <span class="pv-branch-prefix">{{ branch.prefix }}</span>
            <div class="pv-sequence pv-branch-sequence">
              <!-- 防御手ボタン -->
              <button
                v-if="branch.items[0]"
                type="button"
                class="pv-move pv-opponent"
                @mouseenter="handleBranchMoveEnter(branch, 0)"
                @mouseleave="handlePVMoveLeave"
                @focus="handleBranchMoveEnter(branch, 0)"
                @blur="handlePVMoveLeave"
              >
                {{ branch.items[0].text }}
              </button>
              <span class="pv-branch-label">{{ branch.label }}</span>
              <!-- 継続手順 -->
              <button
                v-for="(item, idx) in branch.items.slice(1)"
                :key="`${branch.key}-${idx + 1}`"
                type="button"
                class="pv-move"
                :class="{
                  'pv-self': item.isSelf,
                  'pv-opponent': !item.isSelf,
                }"
                @mouseenter="handleBranchMoveEnter(branch, idx + 1)"
                @mouseleave="handlePVMoveLeave"
                @focus="handleBranchMoveEnter(branch, idx + 1)"
                @blur="handlePVMoveLeave"
              >
                {{ item.text }}
              </button>
            </div>
          </div>
        </template>

        <!-- 読み筋（実際の手） -->
        <template v-if="playedPVLine">
          <div class="pv-header">
            <span class="pv-label">{{ playedPVLine.label }}</span>
            <span class="pv-search-score">
              {{ formatScore(playedPVLine.searchScore) }}
            </span>
          </div>
          <div class="pv-sequence">
            <button
              v-for="(item, idx) in playedPVLine.items"
              :key="`played-${idx}`"
              type="button"
              class="pv-move"
              :class="{
                'pv-self': item.isSelf,
                'pv-opponent': !item.isSelf,
                'pv-pinned': isPvPinned('played', idx),
              }"
              @mouseenter="handlePVMoveEnter(playedPVLine.items, idx, 'played')"
              @mouseleave="handlePVMoveLeave"
              @focus="handlePVMoveEnter(playedPVLine.items, idx, 'played')"
              @blur="handlePVMoveLeave"
              @click="handlePVMoveClick(playedPVLine.items, idx, 'played')"
            >
              {{ item.text }}
            </button>
          </div>
        </template>

        <!-- 負け確定手順 -->
        <template v-if="forcedLossPVLine">
          <div class="pv-header">
            <span class="pv-label pv-loss-label">
              {{ forcedLossPVLine.label }}
            </span>
          </div>
          <div class="pv-sequence">
            <button
              v-for="(item, idx) in forcedLossPVLine.items"
              :key="`loss-${idx}`"
              type="button"
              class="pv-move"
              :class="{
                'pv-self': item.isSelf,
                'pv-loss-opponent': !item.isSelf,
                'pv-pinned': isPvPinned('played', idx),
              }"
              @mouseenter="
                handlePVMoveEnter(forcedLossPVLine.items, idx, 'played')
              "
              @mouseleave="handlePVMoveLeave"
              @focus="handlePVMoveEnter(forcedLossPVLine.items, idx, 'played')"
              @blur="handlePVMoveLeave"
              @click="handlePVMoveClick(forcedLossPVLine.items, idx, 'played')"
            >
              {{ item.text }}
            </button>
          </div>
        </template>

        <!-- 末端評価の比較テーブル -->
        <template v-if="leafEvalDiffGroups.length > 0">
          <div class="breakdown-title-row">
            <span class="breakdown-title">末端比較</span>
          </div>
          <table class="breakdown-table">
            <thead>
              <tr>
                <th class="bd-th" />
                <th class="bd-th" />
                <th class="bd-th-best">最善</th>
                <th class="bd-th-played">実際</th>
              </tr>
            </thead>
            <tbody
              v-for="group in leafEvalDiffGroups"
              :key="group.category"
            >
              <tr
                v-for="(item, idx) in group.items"
                :key="item.key"
              >
                <th
                  v-if="idx === 0"
                  class="bd-category"
                  scope="rowgroup"
                  :rowspan="group.items.length + 1"
                >
                  {{ group.category }}
                </th>
                <th
                  class="bd-label"
                  scope="row"
                >
                  {{ item.label }}
                </th>
                <td class="bd-best">{{ formatScore(item.bestValue) }}</td>
                <td class="bd-played">{{ formatScore(item.playedValue) }}</td>
              </tr>
              <!-- 小計行 -->
              <tr class="bd-subtotal-row">
                <th
                  class="bd-subtotal-label"
                  scope="row"
                >
                  小計
                </th>
                <td class="bd-best bd-subtotal">
                  {{ formatScore(group.bestTotal) }}
                </td>
                <td class="bd-played bd-subtotal">
                  {{ formatScore(group.playedTotal) }}
                </td>
              </tr>
            </tbody>
            <!-- 差引行 -->
            <tfoot v-if="leafEvalNet">
              <tr class="bd-net-row">
                <th
                  class="bd-net-label"
                  colspan="2"
                  scope="row"
                >
                  差引
                </th>
                <td class="bd-best bd-net">
                  {{ formatScore(leafEvalNet.best) }}
                </td>
                <td class="bd-played bd-net">
                  {{ formatScore(leafEvalNet.played) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </template>
      </div>
    </div>
  </div>

  <ReviewEvalHelpDialog ref="helpDialogRef" />
</template>

<style scoped>
.review-eval-panel {
  padding: var(--size-8);
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.no-eval {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.no-eval-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-14);
}

.cpu-move {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.cpu-move-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-14);
}

.analyzing-text {
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
  gap: var(--size-6);
  height: 100%;
  min-height: 0;
}

.eval-header {
  display: flex;
  align-items: center;
  gap: var(--size-8);
}

.move-label {
  font-size: var(--font-size-13);
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.move-index {
  font-size: var(--font-size-11);
  color: var(--color-text-secondary);
}

.quality-badge {
  padding: var(--size-1) var(--size-6);
  border-radius: var(--size-4);
  color: white;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
}

.forced-win-badge {
  padding: var(--size-1) var(--size-6);
  border-radius: var(--size-4);
  color: white;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
  background-color: hsl(270, 50%, 55%);
}

.forced-loss-badge {
  padding: var(--size-1) var(--size-6);
  border-radius: var(--size-4);
  color: white;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
  background-color: hsl(0, 65%, 50%);
}

.missed-double-mise-badge {
  padding: var(--size-1) var(--size-6);
  border-radius: var(--size-4);
  color: white;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
  background-color: hsl(30, 80%, 50%);
}

.cpu-forced-win-badge {
  padding: var(--size-1) var(--size-6);
  border-radius: var(--size-4);
  color: white;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
  background-color: hsl(270, 50%, 55%);
}

/* スコア情報（2×2グリッド） */
.score-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--size-1) var(--size-6);
  font-size: var(--font-size-11);
  font-family: monospace;
}

.score-cell {
  display: flex;
  gap: var(--size-4);
}

.score-label {
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.score-value {
  color: var(--color-text-primary);
  white-space: nowrap;
}

.score-value.best {
  color: hsl(186, 60%, 40%);
  font-weight: 500;
}

.score-value.diff {
  color: var(--color-miko-primary);
}

/* 候補手チップ */
.candidate-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2);
  font-size: var(--font-size-10);
  font-family: monospace;
}

.candidate-chip {
  display: inline-flex;
  padding: 0 var(--size-3);
  border-radius: var(--size-3);
  cursor: pointer;
  background: rgba(0, 0, 0, 0.04);
  transition: background-color 0.15s ease;
  outline: none;

  &:hover,
  &:focus-visible {
    background: rgba(95, 222, 236, 0.15);
  }

  &.chip-played {
    background: rgba(95, 222, 236, 0.15);
    border: 1px solid rgba(95, 222, 236, 0.3);
    padding: 0 calc(var(--size-3) - 1px);
  }
}

.chip-rank {
  color: var(--color-text-secondary);
}

.chip-pos {
  font-weight: 500;
  color: var(--color-text-primary);
}

.chip-score {
  color: var(--color-text-secondary);
}

.chip-tag {
  color: hsl(186, 60%, 40%);
}

/* 内訳比較セクション */
.breakdown-section {
  font-size: var(--font-size-10);
  font-family: monospace;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.breakdown-divider {
  height: 1px;
  background: var(--color-border-light);
  margin: var(--size-2) 0;
}

.breakdown-title-row {
  margin-bottom: var(--size-1);
}

.breakdown-title {
  color: var(--color-text-secondary);
  font-size: var(--font-size-9);
}

.help-button {
  position: relative;
  width: var(--size-16);
  height: var(--size-16);
  padding: 0;
  margin-left: auto;
  background: var(--color-text-secondary);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: var(--font-size-10);
  font-weight: 500;
  line-height: var(--size-16);
  text-align: center;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s ease;
  flex-shrink: 0;

  &:hover {
    opacity: 1;
  }

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: var(--size-48);
    height: var(--size-48);
  }
}

/* 末端比較テーブル */
.breakdown-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--color-border);
  background: var(--color-background-secondary);

  th,
  td {
    padding: 0 var(--size-2);
    border: 1px solid var(--color-border);
  }
}

.bd-th {
  border: none;
  background: transparent;
}

.bd-th-best {
  color: hsl(186, 60%, 40%);
  font-weight: 500;
  text-align: right;
}

.bd-th-played {
  color: var(--color-text-primary);
  text-align: right;
}

.bd-category {
  color: var(--color-text-secondary);
  font-weight: 500;
  width: var(--size-24);
  vertical-align: middle;
  text-align: center;
  background: var(--color-bg-gray);
}

.bd-label {
  color: var(--color-text-secondary);
  font-weight: 500;
  background: var(--color-bg-gray);
}

.bd-best {
  color: hsl(186, 60%, 40%);
  font-weight: 500;
  text-align: right;
}

.bd-played {
  color: var(--color-text-primary);
  text-align: right;
}

.bd-subtotal-row {
  border-top: 1px solid var(--color-border);
}

.bd-subtotal-label {
  color: var(--color-text-secondary);
  font-weight: 500;
  text-align: right;
  background: var(--color-bg-gray);
}

.bd-subtotal {
  font-weight: 500;
}

.bd-net-row {
  border-top: 2px solid var(--color-border);
}

.bd-net-label {
  color: var(--color-text-primary);
  font-weight: 500;
  text-align: center;
  background: var(--color-bg-gray);
}

.bd-net {
  font-weight: 500;
}

/* 読み筋 + スコア推移 */
.pv-header {
  display: flex;
  align-items: center;
  gap: var(--size-4);
  margin-top: var(--size-2);
}

.pv-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-9);
}

.pv-search-score {
  color: var(--color-text-secondary);
  font-size: var(--font-size-9);
  font-family: monospace;
}

.pv-best-score {
  color: hsl(186, 60%, 40%);
}

.pv-sequence {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2);
  font-size: var(--font-size-10);
  font-family: monospace;
}

.pv-move {
  border: none;
  font: inherit;
  padding: 0 var(--size-2);
  border-radius: var(--size-2);
  cursor: pointer;
  outline: none;

  &:hover,
  &:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 0;
  }
}

.pv-self {
  background: rgba(95, 222, 236, 0.15);
  color: hsl(186, 60%, 40%);
}

.pv-loss-label {
  color: hsl(0, 65%, 50%);
}

.pv-loss-opponent {
  background: rgba(220, 50, 50, 0.12);
  color: hsl(0, 55%, 45%);
}

.pv-opponent {
  background: rgba(0, 0, 0, 0.08);
  color: var(--color-text-secondary);
}

.pv-pinned {
  outline: 1px solid currentColor;
  outline-offset: 0;
}

/* 分岐表示 */
.pv-branch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--size-2);
  margin-top: var(--size-1);
  padding-left: var(--size-4);
  font-size: var(--font-size-9);
  opacity: 0.8;
}

.pv-branch-prefix {
  color: var(--color-text-secondary);
  font-family: monospace;
  line-height: 1;
}

.pv-branch-label {
  color: var(--color-text-secondary);
  font-family: monospace;
  white-space: nowrap;
}

.pv-branch-sequence {
  font-size: var(--font-size-9);
}

.pv-note {
  margin-top: var(--size-3);
  font-size: var(--font-size-8);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
</style>
