# #37 P4 (#43): patterns.ts / forbiddenMoves.ts 物理削除プラン

> ステータス: **実装中**（2026-06-09 改訂、Option C）。stacked PR で進行。

## Context

#37 の最終目標は、連珠ルール（禁手・図形・パターン判定）の **TS 二重実装 `src/logic/renjuRules/patterns.ts` と `forbiddenMoves.ts` を物理削除**し、ダブルメンテを解消すること（= #43）。Zig 側（`forbidden.zig`/`jump_patterns.zig`/`patterns.zig`/`vct.zig`/`threats.zig`）に全関数の実装があり、対局CPU・VCF/VCT worker・禁手判定（forbiddenAdapter）は既に Zig 委譲済み。

### 調査で判明した現実

patterns/forbidden を使う TS は **2クラスタ**に分かれる:

- **(a) 表示/評価クラスタ（ホット, 削除対象）**: `positionEvaluation`/`boardEvaluation` + eval helpers（jumpPatterns/forbiddenTactics/miseTactics/threatDetection(TS)/winningPatterns の一部/stonePatterns/followUpThreats/tactics/leafMiseThreat）。最終消費者は review の **breakdown 表示のみ**。
- **(b) VCT/VCF 判定クラスタ（コールド, 存続＋プリミティブ張替）**: `search/` の `vctHelpers`/`threatMoves`/`threatPatterns`/`vctValidation`/`vcfCheck`、および review 判定が直接叩く `winningPatterns.detectWhiteWinningPattern`。review の被必勝・被詰判定（`forcedWinDetection`/`forcedLossCheck`/`candidateVerification`/`doubleMiseBranches`）と VCF パズル生成（`vcfPuzzle.ts`）が使う**生きた動作経路**（Zig 探索結果に対する TS 後検証）。

確定事実:

- 対局CPUは完全 Zig（`cpu.worker`→`WasmSearchEngine`）で、`search/`・`evaluation/` の TS を一切使わない（`search/index.ts` 外部消費者ゼロ）。触る対象は **review と VCF パズルのみ**。
- **breakdown/leafEvaluation/candidate.score は完全に表示専用**（`CpuDebugInfo.vue` だけが消費。判定・並び順・採点は全て Zig 由来の `searchScore`/`playedScore`/`bestScore`）。
- ボス決定: 「**動作が変わらないことが重要、表示スコアが変わるのは構わない**」「**内訳パネルを簡素化/廃止**」。

## 方針（Option C: 表示クラスタ削除 + 判定クラスタのプリミティブ張替 + 物理削除）

旧 Option B（プリミティブ単位の adapter 委譲を評価ヘルパー全域に適用）は、**評価ホットループ**を per-call wasm 同期(O(225))で委譲しパリティテストがタイムアウトし頓挫。Option A（評価関数の全 Zig 化で ScoreBreakdown を Zig が返す faithful）は、breakdown が表示専用と判明したため過剰。

→ Option C:

> **(a) ホット表示クラスタは「削除」**（breakdown 表示を廃止して死蔵化）。
> **(b) コールド判定クラスタは「TS オーケストレーションを残し、葉プリミティブだけアダプタへ張替」**。

これにより:

- (b) の TS 判定アルゴリズム（`isResilientToCounterFours`/`checkSequenceBreaksByCF`/`detectWhiteWinningPattern` 等）は**温存**。**高位 Zig 関数で置換しない**（TS と Zig で高位ロジックが意図的に異なる箇所があり、置換すると判定が変わる）。
- 張替えるのは葉プリミティブのみ＝`checkJumpFour`/`checkJumpThree`/`checkStraightFour`/`get{Consecutive,Jump}*StraightFourPoints` → `patternsAdapter`、`checkForbiddenMove` → `forbiddenAdapter.isForbiddenForBlack`。これらは**パリティ検証済で出力等価**＝動作不変。
- (b) は review 1クリック/着手駆動の**非ホットパス**なので per-call sync でも実害なし。盤面全走査を内包する関数（`hasOpenThree`/`findThreatMoves` 等）は **threatAdapter の関数粒度1コール**を使う（点ごと sync 禁止）。

`forbiddenAdapter` は live（UI 禁手表示）→ 削除でなく **pure-wasm 化**。`patternsAdapter` は本プランで (b) に使い生かす。`PATTERN_SCORES` 定数は review が多用 → `patternScores.ts` は型を削り定数は残す。

## PR 分解（stacked sub PR、依存順）

各 PR ゲート＝`pnpm check-fix` 緑 + 全テスト緑 + **reviewSnapshot 不変** + 対局CPU無干渉 + `pnpm check:circular` 緑。

- **PR-0**: docs改訂 + reviewSnapshot CORPUS 拡充（`detectWhiteWinningPattern` double-three/four、`findWinningMove`/`getFourDefensePosition` を非自明値で固定）+ madge 導入（循環依存ゲート）。
- **PR-1**: ブートゲート — `main.ts` の preload を `app.mount` 前に await。フォールバックは残すので動作完全不変。
- **PR-2**: 表示内訳の除去 — `fullEval.ts` から `evaluatePositionWithBreakdown`/`evaluateBoardWithBreakdown` 呼び出し除去、`ReviewCandidate` を `{position,searchScore,principalVariation}` に縮約。`CpuDebugInfo.vue` の内訳描画除去。
- **PR-3【本丸】**: 判定クラスタ(b) の葉プリミティブをアダプタ張替。先に循環依存を解消（adapter→search フォールバックを隔離、threatAdapter の evaluation barrel 依存を直import化）。高位 TS ロジックは温存。
- **PR-4**: 死蔵ホット(a)クラスタの物理削除（`positionEvaluation`/`boardEvaluation`/`stonePatterns`/`leafMiseThreat`/`tactics`/`followUpThreats`、`breakdownUtils` は `formatScore` のみ残す）。`threatDetection(TS)`/`jumpPatterns`/`forbiddenTactics`/`miseTactics` は PR-6 まで残す。`winningPatterns`/`directionAnalysis` は live で残す。
- **PR-5**: `patternScores.ts` トリミング（内訳型を削り定数は残す）。
- **PR-6a**: パリティテストの Zig 回帰移植（`renjuParity` は削除、createsFourThree/vctHelpers/mise 系は Zig `test{}` ゴールデン化）。
- **PR-6【#37完了】**: フォールバック撤去（adapter pure-wasm 化）+ `git rm patterns.ts/forbiddenMoves.ts/patternRecognition.ts` + 死蔵化 helper 削除 + barrel 更新。

## 検証（動作不変）

1. `reviewSnapshot.test.ts`（全PRゲート, PR-0 拡充）— 判定出力が不変。
2. 参照棋譜での fullEval 回帰（bestMove/searchScore/PV 一致、即時評価 score 消失のみ許容）。
3. 対局CPU不変（同 seed ベンチで同一着手列）。
4. VCF パズル不変（禁手判定含む）。
5. 各PR `pnpm check-fix` + `pnpm check:circular`。
6. `cd zig && zig build` + `zig build test` 緑（PR-3/6a/6）。
7. ブラウザ E2E スモーク（対局禁手表示 / パズル / 振り返り、内訳ポップオーバー消滅）。

## リスク

- preload race: PR-1 を先行マージしてから PR-6。
- 循環依存: PR-3 で search→adapter を足す前に adapter→search フォールバックを隔離。`check:circular` ゲート。
- 高位ロジック乖離: `isResilientToCounterFours`/`detectWhiteWinningPattern` を高位 Zig に置換しない（葉プリミティブのみ張替）。
- 全走査の点ごと sync 禁止: threatAdapter 関数粒度コールへ。
- 巻き込み事故: フォールバック撤去（PR-6）まで死蔵化しない helper を PR-4 で消さない。
