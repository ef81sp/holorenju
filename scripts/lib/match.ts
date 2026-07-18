/**
 * 対局オーケストレーション共有モジュール。
 *
 * commit-bench（worktree 比較）と weight-bench（ローカル wasm + 重み注入）の
 * 両方で使う「珠型タスク生成 / bridge worker 生成 / ワークスティール並列ループ＋
 * WDL・Elo・SPRT・状態表示」を集約する。両ベンチの差は
 *   (1) worker ペアの作り方（worktree vs ローカル wasm + evalWeights）
 *   (2) 結果の保存形式・ラベル
 * だけ。対局ループ本体は本モジュールに一本化（DRY）。
 *
 * Elo/WDL は **A=playerA 視点**（commitA / baseline）。
 */
import { Worker } from "node:worker_threads";

import type { EvaluationOptions } from "../../src/logic/cpu/evaluation/patternScores.ts";
import type { DifficultyParams } from "../../src/types/cpu.ts";
import type { Position } from "../../src/types/game.ts";
import type { SPRTConfig, WDLCount } from "../types/ab.ts";
import type { CommitGameResult } from "../types/commit-bench.ts";

import {
  getAllJushuNames,
  getJushuPositions,
} from "../../src/logic/cpu/opening.ts";
import {
  GameHangError,
  type HangContext,
  type HangInjectSpec,
  runCommitGame,
} from "../commit-game-runner.ts";
import { estimateEloDiff } from "./eloDiff.ts";
import { updateSPRT } from "./sprt.ts";

/** 1局分の珠型タスク（開始局面＋先後割当）。 */
export interface MatchTask {
  jushuName: string;
  positions: [Position, Position, Position];
  isABlack: boolean;
}

/** ハング局のメタ情報（caller のダンプ作成用） */
export interface HangMatchInfo {
  gameIdx: number;
  jushuName: string;
  isABlack: boolean;
  pairIdx: number;
}

/** runMatch の結果（caller が後処理＝性能統計や保存を行う）。 */
export interface RunMatchResult {
  wdl: WDLCount;
  games: CommitGameResult[];
  completedGames: number;
  stoppedBySprt: boolean;
  /**
   * ハング等で破棄された局数（recreatePair 指定時のみ発生しうる）。
   * 未破棄なら常に 0。既存 caller が field を読まなくても影響しない。
   */
  aborts: number;
  /**
   * abort 局を側（A/B）別に集計したもの。
   * 「劣勢側がハングしやすい場合に負けを消す」一方向バイアスの検出に使う。
   * A + B = aborts の関係。
   */
  abortsBySide: { A: number; B: number };
}

export interface RunMatchParams {
  /** A/B bridge worker のペア群（--jobs 組）。生成方法は caller が決める。 */
  pairs: { a: Worker; b: Worker }[];
  /** 消化する珠型タスク列（buildJushuTasks 等で生成）。 */
  tasks: MatchTask[];
  /** 進捗表示の分母。 */
  totalGames: number;
  sprtConfig: SPRTConfig | null;
  moveTimeoutMs: number;
  verbose: boolean;
  /** 経過時間表示の基点（performance.now()）。 */
  startTime: number;
  /**
   * 1局隔離用のペア再生成関数（weight-bench 用）。
   * 指定すると runCommitGame が throw してもその局を破棄し worker を再生成して続行。
   * **未指定なら旧挙動**（エラーを伝播＝commit-bench を出力同一に保つ）。
   */
  recreatePair?: (idx: number) => Promise<{ a: Worker; b: Worker }>;
  /**
   * ハング（GameHangError）が起きたときに呼ばれる。ダンプ書き出し等の副作用を行う。
   * recreatePair と併用したときのみ呼ばれる（recreatePair 未指定＝旧挙動でエラーを
   * 伝播するときは、caller にはハング固有の情報が届かず onHang が意味を持たないため）。
   */
  onHang?: (context: HangContext, info: HangMatchInfo) => void;
  /**
   * テスト用: 特定の gameIdx（0-based, tasks 配列上のインデックス）に到達した局で
   * ハング注入を行う。ハング回復パスの手動 e2e テストに使う。
   * gameIdx が現在の taskIdx に一致する局にだけ runCommitGame へ hangInject を渡す。
   */
  hangInject?: { gameIdx: number; spec: HangInjectSpec };
  /**
   * 各局に渡す PRNG シードを算出する関数。指定時、局ごとの gameSeed を
   * `getGameSeed(gameIdx)` で決めて runCommitGame に渡す。
   * randomFactor > 0 のとき「同一 baseSeed → 同一棋譜」を保証するのに使う。
   * 未指定なら worker 側は Math.random にフォールバック（従来挙動）。
   */
  getGameSeed?: (gameIdx: number) => number;
}

// ============================================================================
// 珠型タスク生成
// ============================================================================

/** sets セット分の珠型タスク（各セット = 全珠型 × 2色）をフラット化して返す。 */
export function buildJushuTasks(sets: number): MatchTask[] {
  const jushuNames = getAllJushuNames();
  const tasks: MatchTask[] = [];
  for (let set = 0; set < sets; set++) {
    for (const jn of jushuNames) {
      const pos = getJushuPositions(jn, true);
      if (!pos) {
        continue;
      }
      for (const ab of [true, false]) {
        tasks.push({ jushuName: jn, positions: pos, isABlack: ab });
      }
    }
  }
  return tasks;
}

/** 1セットあたりの局数（全珠型 × 2色）。 */
export function gamesPerSet(): number {
  return getAllJushuNames().length * 2;
}

// ============================================================================
// Bridge Worker 生成
// ============================================================================

export interface CreateBridgeWorkerParams {
  /** cpu-bridge-worker.ts の絶対パス。 */
  workerPath: string;
  /** worker の register-loader.mjs の絶対パス（worktree or ローカル）。 */
  loaderPath: string;
  /** CPU 実装を読む worktree（ローカル比較ならリポジトリルート）。 */
  worktreePath: string;
  difficulty: string;
  randomFactor?: number;
  /** eval 形系重みの実行時注入（weight-bench 用。commit-bench は未使用）。 */
  evalWeights?: Record<string, number>;
  /**
   * eval 基底/オプションの実行時オーバーライド（Gate 2: evalBasis=prospect 注入用）。
   * cpu-bridge-worker 側で baseParams.evaluationOptions と浅くマージされる
   * （mergeDifficultyParams 参照）。省略時は現行挙動と完全一致（後方互換）。
   */
  evaluationOptions?: Partial<EvaluationOptions>;
  /**
   * オープニングブック（opening-book-2026-07-16.md ★v2プラン B3）を有効化するか。
   * 既定 OFF（未指定時は現行挙動と完全一致・後方互換）。ON でも worktree に
   * ブックモジュール/資産が無ければ cpu-bridge-worker 側で自動的に book-OFF
   * として続行する。
   */
  bookEnabled?: boolean;
  /**
   * 脅威プローブトグル（探索レバー A/B）。未指定/true=従来挙動、false=無効化。
   * setThreatProbeEnabled 非対応の古い wasm では bridge worker 側で warn して
   * スキップされる（fallback で ON 相当）。
   */
  threatProbeEnabled?: boolean;
  /**
   * 探索の maxNodes オーバーライド。未指定なら difficulty 既定を使う。
   * 「同じ持ち時間でノード上限が実質非拘束なら深読みが Elo に転換するか」を
   * 測るための実行時レバー（randomFactor/evaluationOptions と同じ流儀で
   * customParams 経由で mergeDifficultyParams に注入される）。
   */
  maxNodes?: number;
  /**
   * 探索の depth cap オーバーライド。未指定なら difficulty 既定を使う。
   * DifficultyParams.depth に写される。iterative deepening の上限。
   * probe OFF/深さ探索レバーが depth cap で頭打ちになるのを避けるためのレバー。
   */
  maxDepth?: number;
}

/**
 * createBridgeWorker に渡す customParams を組み立てる（純粋関数・単体テスト用に export）。
 * randomFactor / evaluationOptions / maxNodes のいずれも未指定なら undefined を返し、
 * 既存呼び出し（weight-bench 等）の挙動を完全に保つ。
 */
export function buildBridgeCustomParams(
  randomFactor: number | undefined,
  evaluationOptions: Partial<EvaluationOptions> | undefined,
  maxNodes?: number,
  maxDepth?: number,
): Partial<DifficultyParams> | undefined {
  if (
    randomFactor === undefined &&
    evaluationOptions === undefined &&
    maxNodes === undefined &&
    maxDepth === undefined
  ) {
    return undefined;
  }
  const customParams: Partial<DifficultyParams> = {};
  if (randomFactor !== undefined) {
    customParams.randomFactor = randomFactor;
  }
  if (evaluationOptions !== undefined) {
    customParams.evaluationOptions = evaluationOptions as EvaluationOptions;
  }
  if (maxNodes !== undefined) {
    customParams.maxNodes = maxNodes;
  }
  if (maxDepth !== undefined) {
    // DifficultyParams.depth = iterative deepening の上限。maxDepth の名前は
    // ベンチ CLI の flag に合わせ、ここで DifficultyParams.depth に写す。
    customParams.depth = maxDepth;
  }
  return customParams;
}

/** bridge worker を起動し、ready 通知を待って resolve する。 */
export function createBridgeWorker(
  params: CreateBridgeWorkerParams,
): Promise<Worker> {
  const {
    workerPath,
    loaderPath,
    worktreePath,
    difficulty,
    randomFactor,
    evalWeights,
    evaluationOptions,
    bookEnabled,
    threatProbeEnabled,
    maxNodes,
    maxDepth,
  } = params;
  return new Promise<Worker>((resolve, reject) => {
    const customParams = buildBridgeCustomParams(
      randomFactor,
      evaluationOptions,
      maxNodes,
      maxDepth,
    );

    const worker = new Worker(workerPath, {
      workerData: {
        worktreePath,
        difficulty,
        customParams,
        evalWeights,
        bookEnabled,
        threatProbeEnabled,
      },
      execArgv: [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--import",
        loaderPath,
      ],
    });

    const initTimeout = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(`Bridge worker initialization timed out for ${worktreePath}`),
      );
    }, 60000);

    const readyHandler = (msg: unknown): void => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "ready" in msg &&
        (msg as { ready: unknown }).ready === true
      ) {
        clearTimeout(initTimeout);
        worker.off("message", readyHandler);
        resolve(worker);
      }
    };

    worker.on("message", readyHandler);

    worker.on("error", (err) => {
      clearTimeout(initTimeout);
      reject(err);
    });
  });
}

// ============================================================================
// 状態表示
// ============================================================================

function writeStatus(message: string): void {
  process.stdout.write(`\r${message.padEnd(100)}`);
}

function clearStatus(): void {
  process.stdout.write(`\r${" ".repeat(100)}\r`);
}

// ============================================================================
// 対局ループ（ワークスティール並列）
// ============================================================================

interface Acc {
  depthSum: number;
  timeSum: number;
  count: number;
  maxDepth: number;
}
const newAcc = (): Acc => ({ depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 });

/**
 * 珠型タスクを pairs（--jobs 組）でワークスティール並列消化する。
 * 結果処理（WDL/統計/ステータス/SPRT）は await を挟まず同期実行＝競合しない。
 *
 * **1局隔離**: runCommitGame が throw（move timeout/worker死）しても、その局だけ
 * 「敗北扱い」で記録して残りを続行する。ハングした worker は terminate→再生成し、
 * 実効並列度を保つ。1局のハングで全体が落ちないようにする（weight-bench の必須要件）。
 */
export async function runMatch(
  params: RunMatchParams,
): Promise<RunMatchResult> {
  const {
    pairs,
    tasks,
    totalGames,
    sprtConfig,
    moveTimeoutMs,
    verbose,
    startTime,
    recreatePair,
    onHang,
    hangInject,
    getGameSeed,
  } = params;

  const wdl: WDLCount = { wins: 0, draws: 0, losses: 0 };
  const games: CommitGameResult[] = [];
  let completedGames = 0;
  let stoppedBySprt = false;
  let aborts = 0;
  const abortsBySide = { A: 0, B: 0 };

  const cumAcc = { A: newAcc(), B: newAcc() };

  let nextTask = 0;
  let stop = false;

  const runPair = async (
    pairIdx: number,
    pairRef: { a: Worker; b: Worker },
  ): Promise<void> => {
    let pair = pairRef;
    while (!stop) {
      const taskIdx = nextTask;
      nextTask += 1;
      if (taskIdx >= tasks.length) {
        break;
      }
      const { jushuName, positions, isABlack } = tasks[taskIdx]!;

      let result: CommitGameResult | null = null;
      const injectHere =
        hangInject !== undefined && hangInject.gameIdx === taskIdx
          ? hangInject.spec
          : undefined;
      const gameSeed = getGameSeed ? getGameSeed(taskIdx) : undefined;
      try {
        const r = await runCommitGame(pair.a, pair.b, isABlack, {
          verbose,
          moveTimeoutMs,
          openingMoves: positions,
          hangInject: injectHere,
          gameSeed,
        });
        result = { ...r, jushuName };
      } catch (err: unknown) {
        // recreatePair 未指定なら旧挙動でエラー伝播（commit-bench 出力同一）。
        if (!recreatePair) {
          throw err;
        }
        // 1局隔離: ハング/worker死。当該局は破棄し worker を再生成して続行。
        const isHang = err instanceof GameHangError;
        const msg = err instanceof Error ? err.message : String(err);
        clearStatus();
        console.warn(
          `\n⚠ 局 g${taskIdx} ${jushuName}(${isABlack ? "A黒" : "A白"}) を破棄: ${msg}`,
        );
        if (isHang && onHang) {
          try {
            onHang(err.context, {
              gameIdx: taskIdx,
              jushuName,
              isABlack,
              pairIdx,
            });
          } catch (dumpErr: unknown) {
            const dm =
              dumpErr instanceof Error ? dumpErr.message : String(dumpErr);
            console.error(`onHang ダンプ処理でエラー: ${dm}`);
          }
        }
        aborts++;
        // side 別集計: ハングした側（A/B）に加算。ハングじゃない例外（worker死等）
        // は側が特定できないので aborts のみ加算する。
        if (isHang) {
          abortsBySide[err.context.side]++;
        }
        try {
          pair.a.terminate();
          pair.b.terminate();
          pair = await recreatePair(pairIdx);
          pairs[pairIdx] = pair;
          console.warn(
            `↳ worker pair (idx=${pairIdx}) 再生成完了。残り局を継続します。`,
          );
        } catch (reErr: unknown) {
          const m = reErr instanceof Error ? reErr.message : String(reErr);
          console.error(`worker 再生成に失敗（このペアを終了）: ${m}`);
          break;
        }
        continue;
      }
      if (stop || result === null) {
        break;
      }

      // WDL更新（A=playerA 視点）
      if (result.winner === "draw") {
        wdl.draws++;
      } else if (result.winner === "A") {
        wdl.wins++;
      } else {
        wdl.losses++;
      }

      games.push(result);
      completedGames++;

      // 初回ゲーム後のサニティチェック
      if (completedGames === 1) {
        const avgTime =
          result.moveHistory.reduce(
            (s: number, m: { time: number }) => s + m.time,
            0,
          ) / result.moveHistory.length;
        const maxTime = Math.max(
          ...result.moveHistory.map((m: { time: number }) => m.time),
        );
        console.log(`\n[サニティチェック] 初回ゲーム完了`);
        console.log(
          `  手数: ${result.moves} | 勝者: ${result.winner} | 理由: ${result.reason}`,
        );
        console.log(
          `  平均思考時間: ${Math.round(avgTime)}ms | 最大: ${Math.round(maxTime)}ms`,
        );
        console.log(`  duration: ${Math.round(result.duration)}ms`);
        if (avgTime < 1) {
          console.warn(
            "  ⚠ 平均思考時間が1ms未満 — エンジンが正しくロードされていない可能性",
          );
        }
      }

      // この局の A/B 統計を集計し、累積にも加算
      const gameAcc = { A: newAcc(), B: newAcc() };
      for (let i = 0; i < result.moveHistory.length; i++) {
        const move = result.moveHistory[i]!;
        if (move.isOpening) {
          continue;
        }
        const isBlackMove = i % 2 === 0;
        const player =
          (isBlackMove && isABlack) || (!isBlackMove && !isABlack) ? "A" : "B";
        const ga = gameAcc[player];
        const ca = cumAcc[player];
        if (move.depth !== undefined) {
          ga.depthSum += move.depth;
          ga.maxDepth = Math.max(ga.maxDepth, move.depth);
          ca.depthSum += move.depth;
          ca.maxDepth = Math.max(ca.maxDepth, move.depth);
        }
        ga.timeSum += move.time;
        ga.count++;
        ca.timeSum += move.time;
        ca.count++;
      }

      // ステータス表示
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
      const elo = estimateEloDiff(wdl);
      let statusMsg = `[${elapsed}s] ${completedGames}/${totalGames} ${jushuName} ${isABlack ? "A黒" : "A白"} +${wdl.wins}=${wdl.draws}-${wdl.losses} Elo:${elo.eloDiff > 0 ? "+" : ""}${elo.eloDiff}`;

      if (sprtConfig) {
        const sprt = updateSPRT(wdl, sprtConfig);
        statusMsg += ` LLR:${sprt.llr.toFixed(2)}`;
        if (sprt.decision !== "continue") {
          writeStatus(statusMsg);
          clearStatus();
          console.log(
            `SPRT判定: ${sprt.decision} (${completedGames}局目で停止)`,
          );
          stop = true;
          stoppedBySprt = true;
        }
      }

      writeStatus(statusMsg);

      const fmtDepth = (a: Acc): string =>
        a.count > 0
          ? `d=${(a.depthSum / a.count).toFixed(1)} t=${Math.round(a.timeSum / a.count)}ms`
          : "n/a";
      const fmtCum = (a: Acc): string =>
        a.count > 0
          ? `d=${(a.depthSum / a.count).toFixed(2)} max=${a.maxDepth} t=${Math.round(a.timeSum / a.count)}ms`
          : "n/a";
      console.log(
        `\n  局: A[${fmtDepth(gameAcc.A)}] B[${fmtDepth(gameAcc.B)}] | 累計: A[${fmtCum(cumAcc.A)}] B[${fmtCum(cumAcc.B)}]`,
      );
    }
  };

  await Promise.all(pairs.map((p, idx) => runPair(idx, p)));

  clearStatus();

  return { wdl, games, completedGames, stoppedBySprt, aborts, abortsBySide };
}
