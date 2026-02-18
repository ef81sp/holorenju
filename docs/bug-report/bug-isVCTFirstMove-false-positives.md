# Bug: isVCTFirstMove の既知の偽陽性源

## 概要

振り返り機能で `isVCTFirstMove` が偽陽性を返し、非最善手が「最善手」として評価されるケースがある。ct=four の楽観判定は修正済みだが、他の課題が残存している。

## 再現棋譜の調査結果

元のバグ報告で使用した再現棋譜について、Phase 0 の調査で以下が判明した。

### 再現棋譜

`H8 H9 G8 I8 G10 G9 F9 E8 E10 H7 F10 H10 F8 F11`（14手目盤面）

- mise-VCF 検出: F8 の跳び四から VCF 手順あり
- F6=(9,5) は跳び四を作り、防御後に VCT 成立（10秒の `findVCTSequence` で手順確認済み）

### 検証結果

- `isVCTFirstMove(F6)=true` は **正しい結果**（正当な VCT 開始手）
- `hasVCT=true` かつ `findVCTSequence(3s)=null` は時間制限の差であり論理バグではない（10秒では検出可能）
- F6 が「最善手」(scoreDiff=0→"excellent") と評価されるのは VCT 開始手として正当
- **元のバグ報告の前提（「プレイヤーの手が不当に最善手として扱われる」）は、この再現棋譜では成立しない**

### 結論

ct=four 修正の有効性は合成局面テスト（`vct.perf.test.ts`）で確認済み。再現棋譜は偽陽性の再現ケースとしては不適切だったが、ct=four の楽観判定自体は合成局面で実証された実際の課題である。

## 修正済み: ct=four の楽観判定

### 症状

- `evaluateCounterThreat` の ct=four 分岐で `isThreat`（1手先の楽観判定）を使用
- ブロック位置が脅威を作っても、VCT継続に繋がらない場合に偽陽性
- 例: ブロックが「囲まれた活三」（両端に相手石）を作る場合、止め四しか作れずVCT不成立なのに `true` を返す

### 修正内容

- `isThreat` を `hasVCT` 再帰に置き換え（`vct.ts` L262）
- テスト3件追加（`vct.perf.test.ts`）

### 修正状況

- [x] 原因特定
- [x] 修正実装
- [x] テスト追加

## 未修正1: ct=three の hasVCF フォールバック未実装

### 症状

- `evaluateCounterThreat` で ct=three は `hasVCT` 再帰に直接フォールスルー
- 理論上は `hasVCF` フォールバックが正しい（防御の活三があると三脅威は無効、四脅威のみ有効）
- 実用上は時間予算の圧迫で採用不可

### 想定される原因

- `hasVCF` 呼び出しが共有 `TimeLimiter` の時間を大量消費
- VCT探索の各分岐で ct=three が発生するたびに hasVCF が呼ばれる

### 確認方法

`docs/vct-counter-threat-analysis.md` の「試行2」セクションに詳細あり。

### 修正状況

- [x] 原因特定
- [ ] 修正実装（時間予算の問題を解決する設計が必要）
- [ ] テスト追加

## 未修正2: 探索関数の ct=four/three フォールスルー

### 症状

- 探索関数（`hasVCT`/`findVCTMove`/`findVCTSequence`）は ct=four/three を通常再帰にフォールスルー
- `evaluateCounterThreat` の ct=four 修正は `isVCTFirstMove` 専用であり、探索関数本体には未適用

### 想定される原因

- 探索関数に ct=four を適用すると探索木が変形し実用時間で完了しない

### 観察事項: hasVCT vs findVCTSequence の時間制限不一致

`hasVCT`（boolean判定）と `findVCTSequence`（手順収集）で時間消費が異なり、結果の一貫性がないケースがある。ただし、再現棋譜の F6 の事例（`hasVCT=true`, `findVCTSequence(3s)=null`）は調査の結果 F6 が正当な VCT 開始手と判明したため、偽陽性の再現例としては使用できない（「再現棋譜の調査結果」セクション参照）。

### 修正状況

- [x] 原因特定
- [ ] 修正実装（Phase 2「ヒント方式 + minimax検証」で吸収する設計を予定）
- [ ] テスト追加

## 未修正3: review.worker.ts の isVCTFirstMove 呼び出し最適化

### 症状

- `review.worker.ts` で VCT 検出は `VCT_STONE_THRESHOLD` でゲートされるが、`isVCTFirstMove` 呼び出し前にはこのガードがない
- `isVCTFirstMove` は独自の `TimeLimiter` と `isThreat`/`hasOpenThree` ガードで制限されるため、正確性への影響はない

### 改善内容

- パフォーマンス最適化: 石数が少ない序盤では VCT が成立しにくく、`isVCTFirstMove` の計算が無駄になる
- `isVCTFirstMove` 呼び出し前に石数チェックを追加することで不要な計算を削減

### 修正状況

- [x] 原因特定
- [x] 修正実装（`isVCTFirstMove` 呼び出し前に石数チェック追加）
- [x] テスト追加（worker はテスト困難、findVCTSequence と同一ガード条件のため既存テストで回帰確認）

## 関連ファイル

| ファイル                                                 | 役割                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `src/logic/cpu/search/vct.ts`                            | VCT探索本体・`evaluateCounterThreat`・`isVCTFirstMove` |
| `src/logic/cpu/review.worker.ts`                         | 振り返り評価ワーカー（`isVCTFirstMove` 呼び出し元）    |
| `docs/vct-counter-threat-analysis.md`                    | カウンター脅威の設計分析                               |
| `docs/cpu-flow-review-plan/phase1-vct-counter-threat.md` | Phase 1 実装記録                                       |
