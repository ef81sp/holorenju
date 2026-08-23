/**
 * bridge worker ⇄ メインスレッドのメッセージ封筒（envelope）の知識。
 *
 * 「ready 通知がどんな形か」は worker 計測（workerTelemetry.ts）の関心事ではないので
 * 分離する。計測は `EngineParamsSnapshot` という値だけを知っていればよい。
 *
 * 古い commit の worktree から起動された bridge worker は `params` を同梱しない
 * （`{ ready: true }` だけ）ため、パーサは必ず undefined を返せる形にしてある。
 */
import type { EngineParamsSnapshot } from "./workerTelemetry.ts";

/** ready 通知かどうか。 */
export function isReadyMessage(msg: unknown): boolean {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "ready" in msg &&
    (msg as { ready: unknown }).ready === true
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * ready 通知から解決済みエンジンパラメータを取り出す。
 * 形が違えば undefined（部分的に壊れた params を通すと replay の突き合わせが
 * 誤検知するため、必須フィールドが揃っていることまで確認する）。
 */
export function parseEngineParams(
  msg: unknown,
): EngineParamsSnapshot | undefined {
  if (typeof msg !== "object" || msg === null) {
    return undefined;
  }
  const { params } = msg as { params?: unknown };
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const p = params as Partial<EngineParamsSnapshot>;
  const ok =
    typeof p.worktreePath === "string" &&
    typeof p.difficulty === "string" &&
    isFiniteNumber(p.depth) &&
    isFiniteNumber(p.timeLimit) &&
    isFiniteNumber(p.maxNodes) &&
    isFiniteNumber(p.randomFactor) &&
    (p.engine === "wasm" || p.engine === "ts") &&
    typeof p.bookEnabled === "boolean" &&
    typeof p.hasStatsBuffer === "boolean" &&
    typeof p.threatProbe === "string";
  return ok ? (params as EngineParamsSnapshot) : undefined;
}

/** replay の突き合わせで比較する項目（探索結果に効くものだけ） */
const COMPARED_KEYS = [
  "difficulty",
  "depth",
  "timeLimit",
  "maxNodes",
  "randomFactor",
  "engine",
  "bookEnabled",
  "threatProbe",
] as const;

export interface EngineParamsDiff {
  key: string;
  expected: unknown;
  actual: unknown;
}

/**
 * ダンプに記録された engineParams と、replay で起動した worker の実パラメータを
 * 突き合わせる。差分があると「別条件で再現を試みて再現せずと結論する」事故になる。
 */
export function diffEngineParams(
  expected: EngineParamsSnapshot | undefined,
  actual: EngineParamsSnapshot | undefined,
): EngineParamsDiff[] {
  if (!expected || !actual) {
    return [];
  }
  const diffs: EngineParamsDiff[] = [];
  for (const key of COMPARED_KEYS) {
    if (expected[key] !== actual[key]) {
      diffs.push({ key, expected: expected[key], actual: actual[key] });
    }
  }
  const expectedEval = JSON.stringify(expected.evaluationOptions ?? null);
  const actualEval = JSON.stringify(actual.evaluationOptions ?? null);
  if (expectedEval !== actualEval) {
    diffs.push({
      key: "evaluationOptions",
      expected: expected.evaluationOptions,
      actual: actual.evaluationOptions,
    });
  }
  const expectedWeights = JSON.stringify(
    expected.evalWeightsFingerprint ?? null,
  );
  const actualWeights = JSON.stringify(actual.evalWeightsFingerprint ?? null);
  if (expectedWeights !== actualWeights) {
    diffs.push({
      key: "evalWeightsFingerprint",
      expected: expected.evalWeightsFingerprint,
      actual: actual.evalWeightsFingerprint,
    });
  }
  return diffs;
}

/**
 * eval 重みの指紋を計算する（順序非依存の安定ハッシュ）。
 * 重み本体をダンプに載せずに「同じ重みか」を判定するためのもの。
 */
export function fingerprintEvalWeights(
  weights: Record<string, number> | undefined,
): { count: number; hash: string } | undefined {
  if (!weights) {
    return undefined;
  }
  const entries = Object.entries(weights).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) {
    return { count: 0, hash: "0" };
  }
  // FNV-1a 32bit（暗号用途ではない。差分検出だけが目的）
  let hash = 0x811c9dc5;
  for (const [key, value] of entries) {
    const text = `${key}=${value};`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return { count: entries.length, hash: hash.toString(16) };
}
