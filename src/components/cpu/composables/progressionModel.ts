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

  const bestPV = buildBestPV(eval_, moveIndex);
  if (bestPV.length > 0) {
    result.push({
      id: "best",
      label: "最善",
      sub: formatMove(eval_.bestMove),
      emitType: "best",
      basePV: bestPV,
      branches: buildInlineBranches(
        eval_.forcedWinBranches ?? [],
        moveIndex,
        "win",
      ),
    });
  }

  const playedPV = buildPlayedPV(eval_, moveIndex);
  if (playedPV.length > 0) {
    result.push({
      id: "played",
      label: "実際",
      sub: formatMove(eval_.position),
      emitType: "played",
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

/**
 * basePV と選択中の分岐から表示行（Row[]）を展開する。
 *
 * @param selection アクティブタブ1つ分の pvIdx → optId マップ。
 *   （将来 #22 の再帰分岐化で、キーが「親選択を含むパス文字列」へ
 *   変わる可能性がある）
 */
export function buildRows(
  tab: ProgressionTab,
  selection: Record<number, string>,
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
        pvIdx: i,
        options,
      });

      const selected = selection[i] ?? "best";
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
 */
export function buildVisibleItems(
  rows: Row[],
  upToRowIdx: number,
  selection: Record<number, string>,
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
      const selectedId = selection[row.pvIdx] ?? "best";
      const opt =
        row.options.find((o) => o.id === selectedId) ?? row.options[0];
      if (opt) {
        items.push({ position: opt.item.position, isSelf: opt.item.isSelf });
      }
    }
  }
  return items;
}
