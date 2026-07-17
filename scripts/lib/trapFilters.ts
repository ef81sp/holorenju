/**
 * 攻め側フィルタ（opening-trap-mining-2026-07-16.md §2）。
 *
 * 「両側 top-K」ではなく「攻め側=広く、hard 側=実機」という設計の核心を担う。
 * 攻め側（人間役）の候補手は、黒5・黒7 とも同一の思想で以下3種の和集合とする:
 *   1. 脅威プレフィルタ: その手で自分の石と「二」（5マス窓に相手石が無く自石2つ以上）
 *      を2方向以上構成する手
 *   2. 候補スコア上位: 親局面の findBestMoveForReview candidates 順位（呼び出し側が
 *      1親1回の探索で取得して渡す）の上位 topK 件
 *   3. シード付きランダム枠: 上記に含まれない空きマスからシード固定で抽選
 * 出力は maxTotal 件にキャップする（優先順位: 脅威プレフィルタ > 候補上位 > ランダム）。
 */
import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

/** 「二」判定に使う4軸（横・縦・斜め\・斜め/）。 */
const AXES: { dr: number; dc: number }[] = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
];

/** 五を作る余地がある窓の長さ。 */
const WIN_LENGTH = 5;

/**
 * pos を含む軸 (dr, dc) 上に「二」があるか判定する。
 * pos を含む5マス連続窓のいずれかで、相手石・盤外に遮られず自石（pos自身を含む）が
 * 2つ以上あれば true。
 */
function formsTwoOnAxis(
  board: BoardState,
  pos: Position,
  color: "black" | "white",
  dr: number,
  dc: number,
): boolean {
  for (let offset = -(WIN_LENGTH - 1); offset <= 0; offset++) {
    let ownCount = 0;
    let blocked = false;
    for (let i = 0; i < WIN_LENGTH; i++) {
      const r = pos.row + (offset + i) * dr;
      const c = pos.col + (offset + i) * dc;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
        blocked = true;
        break;
      }
      const isSelf = r === pos.row && c === pos.col;
      const cell = isSelf ? color : (board[r]?.[c] ?? null);
      if (cell === color) {
        ownCount++;
      } else if (cell !== null) {
        blocked = true;
        break;
      }
    }
    if (!blocked && ownCount >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * 脅威プレフィルタ: pos に color を打つと、自石2つ以上の「二」を2方向以上
 * 構成するか判定する。pos は空きマスであることを前提とする（呼び出し側で保証）。
 */
export function passesThreatPrefilter(
  board: BoardState,
  pos: Position,
  color: "black" | "white",
): boolean {
  let axisCount = 0;
  for (const { dr, dc } of AXES) {
    if (formsTwoOnAxis(board, pos, color, dr, dc)) {
      axisCount++;
      if (axisCount >= 2) {
        return true;
      }
    }
  }
  return false;
}

export interface AttackerMoveProvenance {
  threatPrefilter: boolean;
  topKCandidate: boolean;
  randomSlot: boolean;
}

export interface AttackerMoveCandidate {
  position: Position;
  provenance: AttackerMoveProvenance;
}

export interface SelectAttackerMovesParams {
  board: BoardState;
  color: "black" | "white";
  /** 親局面の findBestMoveForReview candidates（配列インデックス=順位、0が最善）。 */
  candidates: Position[];
  /** 候補スコア上位から採用する件数。 */
  topK: number;
  /** 出力する手の総数上限（プランの b5/b7）。 */
  maxTotal: number;
  /** ランダム枠の件数。 */
  randomSlotCount: number;
  /** ランダム枠抽選のシード（固定すれば決定的）。 */
  randomSeed: number;
}

function positionKey(pos: Position): string {
  return `${pos.row},${pos.col}`;
}

/** mulberry32: シンプルな決定的PRNG（外部依存なし）。 */
function makeSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function isEmpty(board: BoardState, row: number, col: number): boolean {
  return (board[row]?.[col] ?? null) === null;
}

function provenanceScore(p: AttackerMoveProvenance): number {
  return (
    (p.threatPrefilter ? 4 : 0) +
    (p.topKCandidate ? 2 : 0) +
    (p.randomSlot ? 1 : 0)
  );
}

/**
 * 攻め側フィルタの本体。脅威プレフィルタ通過手・候補スコア上位・ランダム枠を
 * 統合し、maxTotal 件にキャップして返す（provenance 付き）。
 */
export function selectAttackerMoves(
  params: SelectAttackerMovesParams,
): AttackerMoveCandidate[] {
  const {
    board,
    color,
    candidates,
    topK,
    maxTotal,
    randomSlotCount,
    randomSeed,
  } = params;

  const selected = new Map<string, AttackerMoveCandidate>();

  // 1. 脅威プレフィルタ: 全空きマスを走査
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isEmpty(board, row, col)) {
        continue;
      }
      const pos: Position = { row, col };
      if (passesThreatPrefilter(board, pos, color)) {
        selected.set(positionKey(pos), {
          position: pos,
          provenance: {
            threatPrefilter: true,
            topKCandidate: false,
            randomSlot: false,
          },
        });
      }
    }
  }

  // 2. 候補スコア上位
  const topCount = Math.max(0, Math.min(topK, candidates.length));
  for (let i = 0; i < topCount; i++) {
    const pos = candidates[i]!;
    const k = positionKey(pos);
    const existing = selected.get(k);
    if (existing) {
      existing.provenance.topKCandidate = true;
    } else {
      selected.set(k, {
        position: pos,
        provenance: {
          threatPrefilter: false,
          topKCandidate: true,
          randomSlot: false,
        },
      });
    }
  }

  // 3. シード付きランダム枠（上記に含まれない空きマスから抽選）
  if (randomSlotCount > 0) {
    const remainingEmpty: Position[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (!isEmpty(board, row, col)) {
          continue;
        }
        const pos: Position = { row, col };
        if (!selected.has(positionKey(pos))) {
          remainingEmpty.push(pos);
        }
      }
    }
    const rng = makeSeededRng(randomSeed);
    shuffleInPlace(remainingEmpty, rng);
    const pickCount = Math.min(randomSlotCount, remainingEmpty.length);
    for (let i = 0; i < pickCount; i++) {
      const pos = remainingEmpty[i]!;
      selected.set(positionKey(pos), {
        position: pos,
        provenance: {
          threatPrefilter: false,
          topKCandidate: false,
          randomSlot: true,
        },
      });
    }
  }

  const result = Array.from(selected.values());
  result.sort(
    (a, b) => provenanceScore(b.provenance) - provenanceScore(a.provenance),
  );
  return result.slice(0, maxTotal);
}
