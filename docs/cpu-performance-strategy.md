# CPU性能向上戦略

CPUの思考はプレイヤーが着手してからオンデマンドで開始されており、プレイヤーの思考時間（数秒〜数十秒）はCPUにとって完全な空き時間となっている。本ドキュメントでは、事前計算・プレイヤー手番中の探索・並列探索の実現可能性を分析し、推奨ロードマップを提示する。

## 現状アーキテクチャ

### Worker構成

| コンポーネント | ファイル                         | 用途                                           |
| -------------- | -------------------------------- | ---------------------------------------------- |
| CPU Worker     | `src/logic/cpu/cpu.worker.ts`    | ブラウザでのCPU思考（1つ）                     |
| Review Worker  | `src/logic/cpu/review.worker.ts` | 振り返り評価用プール（2-8個）                  |
| Bench Worker   | `scripts/game-worker.ts`         | ベンチマーク並列実行（Node.js worker_threads） |

**ブラウザ側** (`src/components/cpu/composables/useCpuPlayer.ts`):

- `initWorker()` でWorker生成。既存なら再利用
- コンポーネント `onUnmounted` で `terminate()` → Worker破棄
- 1リクエスト = 1レスポンスの同期プロトコル（`pendingResolve` が1つ）
- 最小待機 `MIN_CPU_WAIT_MS = 2000ms`（演出用）

**ベンチマーク側** (`scripts/bench-ai.ts`, `src/logic/cpu/benchmark/gameRunner.ts`):

- Web Workerを使わず `findBestMoveIterativeWithTT()` を直接呼び出し
- 直列版: メインプロセスで実行。`globalTT` が対局間で共有（世代管理で隔離）
- 並列版 (`--parallel`): Node.js `worker_threads` 使用。各Workerで独立したTT

### TT（Transposition Table）管理

- `transpositionTable.ts` の `globalTT` がWorkerスコープ内のシングルトン
- `Map<bigint, TTEntry>` で最大200万エントリ
- 世代管理 (`newGeneration()`) により古いエントリを自動置換
- Worker が生きている間はTTが保持される（terminate で消失）

### Zobristハッシュ

- `zobrist.ts` で `BigInt` ベースの64bit XOR
- Worker起動時に `Math.random()` でテーブル生成（毎回異なる値）
- インクリメンタル更新対応（石追加/削除時にXORで差分更新）

### 探索フロー

```
CPU手番 → cpu.worker.ts onmessage
  ├─ 開局フェーズ（≤3手）→ 珠型パターンから選択
  └─ 4手目以降 → findBestMoveIterativeWithTT()
       ├─ 事前チェック: 即勝ち → 必守 → VCF → Mise-VCF → VCT
       ├─ 候補手制限: 相手VCF防御、活三防御
       └─ Iterative Deepening (depth 1..maxDepth)
            └─ minimaxWithTT(): Alpha-Beta + TT + NMP + LMR + Futility
```

### 難易度別パラメータ

| 難易度   | 深度 | 時間制限 | ノード上限 | ランダム |
| -------- | ---- | -------- | ---------- | -------- |
| beginner | 1    | 1s       | 10K        | 80%      |
| easy     | 2    | 2s       | 50K        | 25%      |
| medium   | 3    | 4s       | 200K       | 10%      |
| hard     | 4    | 8s       | 600K       | 0%       |

### ボトルネック

- プレイヤー手番中にCPUは何もしていない
- TTがWorker terminate で消失（手番間のキャッシュが活用されない）
- `detectOpponentThreats` の二重呼び出し（`cpu-flow-review-plan.md` R-1）
- hard難易度でdepth=4が限界（8秒制限内）

---

## 1. ポンダリング（プレイヤー手番中の投機的探索）

**実現可能性: 高**

CPU着手後、プレイヤーが考えている間にCPUも先読みを開始する。

### Phase 1: Worker永続化（TT保持）

**コスト: 極低（約10行）/ 効果: 中**

`useCpuPlayer.ts` の `terminate()` を対局終了時のみに変更するだけで:

- TTが手番間で自動保持され、2手目以降の探索が高速化
- Zobristテーブルも保持される（再生成不要）
- Iterative Deepeningの浅い深度がTTヒットで即完了し、deeper探索に時間を回せる

変更ファイル: `src/components/cpu/composables/useCpuPlayer.ts`

### Phase 2: 単純ポンダリング

**コスト: 中（約100行）/ 効果: 高**

CPU着手後、最善応手を1つ予測して探索開始:

- 予測ヒット時 → TTから即応答（体感0ms）
- 予測ミス時 → Worker.terminate() + 新Worker + 正規探索

**技術課題:** 探索ループ（`minimaxWithTT` 内の同期ループ）中に Worker の `onmessage` が発火しない。中断方法の選択肢:

| 方法                               | メリット                 | デメリット      |
| ---------------------------------- | ------------------------ | --------------- |
| Worker.terminate()                 | シンプル。確実に中断     | TTが消失する    |
| SharedArrayBuffer + Atomics フラグ | TTを保持したまま中断可能 | COOP/COEPが必要 |
| 探索チャンク分割                   | Worker永続のまま中断可能 | 実装が複雑      |

**推奨:** Phase 2では Worker.terminate() 方式で開始。TTの消失を許容する（Phase 1の恩恵は正規探索で得られる）。

変更ファイル: `useCpuPlayer.ts`, `cpu.worker.ts`, `types/cpu.ts`

### Phase 3: マルチ候補ポンダリング

**コスト: 低（Phase 2から差分約50行）/ 効果: 高**

上位3手を順番に投機探索。TTに複数候補の情報が蓄積される。

予測ヒット率の推定:

- 序盤: 10-20%（候補手が多い）
- 中盤: 30-50%
- 終盤: 50-70%（候補手が少ない）

### ベンチマークへの影響

**なし。** ベンチマークはWeb Workerを使わず `findBestMoveIterativeWithTT()` を直接呼び出すため、`useCpuPlayer.ts` や `cpu.worker.ts` の変更は影響しない。

---

## 2. 事前計算

### 2a. 開局ブック拡張（3手→5手）

**実現可能性: 高 / コスト: 低**

現在 `opening.ts` で3手目まで（26珠型パターン）をカバー。5手目まで拡張すれば:

- 序盤の応答が即座に（探索不要）
- 序盤の棋力向上（定石に沿った手を打てる）
- hard難易度で序盤の時間制限 4s × 50% = 2s が節約される

花月・浦月等の必勝定石5手目をハードコード。各珠型に対して5-10パターン程度。

変更ファイル: `src/logic/cpu/opening.ts`

**ベンチマークへの影響:** あり。`opening.ts` を共有するため、5手目まで定石手が使われ序盤統計が変化する。

### 2b. 脅威マップのインクリメンタル更新

**実現可能性: 中 / コスト: 中〜高**

`detectOpponentThreats` が毎回盤面全体をスキャン（O(225)）している問題を、着手影響範囲のみの再評価（O(40)）に改善。`cpu-flow-review-plan.md` の R-1（二重呼び出し解消）と合わせて実施するのが効率的。

変更ファイル: `src/logic/cpu/evaluation/threatDetection.ts`, `src/logic/cpu/search/iterativeDeepening.ts`

**ベンチマークへの影響:** あり。探索効率が改善され、ベンチ結果に反映される。

---

## 3. 並列探索（Lazy SMP）

**実現可能性: 低**

複数Workerで同じ局面を異なるパラメータで同時探索し、共有TTで相互に高速化する手法。

### 最大の障壁: BigInt + SharedArrayBuffer の非互換性

現在のTTは `Map<bigint, TTEntry>` で実装されている:

- `Map` は SharedArrayBuffer に載らない
- fixed-sizeのハッシュテーブル（配列ベース）への全面書き換えが必要
- エントリのレイアウト: hash(8B) + score(4B) + depth(1B) + type(1B) + bestMove(2B) + generation(2B) = 18B/entry
- 200万エントリ = 約36MB の SharedArrayBuffer

### COOP/COEPヘッダー要件

ブラウザで SharedArrayBuffer を使用するには以下のHTTPヘッダーが必要:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- 外部リソース（CDN画像、フォントなど）に `crossorigin` 属性が必要
- サードパーティリソースが `Cross-Origin-Resource-Policy: cross-origin` を返す必要
- 開発環境と本番環境の両方で設定が必要

### Zobristテーブルの同期

全Workerが同じZobristテーブルを使用する必要がある:

- 現在は `Math.random()` で毎回生成 → Worker間で値が異なる
- 解決策: 固定シード（決定論的PRNG）に変更、またはSharedArrayBufferで共有

### 期待効果と実装コスト

- **期待効果:** 4 Workers で 1.5-2.0倍速（depth +1 程度）
- **推定変更量:** 500-1000行 + テスト大幅修正
- **影響ファイル:** `transpositionTable.ts`, `zobrist.ts`, `minimaxCore.ts`, `cpu.worker.ts`, `useCpuPlayer.ts`, `vite.config.ts`, テスト群

### ベンチマークへの影響

**あり（大）。** `transpositionTable.ts` を共有するため Map→fixed-size変更がベンチにも波及する。ただし Node.js `worker_threads` は SharedArrayBuffer をネイティブサポートするため、ベンチの並列版でもWorker間TT共有が可能になるメリットがある。

---

## 推奨ロードマップ

費用対効果（効果 / コスト）の順:

| 順位 | 施策                          | 効果   | コスト             | ベンチ影響       |
| ---- | ----------------------------- | ------ | ------------------ | ---------------- |
| 1    | Worker永続化（TT保持）        | 中     | 極低（10行）       | なし             |
| 2    | 開局ブック5手化               | 中     | 低                 | 序盤統計変化     |
| 3    | detectOpponentThreats重複解消 | 低〜中 | 低                 | 探索効率改善     |
| 4    | 単純ポンダリング              | 高     | 中（100行）        | なし             |
| 5    | マルチ候補ポンダリング        | 高     | 低（差分50行）     | なし             |
| 6    | 並列探索（Lazy SMP）          | 高     | 極高（500-1000行） | TT構造変更が波及 |

順位1-3は低リスクで即効果が見込める。順位4-5はポンダリングの段階的導入。順位6は現行の最適化が限界に達した場合の長期オプション。
