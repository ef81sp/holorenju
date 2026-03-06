# スコア体系の見直しによるCPU性能向上

## Context

アルゴリズム面の改善（PVS, LMR, NMP, Counter-move等）が頭打ちになってきたため、minimax探索の評価関数のスコア体系を見直して性能向上を図る。

## 戦術棚卸し

### 連珠の速度分類（公式体系）と実装状況

| 速度 | 名称       | 定義                     | 実装状況                                      | 備考     |
| ---- | ---------- | ------------------------ | --------------------------------------------- | -------- |
| 伍   | 五連       | 5石直線 = 勝利           | ✅ FIVE=100,000                               |          |
| 肆   | 四         | 次手で五連               | ✅ OPEN_FOUR=10,000 / FOUR=1,500              |          |
| 参   | 三         | 次手で四                 | ✅ OPEN_THREE=1,000 / THREE=30                |          |
| 参   | ミセ手     | 次に四三を作れる手       | ✅ MISE_BONUS=1,000 / DOUBLE_MISE_BONUS=4,000 |          |
| 参   | フクミ手   | 次にVCFがある手          | ❌ コード存在するが**ゲームプレイで未使用**   | 後述     |
| 弐   | 呼珠(呼手) | 攻め態勢を構築する準備手 | ❌ CONNECTIVITY_BONUS=30で間接カバーのみ      |          |
| 壱   | 大呼珠     | 呼珠のさらに遠い準備     | ❌ 深度4では拾えない                          | 長期課題 |

### 追い手（強制勝ち手順）の実装状況

| 追い手            | 定義                       | 実装状況              | 使用箇所                        |
| ----------------- | -------------------------- | --------------------- | ------------------------------- |
| VCF(四追い)       | 連続四で勝ち               | ✅ 事前チェック       | `iterativeDeepening.ts:209-220` |
| Mise-VCF          | ミセ→強制応手→VCF          | ✅ 事前チェック       | `iterativeDeepening.ts:231-252` |
| VCT(三四連続勝ち) | 三と四を交互に作り追い詰め | ⚠️ hardのみ、ヒント手 | `iterativeDeepening.ts:253-269` |

### 複合脅威・戦術ボーナスの実装状況

| 戦術             | 実装状況       | スコア                         |
| ---------------- | -------------- | ------------------------------ |
| 四三同時作成     | ✅             | FOUR_THREE_BONUS=5,000         |
| カウンターフォー | ✅             | COUNTER_FOUR_MULTIPLIER=1.5    |
| 複数方向脅威     | ✅             | MULTI_THREAT_BONUS=500         |
| 防御交差点       | ✅             | DEFENSE_MULTI_THREAT_BONUS=300 |
| 必須防御         | ✅ 全脅威対応  | 活四→止め四→活三→三三→ミセ     |
| 単発四ペナルティ | ✅             | hard: 0.0倍（完全無価値）      |
| 禁手追い込み(白) | ✅ 3バリアント | 1,500〜5,000                   |
| 禁手脆弱性(黒)   | ✅ 2バリアント | -400〜-1,000                   |
| 末端四三脅威     | ✅             | LEAF_FOUR_THREE_THREAT=2,000   |

### 他エンジンとのスコア比較

**注意: gobang(lihongxun945)は禁手なしの五目並べエンジン**。

| パターン     | gobang(禁手なし) | holorenju | 差異      |
| ------------ | ---------------- | --------- | --------- |
| FOUR         | 1,500            | 1,500     | 同一      |
| OPEN_THREE   | 1,000            | 1,000     | 同一      |
| **THREE**    | **150**          | **30**    | **5倍差** |
| **OPEN_TWO** | **100**          | **50**    | **2倍差** |
| TWO          | 15               | 10        | 近い      |

### 改善機会の優先度マトリクス

| 改善項目                                  | 実装難易度 | 期待効果           | 優先度 |
| ----------------------------------------- | ---------- | ------------------ | ------ |
| ab-bench --score-override / --eval-option | 低         | 高（検証基盤）     | ★★★    |
| スコア比率調整(THREE,OPEN_TWO)            | 低         | 中〜高             | ★★☆    |
| フクミ手の有効化（ルート限定）            | 中         | 中（効果は限定的） | ★★☆    |
| ノリ手の一般化（カウンター拡張）          | 低〜中     | 中                 | ★★☆    |
| 呼珠（準備手の評価）                      | 中         | 中                 | ★★☆    |
| テンポ補正の拡張                          | 低         | 低〜中             | ★☆☆    |
| ネライ手                                  | 高         | 低（限定的）       | ★☆☆    |

## 実装プラン（アジャイル: Phase 1-3 確定、以降は再計画）

### Phase 1: ab-bench に --score-override と --eval-option を実装（検証基盤）

`docs/idea/ab-bench-score-override.md` の構想を実装する。

**実装内容:**

1. `ab-bench.ts` の `parseArgs` に `--score-override=KEY:VALUE,...` を追加
2. KEY の有効性バリデーション（`PATTERN_SCORES` のキーと照合、無効KEYはエラー）
3. candidate の `customParams.evaluationOptions.patternScoreOverrides` に注入
4. `--eval-option=KEY:VALUE,...` を追加（`EvaluationOptions` のフラグ切り替え）
   - 例: `--eval-option=enableFukumi:true`
   - KEY の有効性バリデーション（`EvaluationOptions` のキーと照合）
   - candidate の `customParams.evaluationOptions` に注入
5. ヘルプ・ログ表示の更新

**注意:** `game-worker.ts` の `scoreOverrides`（Worker全体＝両者に適用）は使わない。
`customParams.evaluationOptions.patternScoreOverrides` 経由で candidate のみに適用する。

**対象ファイル:**

- `scripts/ab-bench.ts` — CLI引数パース、candidate設定、バリデーション

**コミット単位:** Phase 1 完了でコミット

### Phase 2: スコア比率の調整

Phase 1 の `--score-override` で即座に検証可能。ローリスクなため先に実施。

**2a: 個別パラメータの検証**

| #   | 仮説                        | 変更       | 根拠                                     |
| --- | --------------------------- | ---------- | ---------------------------------------- |
| H1  | THREE が過小評価            | 30→80〜150 | VCF素材。禁手ありでは gobang の150が上限 |
| H2  | OPEN_TWO が過小評価         | 50→80〜100 | 将来の活三素材                           |
| H3  | CONNECTIVITY_BONUS が控えめ | 30→50〜80  | 呼珠的価値の間接カバー                   |

**2b: 判定基準**

- SPRT: elo0=0, elo1=30 で判定
- 200局以上で有意差なしなら不採用
- 個別検証後、採用パラメータの**組み合わせテスト**を必ず実施
  - 組み合わせは最大4パターン（AB, AC, BC, ABC）× 416局 = 1664局を見込む

**2c: futility margins の連動調整**

- スコア変更後に `measure-futility-margins.ts` を再実行して P95 を再測定
- 測定結果に基づいて `techniques.ts` の futility margins を更新
- ASPIRATION_WINDOW は FOUR=1500 基準のため、FOUR が変わらなければ据え置き

**対象ファイル:**

- `src/logic/cpu/evaluation/patternScores.ts` — スコア定数変更
- `src/logic/cpu/search/techniques.ts` — futility margins（P95再測定に基づく更新）

**コミット単位:** 各パラメータ変更ごとにコミット

### Phase 3: フクミ手の有効化（ルートノード限定）

**レビューで判明した設計上の制約:**

- `evaluatePositionCore()` はホットパス（ムーブオーダリング全候補手 + futility pruning）
- ここに VCF 探索 (depth8, 150ms) を追加すると探索が事実上停止する
- → **`evaluatePositionCore` には入れない**

**3a: ルートノード専用のフクミ手評価（後処理方式）**

**現状の問題:** `FUKUMI_BONUS=1500` と `enableFukumi: true`（hard）が存在するが、
ホットパスの `evaluatePositionCore()` にはフクミ計算がない。
`evaluatePositionWithBreakdown()`（デバッグ用）にのみ実装されている。
ルートの `generateSortedMoves` → `evaluatePosition` → `evaluatePositionCore` の流れでは
フクミ手は**実際には評価されていない**。

**実装方針:**

- `iterativeDeepening.ts` の `generateSortedMoves()` 呼び出し後、minimax に入る前の後処理として実装
- ソート済み候補手の上位5手のみに `isFukumiMove()` を適用しスコアに加算
- `evaluatePositionCore` には入れない（ホットパス保護）
- ルートノード専用の後処理であることをコメントで明記

**既存の VCF 事前チェックとの棲み分け:**

- 事前 VCF チェック (`checkForcedWinSequences`): 現在の手番で VCF があるか → あれば即座に返す
- フクミ手ボーナス: 各候補手を着手した後の盤面で VCF が生まれるか → ムーブオーダリングのスコアに加算

**パフォーマンス制御:**

- VCF の時間制限を短縮: 150ms → 30ms（`VCFSearchOptions.timeLimit` で指定）
- 上位5手のみ評価（5手 × 30ms = 最大150ms、dynamicTimeLimit で吸収可能）
- 序盤（石数が少ない場合）はVCFが成立しにくいためスキップを検討

**3b: @deprecated コメントの削除**

- 実装が完了しテスト通過後に `FUKUMI_BONUS` の `@deprecated` を削除

**3c: ab-bench で効果検証**

- `--eval-option=enableFukumi:true` で有効化して検証
- 判定基準: SPRT elo0=0, elo1=30

**対象ファイル:**

- `src/logic/cpu/search/iterativeDeepening.ts` — ルートノードのフクミ手評価追加
- `src/logic/cpu/evaluation/patternScores.ts` — @deprecated 削除
- `src/logic/cpu/search/vcf.ts` — VCF 時間制限調整（150ms→30ms、オプション化）

**コミット単位:** Phase 3 完了でコミット

### Phase 4以降: Phase 2-3 の結果を見て再計画

候補:

- 呼珠の専用実装（CONNECTIVITY_BONUS増加で不十分な場合）
- テンポ補正の拡張（活三以外への適用）
- CENTER_BONUS の見直し
- THREE の色別重み付け（黒番の禁手リスクを考慮）
- commit-bench で最終検証

## 検証方法

1. Phase 1: `pnpm ab:bench --score-override=THREE:150 --games=20` で動作確認
2. Phase 1: `pnpm ab:bench --eval-option=enableFukumi:false --games=20` で動作確認
3. Phase 2: `pnpm ab:bench --score-override=THREE:150 --sprt --elo0=0 --elo1=30` で検証
4. Phase 3: `pnpm ab:bench --eval-option=enableFukumi:true --sprt --elo0=0 --elo1=30` で検証
5. 最終: `pnpm commit:bench --randomFactor=0.02 --sets=8`

## 対象ファイル一覧

- `scripts/ab-bench.ts` — Phase 1: --score-override / --eval-option CLI
- `src/logic/cpu/evaluation/patternScores.ts` — Phase 2: スコア変更, Phase 3: @deprecated削除
- `src/logic/cpu/search/techniques.ts` — Phase 2: futility margins（P95再測定に基づく更新）
- `src/logic/cpu/search/iterativeDeepening.ts` — Phase 3: ルートノードのフクミ手評価
- `src/logic/cpu/search/vcf.ts` — Phase 3: VCF時間制限調整
