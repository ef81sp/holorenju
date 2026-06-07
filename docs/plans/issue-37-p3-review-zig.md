# #37 P3 (#42) — review 戦術解析を Zig 構造化 API へ移行

親: #37 ／ 依存: P0(#44 スナップショット) ／ 前段: P1(#45 メイン禁手Zig化), P2(#46 vcfPuzzle禁手Zig化) マージ済。

多エージェント設計（理解5→敵対検証2→設計パネル3→統合1）で策定。ボス合意: 2026-06-07。

## 北極星（#37 全体）

review（振り返り）の戦術計算はすべて Zig。TS は「プレゼン＋ワークフロー」に徹する。副作用で `patterns.ts`/`forbiddenMoves.ts` が削除可能になる（P4 #43）。

## 統合方針

出力契約を先に凍結（安全網）→ Zig オラクル正確化 → thin wasm の橋を**無接続で**敷設 → 利用点を**葉から1ファイル単位**で張替（各PR revert 容易）。

## 確定した技術判断（敵対検証で固めた）

1. **真の橋は `vct.classifyThreat`（`zig/src/vct.zig:48`、pub、黒長連除外を内包、TS `threatMoves.ts:135 classifyThreat` と 1:1 構造一致）。**
   - `main.zig:59 classifyPointWasm` は**使わない**: 生パターンビットで `isJumpFourOverline`/`checkEndsForFour` の黒長連除外を欠き、TS `createsFour`/`createsOpenThree` と**非同値**。そのまま OR すると黒の四・跳び四判定がズレる。
   - `classifyPointWasm` は #21 パリティ用オラクルとして維持・正確化（PR1）。
2. **thin wasm は `board_cells` 同期に加え `bitboard.initFromCells` 同期が必須**（P1 `forbidden_wasm` との唯一の構造差）。`vct.classifyThreat` が `ll.queryPatternByCell` 経由で `bitboard.global_bb` に依存するため。
3. **API 粒度＝小 export 群**（`classifyThreat` / `detectOpponentThreats` / 各ヘルパー）。`analyzePositionForReview` 一本化はしない: detectForcedWin/checkForcedLoss の段取り（AND-OR木合成・isForbiddenTrap・needsVCTCheck フェーズ協調）が worker の Phase 1/2/3 分割と密結合で、一本化すると 1PR 巨大化＋二分切り分け不能。段取りは TS に残し、中の戦術判定だけ Zig。
4. **thin wasm 新設**（`threat_wasm.zig`）: vcfPuzzle がメインスレッド実行で engine wasm を持たない（`createsFour` を TS 直呼び、禁手のみ P2 thin wasm）ことを確認済 → 橋には thin wasm が必須。
5. **評価関数（`evaluatePositionWithBreakdown`/`evaluateBoardWithBreakdown`）は P3 から除外**（ボス合意）。これらは評価関数(#22領域)依存で review-live かつ main-search-live＝棋力レグレッションが別階層。別 issue で扱う。
6. **列挙順序は座標ソートで順序非依存化**（ボス合意）: 防御位置・`findThreatMoves`・ThreatInfo 各リストは snapshot/利用側で座標昇順正規化。ただし `forcedWin.sequence` のように順序が探索結果に意味を持つ箇所は個別に TS/Zig 完全一致を要する。

## /review 反映（3観点LGTM・2026-06-07）

- **PR2 盤面同期キャッシュ必須**: forbiddenAdapter の無条件 `boardInit` を `syncBoardIfChanged`（盤面ハッシュ比較で再同期スキップ）または差分同期に upgrade。`createsFour` 単点でも毎回 `bitboard.initFromCells` 全盤再構築になるため、盤面全走査で呼ぶ利用点があると O(225²)。adapter 新設時から組込む。
- **threatAdapter は `classifyThreat` 一括 API を基本**: `classifyThreat(board,r,c,color)→{createsFour,createsOpenThree}`（wasm の `classifyThreatWasm` が bit0/bit1 を返す）。candidateVerification が four/openThree を両方呼ぶ→往復1回に削減。`createsFour`/`createsOpenThree` は内部で一括を呼ぶ薄いラッパとして提供。
- **PR4 は PR5/PR6 の前提**（並行不可）: `PR0→PR1→PR2→PR3→PR4→{PR5, PR6}→PR7`。PR5(Mise)/PR6(VCT) は PR4 の Zig-side detectOpponentThreats を前提にする。
- **thin wasm テンプレ化**: `build.zig` に「3つ目以降の thin wasm 追加チェックリスト」を JSDoc で明記（依存を board+次数1モジュールに限定、`bitboard.initFromCells` 要否の判定）。`threatLoader` は `loader.ts:loadWasmBuffer` を再利用（DRY）。
- イシュー観点: 土台主張6点すべて検証「正」（橋=vct.classifyThreat / bitboard同期必須 / sequence非ソート / PR0凍結漏れなし / PR1=#21オラクル目的 / patterns.ts見落としなし）。

## ゲート（毎PR）

- #21 `renjuParity.test.ts` 緑（TS==Zig）
- P0 `reviewSnapshot.test.ts` が1ビットも変わらない
- `pnpm check-fix` 緑、`cd zig && zig build` 緑

## PR 列

### PR0 — reviewSnapshot を P3 移植対象の戦術プリミティブまで拡張（安全網のみ・ロジック不変）【最初のPR・実装済】

- **実装方針の改善（着手時に確定）**: 当初案は非決定的な `executeFullEval` 出力（candidates[]）を凍結する想定だったが、実装時に判明 — **P3 が移植する関数の大半（`detectOpponentThreats`/`findDoubleMiseMoves`/`hasOpenThree`/`hasFourThreeAvailable`/`createsFour` 等）は時間非依存の純粋関数で完全決定的**。時間依存は VCF/VCT 探索のみで、それは `checkCandidateForcedLoss` に `timeLimit=Infinity`（node-bound）で凍結可能。よって **`executeFullEval` の wall-clock 経路を避け、P3 が実際に置き換える関数を直接凍結**する方が堅牢かつ的確（`candidates[].opponentForcedWin` 等の出力は元々これら関数が算出するため、SSoT 的にも正しい）。`verifyCandidates` は `performance.now()` 配分で非決定なので凍結対象にしない（その戦術核 `checkCandidateForcedLoss` を凍結）。
- **Zigに移す**: なし
- **触る**: `src/logic/cpu/review/reviewSnapshot.test.ts`（新 describe ブロック追加）、`src/logic/cpu/review/candidateVerification.ts`（`annotateFukumiMoves` に optional `vcfOptions` フック追加、本番デフォルト=`REVIEW_VCF_OPTIONS` で挙動不変）
- **凍結する関数（→対応PR）**: `detectOpponentThreats`両色（PR4）／`findDoubleMiseMoves`両色（PR5）／`hasOpenThree`+`hasFourThreeAvailable`両色（PR6）／`checkCandidateForcedLoss`（PR3/PR4 被必勝層、Infinity options）／`annotateFukumiMoves`（PR3 の createsFour/createsOpenThree を使う isFukumi/fukumiDepth、Infinity options）
- **正規化**: ThreatInfo の5リスト・両ミセ手は座標昇順ソート（探索順非依存）。被必勝は {type, sequence}。
- **決定性検証**: 3回連続実行で snapshot 完全一致を確認済。コーパスは既存 P0 の forcing 局面（mise-vcf-#18 / white29-m20 / white29-m24）を流用。白29で `isFukumi:true/fukumiDepth:3`・`type:"vcf"` 被必勝列など実データを捕捉。
- **ゲート結果**: vue-tsc 0 / oxlint 0 / review+parity 145 tests 緑（parity は wasm 再ビルド後）。

### PR1 — ~~classifyPointWasm 黒長連対応~~【DROP（着手時に誤りと判明）】

**取りやめ理由**: `classifyPointWasm` と TS オラクル `classifyPointTs` の bit は**生のパターンプリミティブ**（`four`/`jumpFour` は `checkJumpFour` 等をそのまま反映＝黒長連でも true、長連は別途 forbidden bit 24-25 で符号化）。#21 はこの**共有プリミティブの TS==Zig** を検証する設計で正しい。ここに黒長連除外を組み込むと (1) TS 側も変えないとパリティが壊れ (2) 生プリミティブ(checkJumpFour)と合成(createsFour)を混同させ #21 の粒度を下げる＝**有害**。`classifyPointWasm` は橋でもない（橋は `vct.classifyThreat`）ので触らない。
**意図の受け皿**: 「vct.classifyThreat == TS createsFour を黒長連含め検証」は **PR2 の `threatAdapter.test`** が全空き点・両色・高密度局面で照合し内包済。既存 renjuParity が生プリミティブを、PR0 が createsFour 消費側 review 出力をガード済。

### PR2 — threat 専用 thin wasm + adapter を新設（橋だけ・利用者ゼロ）【実装済】

- **Zigに移す**: 新規 `zig/src/threat_wasm.zig`(thin、**実測 27.9KB**)。export: `boardInit`/`boardSet`/`syncBitboard`(=`bitboard.initFromCells`) + `classifyThreatWasm(row,col,color)->u8`（bit0=four, bit1=openThree、内部で `vct.classifyThreat`、(r,c) 配置済前提）。vct.zig を import するが Zig のデッドコード削除で classifyThreat 到達グラフのみ＝thin。
- **触る**: `zig/src/threat_wasm.zig`(新)、`zig/build.zig`(3つ目 thin wasm target `threat` + チェックリスト JSDoc)、`src/logic/cpu/wasm/threatLoader.ts`(新, `loadWasmBuffer` 再利用)、`src/logic/cpu/wasm/threatAdapter.ts`(新, `classifyThreat`/`createsFour`/`createsOpenThree`・未ロード時TSフォールバック)、`threatAdapter.test.ts`(新)、`.oxlintrc.json`(test の no-bitwise override 追加)
- **API**: `classifyThreat(board,r,c,color)→{createsFour,createsOpenThree}` 一括（候補は配置済規約=TS createsFour と同一）。`createsFour`/`createsOpenThree` は一括の薄いラッパ。bit 展開は算術（`bits===1||bits===3` 等、no-bitwise 準拠）。
- **安全網**: `threatAdapter.test.ts`（wasm == TS createsFour/createsOpenThree を全空き点・両色・決定的乱数局面 d=0.25/0.4/0.55＝**黒長連を踏む**で照合、27 tests 緑）。
- **性能ノート（/review 反映）**: 1呼び出し=全盤同期 O(225)。PR3 の利用点（候補少数）は問題なし。盤面全走査用途（PR6）は基盤盤面を1度同期し wasm 内で各点評価する**バッチAPI**を別途用意し O(n²) を回避すること（ハッシュキャッシュは盤面が点ごとに変わるため無効＝採用せず、adapter にノート明記）。
- **利用者ゼロ**: 起動時 preload（main.ts）は **PR3 で配線**（PR2 は adapter 未呼び出し＝完全 no-op）。PR3 で preloadThreatWasm を忘れると TS フォールバックのまま（正しさは不変だが Zig 未使用）になる点に注意。
- **ゲート結果**: vue-tsc 0 / oxlint 0 / zig build test 緑 / unit 1799 tests 緑。

### PR3 — `createsFour`/`createsOpenThree` 利用点を adapter へ張替（patterns.ts 依存を最初に剥がす）【実装済】

- **触る**: `candidateVerification.ts`（annotateFukumiMoves）/ `vcfPuzzle.ts`（L96 四判定）の import を threatAdapter へ差替。**preload 配線**: `main.ts`（vcfPuzzle 用・非ブロッキング）/ `review.worker.ts`（getWasmModule 内で await＝candidateVerification 実行前にロード）。
- **利用点削減**: **−2**（candidateVerification + vcfPuzzle が threatMoves→patterns.ts を踏まなくなった。grep で直接 import 消滅を確認）
- **preload 必須**: 未 preload だと TS フォールバックのまま＝Zig 未使用。両コンテキストで preloadThreatWasm を配線済。失敗時は TS フォールバックでクラッシュ回避。
- **安全網**: reviewSnapshot **バイト不変**（test は preload せず TS フォールバック＝同値）/ threatAdapter.test（wasm==TS）/ renjuParity / vcfPuzzle.test 15 緑。
- **ゲート結果**: vue-tsc 0 / oxlint 0 / unit 1799 緑。
- `threatMoves.ts` 本体はフォールバックとして当面残置（削除は P4）。残る createsFour 利用点（threatPatterns/vcfCheck/vctValidation/search index export）は PR4+ 対象。

### PR4 — `detectOpponentThreats` を Zig 委譲（review 中核・最大の利用点削減）【実装済】

- **重大な発見（着手時に検証）**: Zig `threats.detectOpponentThreats` と TS `detectOpponentThreats` は**非合法盤（多重四・長連・盤端の不能配置）で食い違う**（mises/openFours 等、合成ロジックの差）。が、**review が処理するのは合法な実戦局面のみ**で、実測で**実戦棋譜の全手数前置・両色 約168局面が 100% 一致**、不一致は非合法ランダム盤のみ。よって Zig 委譲は実戦で挙動同値＝安全。
- **Zigに移す**: `threats.detectOpponentThreats`(既存) を threat_wasm に export。ThreatInfo(5リスト×PositionList cap=64) を `[u8 count][count*(row,col)]` でバッファ wire（`getThreatInfoBuffer` + `memory` 読み出し）。threat.wasm は 27.9KB→**113KB**（evaluate スタックを引く）。
- **触る**: `zig/src/threat_wasm.zig`(export追加)、`threatLoader.ts`(memory/buffer)、`threatAdapter.ts`(detectOpponentThreats)、`threatAdapter.test.ts`(**合法局面ベース**の等価テスト)、`fullEval.ts`(L385/L407)、`forcedLossCheck.ts`(L324)、`review.worker.ts`(L79)。**main search の `moveOrdering.ts`/`detectOpponentThreatsFast` は不触**。
- **利用点削減**: **−3**（fullEval/forcedLossCheck/worker が evaluation の detectOpponentThreats→patterns.ts を踏まなくなった）
- **安全網**: 等価テストは**合法局面**で照合（非合法盤は review 非対象なので除外、classifyThreat の乱数照合は per-point なので維持）。**reviewSnapshot を threat wasm preload 付きに強化**＝本番(worker)と同じ Zig 経路で実戦コーパス（candidate 仮置き盤含む checkCandidateForcedLoss/annotateFukumiMoves）を golden(TS) と照合し**バイト不変を実証**（最強ガード）。
- **ゲート結果**: vue-tsc 0 / oxlint 0 / zig build test 緑 / unit 1802 緑 / reviewSnapshot 不変。

### PR5 — Mise系 → 2分割（着手時に判明: Zig 等価は `createsFourThree` のみ存在）

**発見**: Zig には `evaluate.createsFourThree` しか無い。`findMiseTargets`/`findMiseTargetsLite`/`findDoubleMiseMoves` の Zig 等価は**存在しない**（プランの `mise_vcf.findMiseTargetsLite` は誤り）。→ PR5 を分割。

#### PR5a — `createsFourThree` を Zig 委譲（gap:none）【実装済】

- **Zigに移す**: `evaluate.createsFourThree`（既存）を `threat_wasm` に export（`createsFourThreeWasm`、候補は空き前提で内部仮置き）。
- **触る**: `threat_wasm.zig`/`threatLoader.ts`/`threatAdapter.ts`（`createsFourThree`、未ロード時TSフォールバック）/`threatAdapter.test.ts`（合法局面・全空き点・両色で Zig==TS）/`doubleMiseBranches.ts`(L90)/`forcedWinDetection.ts`(L140)。両 call site とも空き候補で contract 一致を確認。
- **利用点削減**: **−2**（createsFourThree が winningPatterns→ を踏まなくなった）
- **ゲート結果**: vue-tsc 0 / oxlint 0 / unit 1805 緑 / reviewSnapshot バイト不変。

#### PR5b — `findMiseTargets`/`findDoubleMiseMoves` を Zig 新規実装【未着手・要新規Zig】

- **Zigに移す**: 両関数の Zig 等価が無いため**新規実装**が必要（plan の「new-impl 分岐」）。`findMiseTargets`(±2近傍走査・達四点列挙)、`findDoubleMiseMoves`(全空き点で四三2つ以上)。
- **触る（予定）**: `threat_wasm.zig`(新規fn+wire)/`threatAdapter.ts`/`fullEval.ts`(L647 findMiseTargets)/`forcedLossCheck.ts`(L185 findDoubleMiseMoves)/`forcedWinDetection.ts`(L113 findDoubleMiseMoves)。
- **安全網**: 合法局面で Zig==TS（reviewSnapshot は doubleMiseTargets/missedDoubleMise を凍結済＝最終ガード）。
- **リスク**: 高（新規Zig実装＋wire）。

### PR6 — VCT安全性ヘルパー（`hasFourThreeAvailable`/`hasOpenThree`/`findThreatMoves`）委譲

- **Zigに移す**: 盤面全走査版（per-direction 部品 `vct.classifyThreat`/`createsOpenThree` は既存、統合ループを Zig に）
- **触る**: `threat_wasm.zig`、`threatAdapter.ts`、`forcedLossCheck.ts`(isMiseVCTSafe)、`forcedWinDetection.ts`
- **利用点削減**: **−3〜4**
- **リスク**: `findThreatMoves` の列挙順序が VCT 探索順に影響し `forcedWin.sequence` を変える恐れ → 座標昇順正規化、ただし sequence が意味を持つ箇所は完全一致

### PR7 — 削除可否の棚卸し（P4 #43 への前置き・調査PR）

- review path 直接利用ゼロを grep 証明。dead 確認済（`countThreatDirections`/`hasDefenseThatBlocksBoth`）は削除候補に印
- **報告**: 物理削除（P4）は **main search（moveOrdering/threatDetectionFast）の Zig 化**に依存（P3 スコープ外の可能性大）

## P4 への距離（利用点の減り方）

PR3→PR6 で **review path の patterns.ts/forbiddenMoves.ts 直接利用がゼロ**。物理削除は main search の Zig 化に依存する点を PR7 で確定報告。

## load-bearing な参照箇所

- `zig/src/vct.zig:48 classifyThreat`（真の橋）、`vct.zig` の `isJumpFourOverline`/`isOverlineEnd`
- `zig/src/main.zig:59 classifyPointWasm`（橋に使わない。PR1 で #21 オラクルとしてのみ正確化）
- `src/logic/cpu/search/threatMoves.ts:27 createsFour` / `:82 createsOpenThree` / `:213 isJumpFourOverline`
- `src/logic/cpu/core/lineAnalysis.ts checkEndsForFour`（黒長連端の無効化）
- `src/logic/cpu/wasm/forbiddenAdapter.ts` / `zig/src/forbidden_wasm.zig` / `zig/build.zig`（PR2 のテンプレ、唯一差は `bitboard.initFromCells`）
- `src/logic/cpu/review/reviewSnapshot.test.ts`（PR0 拡張対象）
- `src/logic/cpu/review/fullEval.ts` / `forcedLossCheck.ts`（PR4 の detectOpponentThreats 利用点）
