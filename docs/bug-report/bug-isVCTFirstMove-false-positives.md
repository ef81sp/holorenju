# Bug: isVCTFirstMove の既知の偽陽性源

## 概要

振り返り機能で `isVCTFirstMove` が偽陽性を返し、非最善手が「最善手」として評価されるケースがある。ct=four の楽観判定は修正済みだが、他の偽陽性源が残存している。

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

## 未修正2: hasVCT 自体の偽陽性

### 症状

- 探索関数（`hasVCT`/`findVCTMove`/`findVCTSequence`）は ct=four/three を通常再帰にフォールスルー
- `evaluateCounterThreat` は `isVCTFirstMove` 専用のため、探索関数の偽陽性は未対応
- `hasVCT` が `true` でも `findVCTSequence` が `null` になるケースが存在（時間制限の違いによる）

### 想定される原因

- 探索関数に ct=four を適用すると探索木が変形し実用時間で完了しない
- `hasVCT`（boolean判定）と `findVCTSequence`（手順収集）で時間消費が異なり、結果の一貫性がない

### 確認方法

```bash
pnpm vitest run --project perf src/logic/cpu/search/vct.perf.test.ts -t "ミセ四追い"
```

再現棋譜 `H8 H9 G8 I8 G10 G9 F9 E8 E10 H7 F10 H10 F8 F11` の14手目盤面で、
F6=(9,5) に対する `isVCTFirstMove` が `true` を返す。
F6は跳び四を作り防御後に `hasVCT(depth=2)=true` だが、`findVCTSequence(3s)=null`（10秒では検出可能）。

### 修正状況

- [x] 原因特定
- [ ] 修正実装（Phase 2「ヒント方式 + minimax検証」で偽陽性を吸収する設計を予定）
- [ ] テスト追加

## 未修正3: review.worker.ts の VCT 検証ガード不足

### 症状

- `review.worker.ts` で VCT 検出は `VCT_STONE_THRESHOLD` でゲートされるが、`isVCTFirstMove` 呼び出し前にはこのガードがない
- `isVCTFirstMove` は独自の `TimeLimiter` と `isThreat`/`hasOpenThree` ガードで制限されるため影響は限定的

### 想定される原因

- `isVCTFirstMove` は任意の手に対して呼ばれるが、石数が少ない序盤では VCT が成立しにくく、計算が無駄になる

### 修正状況

- [x] 原因特定
- [ ] 修正実装（`isVCTFirstMove` 呼び出し前に石数チェック追加）
- [ ] テスト追加

## 関連ファイル

| ファイル                                                 | 役割                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `src/logic/cpu/search/vct.ts`                            | VCT探索本体・`evaluateCounterThreat`・`isVCTFirstMove` |
| `src/logic/cpu/review.worker.ts`                         | 振り返り評価ワーカー（`isVCTFirstMove` 呼び出し元）    |
| `docs/vct-counter-threat-analysis.md`                    | カウンター脅威の設計分析                               |
| `docs/cpu-flow-review-plan/phase1-vct-counter-threat.md` | Phase 1 実装記録                                       |
