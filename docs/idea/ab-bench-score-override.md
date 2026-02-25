# ab:bench に PATTERN_SCORES オーバーライド対応を追加

## 背景

パラメータ変更の効果を検証するとき、self-play（同条件同士の対戦）ではblunder数や手数の変化は測れるが、**絶対的な強さの変化**（変更で弱くなっていないか）は測れない。

変更前 vs 変更後の直接対戦が必要だが、現在の `ab:bench` は `DifficultyParams`（depth, timeLimit等）の差分のみ対応しており、`PATTERN_SCORES` のオーバーライドには非対応。

## 提案

`ab:bench` に `--score-override` オプションを追加し、candidate 側のみに `PATTERN_SCORES` オーバーライドを適用する。

```bash
# baseline（現在のPATTERN_SCORES）vs candidate（TEMPO割引を無効化）
pnpm ab:bench --score-override=TEMPO_OPEN_THREE_DISCOUNT:0 --games=100

# 複数パラメータの比較
pnpm ab:bench --score-override=OPEN_THREE:1200,FOUR:2000 --games=200 --sprt
```

## 実装方針

1. `ab-bench.ts` の `parseArgs` に `--score-override` を追加
2. candidate ワーカーにのみ `patternScoreOverrides` を渡す
3. ワーカー内で `applyPatternScoreOverrides()` を呼び出し
4. baseline は現在のコードのまま（オーバーライドなし）

## 注意点

- baseline と candidate で探索深度・時間制限は同一にする（差はスコア定数のみ）
- `bench-ai.ts` の既存 `--score-override` は**両者**に適用する設計なので混同しない
