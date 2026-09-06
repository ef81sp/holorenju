/**
 * 対局オーケストレーション共有モジュール。
 *
 * commit-bench（worktree 比較）と weight-bench（ローカル wasm + 重み注入）の
 * 両方で使う「タスク生成（珠型/開局スイート） / bridge worker 生成 / ワークスティール並列ループ＋
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
import type { AbortedGame, CommitGameResult } from "../types/commit-bench.ts";

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
import { isReadyMessage, parseEngineParams } from "./bridgeWorkerProtocol.ts";
import { type MatchStatsSnapshot, MatchStatsTracker } from "./matchStats.ts";
import { createLivenessChannel } from "./workerLiveness.ts";
import { getWorkerTelemetry } from "./workerTelemetry.ts";

/** 1局分の対局タスク（開始局面＋先後割当）。 */
export interface MatchTask {
  /** 開局ラベル（珠型名または開局 id）。結果の jushuName に入る */
  openingId: string;
  /** ペア id。同一開局の A黒/A白 2 局が同じ値を持つ（`${set}:${openingId}`） */
  pairId: string;
  /** 開局の擬似手順（黒から交互）。珠型は 3 手、開局スイートは 7 手。 */
  positions: Position[];
  isABlack: boolean;
}

/** 開局の供給元（珠型アダプタ jushuOpenings() または開局スイートのローダ）。 */
export interface OpeningSource {
  id: string;
  /** 黒から交互の擬似手順。手番は長さの偶奇で決まる */
  positions: Position[];
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
  /** stats.wdl の別名（既存 caller との互換）。 */
  wdl: WDLCount;
  /** 最終統計（三項 Elo / 三項 SPRT / ペア統計）。 */
  stats: MatchStatsSnapshot;
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
  /**
   * 破棄された局の一覧（決定的モードの受け入れ条件 abort=0 の判定と、
   * 結果 JSON への該当局面記録に使う）。side はハングした側（worker 死等で
   * 特定できないときは undefined）。
   */
  abortedGames: AbortedGame[];
}

export interface RunMatchParams {
  /** A/B bridge worker のペア群（--jobs 組）。生成方法は caller が決める。 */
  pairs: { a: Worker; b: Worker }[];
  /** 消化するタスク列（buildTasks で生成）。 */
  tasks: MatchTask[];
  /** 進捗表示の分母（tasks.length を渡す）。 */
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
// タスク生成
// ============================================================================

export interface BuildTasksOptions {
  /** 開局列の n 番目から使う（末尾で折り返さない）。既定 0 */
  offset?: number;
  /** タスクを先頭 N 局に切り詰める（ペア境界＝偶数に切り下げ）。0 なら無効 */
  maxGames?: number;
}

/**
 * 開局列 × sets 周回 × 2 色のタスクをフラット化して返す（唯一のタスク生成経路）。
 * 各開局について A黒 → A白 の 2 局を隣接して出し、`pairId = ${set}:${id}`。
 * 返り値の長さがベンチの totalGames の唯一の源。
 */
export function buildTasks(
  source: OpeningSource[],
  sets: number,
  options: BuildTasksOptions = {},
): MatchTask[] {
  const { offset = 0, maxGames = 0 } = options;
  const usable = source.slice(offset);
  const tasks: MatchTask[] = [];
  for (let set = 0; set < sets; set++) {
    for (const { id, positions } of usable) {
      for (const isABlack of [true, false]) {
        tasks.push({
          openingId: id,
          pairId: `${set}:${id}`,
          positions,
          isABlack,
        });
      }
    }
  }
  if (maxGames > 0 && maxGames < tasks.length) {
    return tasks.slice(0, maxGames - (maxGames % 2));
  }
  return tasks;
}

/** 26 珠型（天元黒・白 2 手目・黒 3 手目）を OpeningSource として供給するアダプタ。 */
export function jushuOpenings(): OpeningSource[] {
  const out: OpeningSource[] = [];
  for (const id of getAllJushuNames()) {
    const positions = getJushuPositions(id, true);
    if (positions) {
      out.push({ id, positions });
    }
  }
  return out;
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
  /**
   * 探索の timeLimit オーバーライド（ms）。固定ノードモードでは 0（時間を見ない）。
   * 未指定なら difficulty 既定。
   */
  timeLimit?: number;
  /**
   * 決定的探索モード（bench-fixed-nodes-2026-09-06.md）。true なら worker は wasm の
   * `setDeterministicMode(1)` を呼ぶ。非対応 wasm / TS フォールバックでは worker が
   * 初期化を中止し createBridgeWorker は reject する。
   */
  deterministic?: boolean;
}

/**
 * bridge worker に渡す customParams。DifficultyParams の部分オーバーライドに加え、
 * 決定的探索モード（bench-fixed-nodes-2026-09-06.md §2.5）のフラグを載せる。
 * `deterministic` は DifficultyParams の一員ではない（製品経路には無い概念）ため
 * ここで拡張する。mergeDifficultyParams はトップレベルを丸ごと展開するので
 * worker 側では merged params からも読める。
 */
export interface BridgeCustomParams extends Partial<DifficultyParams> {
  /** true なら worker は wasm の `setDeterministicMode(1)` を呼ぶ（非対応なら中止） */
  deterministic?: boolean;
}

/** buildBridgeCustomParams の入力（全て任意。何も無ければ undefined を返す）。 */
export interface BridgeCustomParamsInput {
  randomFactor?: number;
  evaluationOptions?: Partial<EvaluationOptions>;
  maxNodes?: number;
  /** DifficultyParams.depth に写す（ベンチ CLI の flag 名に合わせた別名） */
  maxDepth?: number;
  /** 0 なら時間を見ない（固定ノードモード） */
  timeLimit?: number;
  deterministic?: boolean;
}

/**
 * createBridgeWorker に渡す customParams を組み立てる（純粋関数・単体テスト用に export）。
 * 全て未指定なら undefined を返し、既存呼び出し（weight-bench 等）の挙動を完全に保つ。
 */
export function buildBridgeCustomParams(
  input: BridgeCustomParamsInput,
): BridgeCustomParams | undefined {
  const {
    randomFactor,
    evaluationOptions,
    maxNodes,
    maxDepth,
    timeLimit,
    deterministic,
  } = input;
  const customParams: BridgeCustomParams = {};
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
  if (timeLimit !== undefined) {
    customParams.timeLimit = timeLimit;
  }
  if (deterministic !== undefined) {
    customParams.deterministic = deterministic;
  }
  return Object.keys(customParams).length === 0 ? undefined : customParams;
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
    timeLimit,
    deterministic,
  } = params;
  return new Promise<Worker>((resolve, reject) => {
    const customParams = buildBridgeCustomParams({
      randomFactor,
      evaluationOptions,
      maxNodes,
      maxDepth,
      timeLimit,
      deterministic,
    });
    // #128: ハング中でも読める生存信号を共有メモリで用意する
    const livenessChannel = createLivenessChannel();

    const worker = new Worker(workerPath, {
      workerData: {
        worktreePath,
        difficulty,
        customParams,
        evalWeights,
        bookEnabled,
        threatProbeEnabled,
        livenessChannel,
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
      if (isReadyMessage(msg)) {
        clearTimeout(initTimeout);
        worker.off("message", readyHandler);
        // #128: ready 通知に同梱された解決済みエンジンパラメータを worker 計測へ
        // 記録する。ハング中の worker には問い合わせられないため、ここが唯一の
        // 取得機会。古い bridge worker（params 無し）では undefined のまま進む。
        const telemetry = getWorkerTelemetry(worker);
        telemetry.setLivenessChannel(livenessChannel);
        const engineParams = parseEngineParams(msg);
        if (engineParams) {
          telemetry.setEngineParams(engineParams);
        }
        resolve(worker);
      }
    };

    worker.on("message", readyHandler);

    worker.on("error", (err) => {
      clearTimeout(initTimeout);
      reject(err);
    });
    // 初期化中止（決定的モード非対応など）は worker が process.exit(1) するため
    // "error" ではなく "exit" で観測される。ready 前の終了は reject にする。
    worker.on("exit", (code) => {
      clearTimeout(initTimeout);
      reject(
        new Error(
          `Bridge worker exited before ready (code=${code}) for ${worktreePath}`,
        ),
      );
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
 * タスク列を pairs（--jobs 組）でワークスティール並列消化する。
 * 結果処理（WDL/統計/ステータス/SPRT）は await を挟まず同期実行＝競合しない。
 * 統計は MatchStatsTracker に委譲し、**SPRT の停止判定はペア LLR**で行う。
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

  const stats = new MatchStatsTracker(sprtConfig);
  const games: CommitGameResult[] = [];
  let completedGames = 0;
  let stoppedBySprt = false;
  let aborts = 0;
  const abortsBySide = { A: 0, B: 0 };
  const abortedGames: AbortedGame[] = [];

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
      const { openingId, pairId, positions, isABlack } = tasks[taskIdx]!;
      const jushuName = openingId;

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
          gameIdx: taskIdx,
        });
        result = { ...r, jushuName, pairId };
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
        abortedGames.push({
          gameIdx: taskIdx,
          openingId,
          pairId,
          isABlack,
          side: isHang ? err.context.side : undefined,
          reason: msg,
        });
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

      // WDL / Elo / ペア統計 / SPRT 更新（A=playerA 視点）
      const snap = stats.push(result);
      const { wdl } = snap;

      games.push(result);
      completedGames++;

      // #128: 打ち終えた局を両 worker の計測に記録する（履歴再生の入力）。
      // worker を再生成すると計測ごと作り直されるので、明示的なリセットは不要。
      const recentGame = {
        gameIdx: taskIdx,
        jushuName,
        isABlack,
        gameSeed,
        moves: result.moveHistory.map((m) => ({
          row: m.row,
          col: m.col,
          isOpening: m.isOpening,
        })),
      };
      getWorkerTelemetry(pair.a).recordGame(recentGame);
      getWorkerTelemetry(pair.b).recordGame(recentGame);

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
      const elo = snap.trinomialElo;
      const pElo = snap.paired.elo;
      let statusMsg = `[${elapsed}s] ${completedGames}/${totalGames} ${jushuName} ${isABlack ? "A黒" : "A白"} +${wdl.wins}=${wdl.draws}-${wdl.losses} Elo:${elo.eloDiff > 0 ? "+" : ""}${elo.eloDiff} ペア(${snap.paired.pairs}):${pElo.eloDiff > 0 ? "+" : ""}${pElo.eloDiff}`;

      if (snap.paired.sprt) {
        const { sprt } = snap.paired;
        statusMsg += ` LLR:${sprt.llr.toFixed(2)}`;
        if (sprt.decision !== "continue") {
          writeStatus(statusMsg);
          clearStatus();
          console.log(
            `SPRT判定(ペア): ${sprt.decision} (${completedGames}局目 / ${snap.paired.pairs}ペアで停止)`,
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

  const finalSnap = stats.snapshot();
  return {
    wdl: finalSnap.wdl,
    games,
    completedGames,
    stoppedBySprt,
    aborts,
    abortsBySide,
    abortedGames,
    stats: finalSnap,
  };
}
