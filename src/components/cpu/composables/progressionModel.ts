/**
 * 振り返り進行ツリーの純粋ロジック（リアクティブ非依存）
 *
 * useReviewProgression からリアクティブ状態（ref/computed/watch/emit）を除いた
 * 「PV 構築・分岐正規化・行展開・可視手列」の純粋関数群。
 * リアクティブ環境なしで単体テストできることを目的とする。
 *
 * - PV ビルダ / 候補探索は `EvaluatedMove`（非null）契約。null ガードは
 *   入口の buildTopTabs に1箇所だけ集約する。
 * - buildRows / buildVisibleItems は「アクティブタブ1つ分」の selection
 *   （`Record<number, string>`）のみ受け取る。タブ解決は呼び出し側の責務。
 */

import type { Position } from "@/types/game";
import type {
  EvaluatedMove,
  ForcedWinBranch,
  ForcedWinNode,
  ReviewCandidate,
} from "@/types/review";

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
  /** basePV[0] の手番（= 木ルート攻め手の手番）。木ウォーカーの手番起点 */
  baseMoveNum: number;
  basePV: PVDisplayItem[];
  branches: InlineBranch[];
  /** 詰み木（#22）。あれば buildRows は木を再帰的に展開する */
  tree?: ForcedWinNode;
}

export type Row =
  | { type: "move"; key: string; item: PVDisplayItem }
  | {
      type: "branch";
      key: string;
      /**
       * 選択状態のキー（フラット: basePV index 文字列 / 木: ルートからのパス）。
       * 1タブは flat か tree の一方のみを持つため両者の名前空間は衝突しない。
       */
      selKey: string;
      /** 分岐点（防御手）の手番。aria ラベル用 */
      moveNum: number;
      options: { id: string; item: PVDisplayItem }[];
    };

/** 候補手の予想手順 (principalVariation) を PVDisplayItem[] に変換する */
export function buildPV(
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

/** 最善手に対応する候補を探す（一致なければ先頭候補にフォールバック） */
export function findBestCandidate(
  eval_: EvaluatedMove,
): ReviewCandidate | null {
  if (eval_.candidates.length === 0) {
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
}

/** 実際に着手した手に対応する候補を探す */
export function findPlayedCandidate(
  eval_: EvaluatedMove,
): ReviewCandidate | null {
  return (
    eval_.candidates.find(
      (c) =>
        c.position.row === eval_.position.row &&
        c.position.col === eval_.position.col,
    ) ?? null
  );
}

export function buildBestPV(
  eval_: EvaluatedMove,
  moveIndex: number,
): PVDisplayItem[] {
  const best = findBestCandidate(eval_);
  if (!best) {
    return [];
  }
  return buildPV(best, moveIndex, true);
}

export function buildPlayedPV(
  eval_: EvaluatedMove,
  moveIndex: number,
): PVDisplayItem[] {
  if (eval_.forcedLossSequence && eval_.forcedLossSequence.length > 0) {
    return [];
  }
  const played = findPlayedCandidate(eval_);
  if (!played) {
    return [];
  }
  return buildPV(played, moveIndex, true);
}

export function buildForcedLossPV(
  eval_: EvaluatedMove,
  moveIndex: number,
): PVDisplayItem[] {
  if (!eval_.forcedLossSequence || eval_.forcedLossSequence.length === 0) {
    return [];
  }
  const items: PVDisplayItem[] = [
    {
      isSelf: true,
      position: eval_.position,
      coord: formatMove(eval_.position),
      moveNum: moveIndex,
    },
  ];
  let n = moveIndex + 1;
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
}

/** 被詰タブのラベル（例: 「被追詰」）。SSoT としてここで一元管理する */
export function forcedLossLabelOf(eval_: EvaluatedMove): string | null {
  const type = eval_.forcedLossType;
  return type ? `被${SHORT_LABELS[type]}` : null;
}

/**
 * forcedWinBranches / forcedLossBranches を InlineBranch[] に正規化する。
 *
 * win / loss で異なるのは以下のみで、kind で吸収する:
 * - pvIdx: win は defenseIndex そのまま、loss は forcedLossPV[0] にプレイヤー
 *   着手が入るぶん +1 オフセット
 * - moveNum 起点: win は moveIndex + defenseIndex、loss はさらに +1
 * - isSelf パリティ: 防御手は win=相手(false)/loss=自分(true)、
 *   continuation はそこから交互
 */
export function buildInlineBranches(
  branches: ForcedWinBranch[],
  moveIndex: number,
  kind: "win" | "loss",
): InlineBranch[] {
  const isWin = kind === "win";
  const pvIdxOffset = isWin ? 0 : 1;
  const moveNumOffset = isWin ? 0 : 1;
  const defenseIsSelf = !isWin;

  const result: InlineBranch[] = [];
  for (let idx = 0; idx < branches.length; idx++) {
    const branch = branches[idx];
    if (!branch) {
      continue;
    }
    const branchMoveNum = moveIndex + branch.defenseIndex + moveNumOffset;
    const continuation: PVDisplayItem[] = [];
    for (let j = 0; j < branch.continuation.length; j++) {
      const pos = branch.continuation[j];
      if (!pos) {
        break;
      }
      continuation.push({
        // win: continuation 先頭が自分(j%2===0)、loss: 先頭が相手(j%2!==0)
        isSelf: isWin ? j % 2 === 0 : j % 2 !== 0,
        position: pos,
        coord: formatMove(pos),
        moveNum: branchMoveNum + 1 + j,
      });
    }
    result.push({
      id: `${kind}-${idx}`,
      pvIdx: branch.defenseIndex + pvIdxOffset,
      defenseMove: {
        isSelf: defenseIsSelf,
        position: branch.defenseMove,
        coord: formatMove(branch.defenseMove),
        moveNum: branchMoveNum,
      },
      continuation,
    });
  }
  return result;
}

/**
 * 最善 / 実際 / 被詰のタブ群を構築する。null ガードの集約点。
 */
export function buildTopTabs(
  eval_: EvaluatedMove | null,
  moveIndex: number,
): ProgressionTab[] {
  if (!eval_) {
    return [];
  }
  const result: ProgressionTab[] = [];

  // 最善タブ: 詰み木があれば木を展開（#22、basePV は木モードでは未使用）。
  // なければ候補 PV(basePV) を線形表示。
  const bestPV = buildBestPV(eval_, moveIndex);
  if (bestPV.length > 0 || eval_.forcedWinTree) {
    result.push({
      id: "best",
      label: "最善",
      sub: formatMove(eval_.bestMove),
      emitType: "best",
      baseMoveNum: moveIndex,
      basePV: bestPV,
      branches: [],
      tree: eval_.forcedWinTree,
    });
  }

  const playedPV = buildPlayedPV(eval_, moveIndex);
  if (playedPV.length > 0) {
    result.push({
      id: "played",
      label: "実際",
      sub: formatMove(eval_.position),
      emitType: "played",
      baseMoveNum: moveIndex,
      basePV: playedPV,
      branches: [],
    });
  }

  const forcedLossPV = buildForcedLossPV(eval_, moveIndex);
  if (forcedLossPV.length > 0) {
    result.push({
      id: "loss",
      label: forcedLossLabelOf(eval_) ?? "被詰",
      sub: formatMove(eval_.position),
      emitType: "played",
      baseMoveNum: moveIndex,
      basePV: forcedLossPV,
      branches: buildInlineBranches(
        eval_.forcedLossBranches ?? [],
        moveIndex,
        "loss",
      ),
    });
  }

  return result;
}

/** 再帰の安全上限（malformed tree に対するガード） */
const MAX_WALK_DEPTH = 256;

/**
 * basePV と選択中の分岐から表示行（Row[]）を展開する。
 *
 * 詰み木（tab.tree）があれば木を選択経路に沿って再帰展開し、任意の深さの
 * 分岐を出す（#22）。なければ basePV ＋ フラット分岐（被詰タブ等）を展開する。
 *
 * @param selection アクティブタブ1つ分の selKey → optId マップ。
 *   selKey はフラットでは basePV index 文字列、木ではルートからのパス文字列。
 */
export function buildRows(
  tab: ProgressionTab,
  selection: Record<string, string>,
): Row[] {
  if (tab.tree) {
    const rows: Row[] = [];
    walkTreeNode(tab, tab.tree, "", 0, selection, rows, 0);
    return rows;
  }
  return buildRowsFlat(tab, selection);
}

function moveItem(
  position: Position,
  isSelf: boolean,
  moveNum: number,
): PVDisplayItem {
  return { isSelf, position, coord: formatMove(position), moveNum };
}

/**
 * 詰み木を選択経路に沿って再帰展開する。
 * 攻め手は self（攻め始まり交互）。防御が2件以上なら branch 行を出し、
 * 選択（既定 index 0 = "best"）した防御の継続へ降りる。
 */
function walkTreeNode(
  tab: ProgressionTab,
  node: ForcedWinNode,
  pathKey: string,
  ply: number,
  selection: Record<string, string>,
  rows: Row[],
  depth: number,
): void {
  if (depth >= MAX_WALK_DEPTH) {
    return;
  }
  // 攻め手（ply 偶数 = self）
  rows.push({
    type: "move",
    key: `${tab.id}-m-${pathKey}-${ply}`,
    item: moveItem(node.attackerMove, ply % 2 === 0, tab.baseMoveNum + ply),
  });
  if (node.defenses.length === 0) {
    return;
  }
  const defPly = ply + 1;
  if (node.defenses.length === 1) {
    const d = node.defenses[0]!;
    rows.push({
      type: "move",
      key: `${tab.id}-m-${pathKey}-${defPly}`,
      item: moveItem(d.defenderMove, false, tab.baseMoveNum + defPly),
    });
    walkTreeNode(tab, d.next, pathKey, ply + 2, selection, rows, depth + 1);
    return;
  }
  // 分岐: 防御2件以上
  const options = node.defenses.map((d, idx) => ({
    id: idx === 0 ? "best" : String(idx),
    item: moveItem(d.defenderMove, false, tab.baseMoveNum + defPly),
  }));
  rows.push({
    type: "branch",
    key: `${tab.id}-br-${pathKey}-${defPly}`,
    selKey: pathKey,
    moveNum: tab.baseMoveNum + defPly,
    options,
  });
  const selId = selection[pathKey] ?? "best";
  const parsed = selId === "best" ? 0 : Number(selId);
  // 不正値（NaN・範囲外）は主筋(0)へフォールバックし childKey の破損を防ぐ
  const selIdx =
    Number.isInteger(parsed) && parsed >= 0 && parsed < node.defenses.length
      ? parsed
      : 0;
  const chosen = node.defenses[selIdx]!;
  const childKey = pathKey === "" ? String(selIdx) : `${pathKey}/${selIdx}`;
  walkTreeNode(tab, chosen.next, childKey, ply + 2, selection, rows, depth + 1);
}

/** basePV ＋ フラット分岐（被詰タブ等、#26 まで）の行展開 */
function buildRowsFlat(
  tab: ProgressionTab,
  selection: Record<string, string>,
): Row[] {
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
        selKey: String(i),
        moveNum: baseItem.moveNum,
        options,
      });

      const selected = selection[String(i)] ?? "best";
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
}

/**
 * 行 0..upToRowIdx-1 の可視手列を返す（盤面プレビュー用）。
 * branch 行は selection で選ばれたオプション（既定 best）を採用する。
 * 木モードでは rows が既に選択経路に沿って展開済みのため、branch 行は
 * 選択オプションの1手のみを寄与する（後続行が継続を表す）。
 */
export function buildVisibleItems(
  rows: Row[],
  upToRowIdx: number,
  selection: Record<string, string>,
): { position: Position; isSelf: boolean }[] {
  const items: { position: Position; isSelf: boolean }[] = [];
  for (let r = 0; r < upToRowIdx && r < rows.length; r++) {
    const row = rows[r];
    if (!row) {
      break;
    }
    if (row.type === "move") {
      items.push({ position: row.item.position, isSelf: row.item.isSelf });
    } else {
      const selectedId = selection[row.selKey] ?? "best";
      const opt =
        row.options.find((o) => o.id === selectedId) ?? row.options[0];
      if (opt) {
        items.push({ position: opt.item.position, isSelf: opt.item.isSelf });
      }
    }
  }
  return items;
}
