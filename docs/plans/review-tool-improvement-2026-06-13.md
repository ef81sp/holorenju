# 振り返り解析ツール 改善プラン（2026-06-13）

## 目的

振り返り(review)解析の **高速化** と **悪手/好手判定の精度向上**。
着手順 **C→B→A**（stacked PR、葉先マージ、main マージ禁止）。各フェーズ TDD + `/review` + コミット。

## 調査で確定した前提（実測, 白29手 `H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12`）

- ②minimaxが解析時間の96〜99.7%。NPS約9,200、到達深度4-8ply。
- **timeLimit 15s→5s で重い8手すべて最善手一致(8/8)・解析-47%**（eval=0前提の実測）。
- **probe撤去/深さ路線は否定**（#89でq-nodeがmaxNodes計上→probe-OFFで深くならず・評価収束せず・戦術悪化）。bestScoreの中盤ブレは評価関数(no-ML)が真因で深さでは直らない。
- 判定の穴2つ（評価値非依存）: 誤blunder（-2000フォールバック, 白4,6）/ 敗着見逃し（verifyCandidatesのbreak-on-safeで実手未検証, 白14がtl15s=blunder↔tl5s=excellent）。
- eval配線漏れ: `findBestMoveForReview`(searchEngine.ts:175)がeval_flags引数なし・194行で`0`ハードコード。

---

## Phase C: アルゴリズム改善（高速化＋安定性）

### C1: TT手またぎ再利用（clearTT矛盾修正）★最有力

- **問題**: `REVIEW_PROFILE_PRECISE.clearTT=false`(reviewConstants.ts:44)なのに`findBestMoveForReview`が無条件`this.wasm.ttClear()`(searchEngine.ts:186)。設計意図と矛盾。Zig側は`findBestMoveIterative`が`newGeneration()`を呼び対応済(tt.zig:106で世代差自動上書き)。
- **設計**: `findBestMoveForReview`の`ttClear()`を `clearTT` 引数に従わせる。`executeWasmSearch`から`profile.clearTT`を渡す。**FAST(clearTT=true)は従来通りクリア=決定論維持**、PRECISE(false)で手またぎ再利用。
- **決定論性懸念**: PRECISEは手またぎで解析順依存になる→振り返り再現性。要profile-review測定で効果(+0.5〜1ply期待)と再現性を確認してから採用確定。効果薄/再現性問題なら見送り。
- 変更: searchEngine.ts(186), fullEval.ts(executeWasmSearch). TDD: clearTT=true/falseでttClear呼び出し有無をスパイ検証。
- 効果: **速度のみ(中)**。深さ→Elo≈0が確定済のため精度向上は見込まない(判定精度の根因はB1/B2の評価値非依存バグ) / リスク: 中(決定論性) / コスト: 低

### C2: annotateFukumiMoves のVCF結果再利用

- `annotateFukumiMoves`(candidateVerification.ts:155)が先頭でVCF探索(maxNodes500k/depth16)。これは`detectForcedWin`で計算済の場合がある。
- 設計: `existingVcf?`パラメータ追加、forcedWin局面では先頭VCFスキップ。fullEval呼び出し側で`forcedWin`を渡す。
- 効果: 速度低(VCF局面で100-300ms) / リスク: 低 / コスト: 低

### C3: verifyCandidatePVs / verifyCandidates の Infinity budget制限

- `fullEval.ts:763,999`の`verifyCandidatePVs(...Infinity...)`→`deadline=Infinity`(pvVerification.ts:144)で外側ループが全候補必ず処理。さらに`fullEval.ts:749,985`の`verifyCandidates(...Infinity...)`も同様にbudget無制限。両方PRECISEのみ(verifyCandidatesBudget=Infinity, enablePVVerification=true)。
- 設計: `REVIEW_PROFILE_PRECISE.pvVerificationBudgetMs`(例8000)/`verifyCandidatesBudgetMs`追加、呼び出しに渡す。内側のper-step deadlineは既に効くので「外側ループの無制限」のみ修正。
- ⚠️ **per-step累積コスト**: 候補数×per-candidate探索で1手あたり累積する。PRECISEのtimeLimit化(A4)は本C3の上限導入が前提（C3なしでtimeLimitだけ下げると候補検証ループが残時間を食い潰す）。
- 効果: 速度中(PRECISE暴走防止) / リスク: 低 / コスト: 低

---

## Phase B: 判定精度（悪手/好手）

### B1: 誤blunder修正（実手実評価）

- **問題**: 実手が候補top5外→`playedScore=bestScore-2000`固定(fullEval.ts:914, evaluatePlayedMove.ts:110)→機械的blunder。
- **設計(レビュー反映)**: `attachPVFromWasm`の拡張ではなく**独立ヘルパー`probePlayedMoveScore(board, playedRow, playedCol, color, engine, fallback?) → number`を新規作成**（SRP: attachPVはvoidのまま）。内部で`findBestMoveWithParamsNoTTClear(depth3/2s/200k)`を実手局面に対し実行→相手視点scoreを符号反転して返す。**挿入点は-2000フォールバックの直前**（fullEval.ts:907-914のplayedScore決定ブロック内、evaluatePlayedMove.ts:110の`??`右辺）。
  - ⚠️ **forcedWinパス対応必須**: `evaluatePlayedForcedWin`(fullEval.ts:597経由)内のL110の-2000も置換。候補外かつ非VCF/VCTの実手でのみ発動するので頻度は低いが対応する。
  - コスト: 実手が候補外のときのみ追加探索発生（強手なら候補内で不発）。attachPVが同局面を別途探索する場合は順序最適化でTT再利用（追加探索を増やさない）を検討。
- TDD: evaluatePlayedMove.test.ts新規。白4(G7)/白6(H7)でscoreDiff<=1000になるリグレッション。モックengineでprobePlayedMoveScore単体。
- 効果: 高 / リスク: 低 / コスト: 小

### B2: 敗着検出の確実化（実手強制検証）

- **真因(特定済)**: `verifyCandidates`(candidateVerification.ts:113)のbreak-on-safeで実手F11が未検証→時間依存反転。実手はverifyCandidates呼出時には既にcandidatesに含まれる(fullEval.ts:918-945で追加)が、先頭が安全だとbreakで未検証のまま終わる。
- **設計(レビュー反映: 案B採用=DRY)**: `verifyCandidates`に`alwaysVerify?: Position`引数を追加し、**break後もその座標の候補だけは必ず検証**。`buildNormalResult`/`buildForcedWinResult`は実手座標を渡すだけ(両関数への重複実装=案Aを回避)。被必勝なら既存のbestLoss/forcedLossType昇格ロジック(L1027-1030)を実手にも適用。
- ⚠️ **needsVCTCheck二重実行の整理(必須)**: `selfHasFourAfter=false && loss=null`で`needsVCTCheck=true`(fullEval.ts:417)がセットされる経路と、B2の実手強制VCTが同一`boardAfter`局面で二重にVCTを走らせる。`needsVCTCheck`が立つケースはB2の実手VCTをスキップ(Phase2に委譲)するか、逆にB2で確定させてneedsVCTCheckを下ろす。どちらか一方に統一。
- ⚠️ **FAST時コスト(レビュー反映)**: 実手強制検証(最大VCT2s+MiseVCF1s)はFASTでも走る。A4でtimeLimit5s化後、最悪手で +3〜4s ≒ 8〜9s/手になりうる。A4の実効上限設計に織り込む(per-candidate按分 or 実手検証に別budget)。
- TDD: 「break後でも実手が検証される」「安全な先頭候補があっても実手被必勝ならforcedLossType設定」。白14をreviewSnapshotコーパスに追加。
- 効果: 高 / リスク: 中 / コスト: 小

### B3: 判定閾値見直し（保留）

- classifyMoveQuality(reviewLogic.ts:38-53)の0/80/300/1000。0=excellentが厳しすぎる疑い。**B1後の実scoreDiff分布を見てから判断**。今回は変更しない。

---

## Phase A: eval配線 + timeLimit（高速化＋質）

### A1: eval配線 hard相当

- 設計: `encodeEvalOptions`(searchEngine.ts:40)をexport。`findBestMoveForReview`/`findBestMoveWithParamsNoTTClear`に`evalOptionsFlags`引数追加(現状0ハードコード:194,165)。`executeWasmSearch`/`attachPVFromWasm`から`encodeEvalOptions(REVIEW_SEARCH_PARAMS.evaluationOptions)`を渡す。CLI/テスト上書きは`FullEvalParams.evalOptionsOverride?: EvaluationOptions`(フラグでなく型で受けエンコードはモジュール内に閉じる=ISP)。
- ABI整合済(types.ts:44-52, main.zig:139が7番目引数eval_options_flags受領)。
- ⚠️ **効果の限定(レビュー反映)**: hard評価のenableFukumi/enableForbiddenVulnerability等は**move ordering(枝刈り効率)に効くが葉評価evaluateBoardには効かない**([[project_eval_feature_gap]])。つまりA1は「探索効率・最善手の質」には効くが「葉の評価値=判定値」の質改善は限定的。中立評価(eval=0)の方が客観評価としてノイズが少ない可能性も残る→A3で定量判断。
- 効果: 中(最善手の質・探索効率) / リスク: 中(最善手・スコア変化→A4再測定必須) / コスト: 低

### A2: profile-review に --eval=hard|none（検証インフラ）

- `FullEvalParams.evalOptionsFlagsOverride`経由でCLIから切替。eval=none(0) vs hard比較測定用。本体非汚染。

### A3: 再測定（A1後・A4前に必須）

- eval=none/hard × timeLimit{10k,7k,5k,4k,3k}スイープ。**採否の定量基準(レビュー反映)**:
  1. timeLimit5s維持の可否: eval=hard下で重い8手の最善手一致が保たれるか(eval=hard化で1ノードコスト増→NPS低下→安全点が上振れする可能性)。
  2. **eval採否**: 同一局面でeval=none vs hardのbestScore差が判定閾値(80/300/1000, reviewLogic.ts)を跨ぐ手の割合。跨ぎが多くかつhardが客観的に妥当でないなら配線を見送る/中立評価を選ぶ判断もあり得る。
  3. PRECISEも別途同様に測定(C3が前提)。

### A4: timeLimit 5000化

- A3で安全確認後、`REVIEW_PROFILE_FAST.timeLimit`15000→5000, absoluteTimeLimit20000→7000。PRECISEは測定後に確定(暫定維持＋コメント)。
- reviewSnapshot.test.tsはtimeLimit非対象(node-bound化)で影響なし。
- 効果: 高(-47%) / リスク: 中(再測定でミティゲート) / コスト: 極低

---

## PRスタック構成（葉先マージ）

```
main
└── PR-C（C1/C2/C3 アルゴリズム改善）
    └── PR-B（B1/B2 判定精度）
        └── PR-A（A1/A2/A4 eval配線+timeLimit）
```

- 各PRはTDD緑+`/review`+コミット。fullEval競合はstackで回避。
- profile-review検証拡張(branch sub/review-perf-investigation済: --time-limit/--max-nodes/--depth/quality列)はPR-Cのベースに含める or 検証インフラとして先頭コミット。

## 横断的懸念

- C1決定論性: FAST維持で緩和、PRECISE手またぎは効果測定で採否決定。
- B2タイムアウト: 実手VCT最大2sの許容確認。needsVCTCheck重複整理。
- A4: eval配線後の再測定なしにtimeLimit確定しない。
- 全Phaseで reviewSnapshot/reviewLogic/forcedLossPropagation/candidateVerification の各testへの影響を確認。
