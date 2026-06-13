/**
 * 注入版 ≡ ベイク版 ビット一致検証（runtime eval 重み注入の一次防衛ゲート）
 *
 * 同じ重みを (i) scores.zig 既定に焼いてリビルドした wasm（baked）と、
 * (ii) 既定 wasm に setEvalParam で注入した wasm（inject）で、
 * 多数局面の evaluateBoard と findBestMove がビット一致するか検証する。
 *
 * const→var 化や注入経路が、ベイク版と挙動を変えていないことの最終保証。
 * 特に LINE_POTENTIAL はインクリメンタル和キャッシュ（incremental_eval.zig）を
 * 持つため、複数手進めた局面でも一致するかを重点的に見る。
 *
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/verify-eval-injection.ts \
 *     --baked=/tmp/wasm-baked.wasm --inject=/tmp/wasm-inject.wasm \
 *     --weights=OPEN_THREE:600,LINE_POTENTIAL_1:2,LINE_POTENTIAL_2:6,LINE_POTENTIAL_3:20,LINE_POTENTIAL_4:30
 */
import { readFileSync } from "node:fs";

import { EVAL_PARAM_IDS } from "./lib/evalParams.ts";

interface Engine {
  boardInit: () => void;
  boardSet: (r: number, c: number, v: number) => void;
  evaluateBoard: (perspective: number, optionsFlags: number) => number;
  findBestMove: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
    evalOptionsFlags: number,
  ) => void;
  getResultBuffer: () => number;
  resetEvalParams: () => void;
  setEvalParam: (id: number, value: number) => void;
  ttClear: () => void;
  memory: WebAssembly.Memory;
}

const arg = (k: string): string | undefined =>
  process.argv
    .slice(2)
    .find((s) => s.startsWith(`--${k}=`))
    ?.slice(k.length + 3);

async function load(path: string): Promise<Engine> {
  const buf = readFileSync(path);
  const { instance } = await WebAssembly.instantiate(buf, {
    env: { getTimestampMsExternal: () => 0 },
  });
  return instance.exports as unknown as Engine;
}

function setStones(e: Engine, stones: [number, number, number][]): void {
  e.boardInit();
  for (const [r, c, v] of stones) {
    e.boardSet(r, c, v);
  }
}

/** 決定的な疑似ランダム局面列を生成（中央付近に交互着手）。 */
function genPositions(): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  // Park-Miller 最小標準（決定的・ビット演算なし・safe integer 内）
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let g = 0; g < 40; g++) {
    const used = new Set<number>();
    const stones: [number, number, number][] = [];
    const len = 4 + Math.floor(rnd() * 20); // 4..23 手
    for (let i = 0; i < len; i++) {
      let r = 0;
      let c = 0;
      let idx = 0;
      let tries = 0;
      do {
        r = 4 + Math.floor(rnd() * 7);
        c = 4 + Math.floor(rnd() * 7);
        idx = r * 15 + c;
        tries++;
      } while (used.has(idx) && tries < 50);
      if (used.has(idx)) {
        continue;
      }
      used.add(idx);
      stones.push([r, c, (i % 2) + 1]); // 1=black,2=white 交互
      out.push(stones.slice()); // 各手数のスナップショット（インクリメンタル経路網羅）
    }
  }
  return out;
}

function readMove(e: Engine): {
  row: number;
  col: number;
  score: number;
  depth: number;
} {
  const ptr = e.getResultBuffer();
  const view = new DataView(e.memory.buffer);
  return {
    row: view.getUint8(ptr),
    col: view.getUint8(ptr + 1),
    score: view.getInt32(ptr + 2, true),
    depth: view.getUint8(ptr + 6),
  };
}

async function main(): Promise<void> {
  const bakedPath = arg("baked");
  const injectPath = arg("inject");
  const weightsStr = arg("weights") ?? "";
  if (!bakedPath || !injectPath) {
    console.error("--baked と --inject は必須");
    process.exit(1);
  }
  const overrides: [number, number][] = [];
  for (const pair of weightsStr.split(",")) {
    const [k, v] = pair.split(":");
    if (!k || v === undefined) {
      continue;
    }
    const id = (EVAL_PARAM_IDS as Record<string, number>)[k.trim()];
    if (id === undefined) {
      console.error(`不明な重みキー: ${k}`);
      process.exit(1);
    }
    overrides.push([id, Number(v)]);
  }

  const baked = await load(bakedPath);
  const inject = await load(injectPath);

  // inject 側に重みを注入（reset → 各 setEvalParam）
  inject.resetEvalParams();
  for (const [id, v] of overrides) {
    inject.setEvalParam(id, v);
  }

  const positions = genPositions();
  const optionFlagSets = [0, 511]; // 既定 / hard 全bit

  let evalChecked = 0;
  let evalMismatch = 0;
  let moveChecked = 0;
  let moveMismatch = 0;
  const samples: string[] = [];

  for (let pi = 0; pi < positions.length; pi++) {
    const stones = positions[pi]!;
    setStones(baked, stones);
    setStones(inject, stones);
    const perspective = (stones.length % 2) + 1; // 次手番
    // evaluateBoard は決定的・即時 → 全局面で網羅（重みを読む本体の証明）
    for (const flags of optionFlagSets) {
      const sb = baked.evaluateBoard(perspective, flags);
      const si = inject.evaluateBoard(perspective, flags);
      evalChecked++;
      if (sb !== si) {
        evalMismatch++;
        if (samples.length < 10) {
          samples.push(
            `eval len=${stones.length} flags=${flags}: baked=${sb} inject=${si}`,
          );
        }
      }
    }
    // findBestMove は重いので間引き＋小ノード上限で決定的に（move選択の等価性確認）
    if (pi % 20 === 0) {
      baked.ttClear();
      inject.ttClear();
      baked.findBestMove(perspective, 4, 5000, 3000, 5000, 0, 511);
      const mb = readMove(baked);
      inject.findBestMove(perspective, 4, 5000, 3000, 5000, 0, 511);
      const mi = readMove(inject);
      moveChecked++;
      if (mb.row !== mi.row || mb.col !== mi.col || mb.score !== mi.score) {
        moveMismatch++;
        if (samples.length < 10) {
          samples.push(
            `move len=${stones.length}: baked=(${mb.row},${mb.col},s=${mb.score},d=${mb.depth}) inject=(${mi.row},${mi.col},s=${mi.score},d=${mi.depth})`,
          );
        }
      }
    }
  }

  console.log(`\n=== 注入版 ≡ ベイク版 ビット一致検証 ===`);
  console.log(`重み: ${overrides.map(([id, v]) => `${id}=${v}`).join(", ")}`);
  console.log(
    `evaluateBoard: ${evalChecked - evalMismatch}/${evalChecked} 一致`,
  );
  console.log(
    `findBestMove : ${moveChecked - moveMismatch}/${moveChecked} 一致`,
  );
  if (samples.length > 0) {
    console.log(`--- 不一致サンプル ---`);
    for (const s of samples) {
      console.log(`  ${s}`);
    }
  }
  const ok = evalMismatch === 0 && moveMismatch === 0;
  console.log(
    ok
      ? "\n✅ 完全一致: 注入経路はベイク版と等価"
      : "\n❌ 不一致あり: 注入経路に差異",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
