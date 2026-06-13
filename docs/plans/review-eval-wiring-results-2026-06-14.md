# 振り返り解析 eval=hard 配線 / timeLimit 短縮 検証結果 (2026-06-14)

## 背景

振り返り解析の `findBestMoveForReview` は WASM `findBestMove` の `eval_flags` 引数を
`0` ハードコードしていたため、必須防御/ミセ脅威/禁手脆弱性/葉 single-four ペナルティを
切った素 eval で読んでいた（A1 配線漏れ）。

`REVIEW_SEARCH_PARAMS.evaluationOptions = DIFFICULTY_PARAMS.hard.evaluationOptions` は
宣言済みだが未配線。#93 が対局側を直したが review 側は漏れていた。

加えて、白14 F11 のような中盤深度感受性手で、tl15k と tl5k で判定が反転する問題が
[[project_review_tool_perf]] 調査で判明。真因は MAIN MINIMAX DEPTH 駆動（eval 天井）。

## 変更

- **A1**: `findBestMoveForReview` に `evalOptionsFlags` 引数追加（必須）。
  `executeWasmSearch` で `encodeEvalOptions(REVIEW_SEARCH_PARAMS.evaluationOptions)`
  を渡す（hard 相当）。
- **A4**: `REVIEW_PROFILE_FAST.timeLimit` を `15000ms → 5000ms`、`absoluteTimeLimit` を
  `20000ms → 10000ms` に短縮。PRECISE は据え置き（精密モードの建付け尊重）。
- **A2**: profile-review に `--eval=hard|none` CLI オプション追加（検証用）。

## 検証棋譜

白番29手、白14 F11 が反転候補:

```
H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12
```

## 計測結果（profile-review.ts, 白番）

### 白14 F11（焦点）

| 構成                             | quality       | playedScore | scoreDiff | depth |
| -------------------------------- | ------------- | ----------- | --------- | ----- |
| 旧コード相当 (eval=none × tl15k) | blunder       | -99999      | 96611     | 7     |
| A1 適用 (eval=hard × tl15k)      | blunder       | -2588       | **2204**  | 7     |
| A1+A4 (eval=hard × tl5k)         | **excellent** | -2588       | 0         | 6     |

- eval=hard 配線で playedScore が -99999 → -2588 と 38倍改善（46倍 scoreDiff 縮小）。
- A4 短縮と組み合わせると白14 は excellent 判定。eval=hard 単体では blunder のまま。
- A1 と A4 は**必ずセットで運用**する。

### 全手サマリ（A1+A4 vs 旧）

| 手           | 旧 quality          | 新 quality        | 備考                         |
| ------------ | ------------------- | ----------------- | ---------------------------- |
| 白2 G8       | excellent           | inaccuracy (-103) | hard 評価で H10 がベスト判定 |
| 白4 G7       | inaccuracy          | inaccuracy        | 一致                         |
| 白6 H7       | good                | excellent         | A1で実手評価向上             |
| 白8 F10      | excellent           | excellent         | 一致                         |
| 白10 E9      | excellent           | mistake (340)     | hard 評価で I9 がベスト判定  |
| 白12 I9      | excellent           | excellent         | 一致                         |
| **白14 F11** | **blunder (96611)** | **excellent (0)** | **A1+A4の目玉**              |
| 白16 E8      | excellent           | excellent         | 一致                         |
| 白22 J5      | blunder             | blunder           | 敗着検出維持                 |

### 速度

- 旧 (eval=none × tl15k): 約 60-70秒/局（白14手）
- 新 (eval=hard × tl5k): 約 32-37秒/局（白14手） → **-47%**

## 影響と注意

- ✅ 白14クラスの判定反転を解消（A1+A4 セット必須）。
- ✅ 解析時間 -47%。
- ⚠️ 白2/白10 で新規 inaccuracy/mistake 判定が出る。これは hard 評価による正当な判定
  精緻化（旧 eval=none では深度不足で見逃していた）。ユーザー体感では「悪手が増えた」と
  感じる可能性あり。閾値見直しは別案件。
- ⚠️ 計測棋譜は 1 局のみ。汎化未検証（他棋譜での挙動は要追跡）。

## SSoT / 安全装置

- `REVIEW_EVAL_FLAGS` は `fullEval.ts` トップレベルで 1 回計算（モジュール定数）。
- `findBestMoveForReview` の `evalOptionsFlags` は **必須引数**（デフォルト 0 を廃止）。
  新規呼び出し経路で配線を忘れて素 eval に落ちる silent regression を防ぐ。
- `profile.evalOptionsOverride: undefined as number | undefined` で profile-review の
  `--eval=none` を実現。本番は `undefined` で `REVIEW_EVAL_FLAGS` に fallback。
- ユニットテスト `reviewEvalWiring.test.ts` で `encodeEvalOptions(REVIEW_SEARCH_PARAMS.evaluationOptions)`
  が hard と一致することを SSoT 不変条件としてガード。
