# 末端評価ギャップ分析

## 課題

ベンチマーク（report-2026-02-14-3、1000試合）でブランダー総数 ~2,800件。3000-5000スコア差範囲が全体の60%（~1,685件）を占める。

### 根本原因

`evaluateBoard()`（depth 0末端評価）と `evaluatePosition()`（手オーダリング用）の評価ギャップ。

| 関数                 | 四+活三のスコア                                     | 用途                    |
| -------------------- | --------------------------------------------------- | ----------------------- |
| `evaluatePosition()` | 四(1500)+活三(1000)+FOUR_THREE_BONUS(5000)=**7500** | 手オーダリング(depth>0) |
| `evaluateBoard()`    | 四(1500)+活三(1000)=**2500**                        | 末端評価(depth=0)       |

差分5000がそのまま3000-5000のブランダーレンジに対応。

### 本質的な問題

evaluateBoardは盤面上の既存パターンを加算するのみで、**「次の1手で四三（ミセ手）が作れる」脅威**を認識しない。evaluatePositionはこれを `FOUR_THREE_BONUS(5000)` と `MISE_BONUS(1000)` で評価している。

---

## 試行: LEAF_COMPOUND_THREAT_BONUS（失敗・削除済み）

### 実装内容

evaluateBoard()に「同一石が四と活三の両方を持つ場合にボーナス(1500)を加算」するロジックを追加。

### 失敗の理由

**条件の意味を誤解していた**。同一石に四+活三がある = 既に四三が成立した局面（ほぼ勝ち確定）。ここにボーナスを足しても「もう勝ってる局面をさらに高く評価するだけ」で、3000-5000範囲のブランダー（ミセ手の見逃し）には効果がない。

### A/Bテスト結果（bench-report-2026-02-14-5）

100試合 hard vs hard 直列、ボーナスあり vs なし:

| 範囲          | あり    | なし    | 差     |
| ------------- | ------- | ------- | ------ |
| 2000-3000     | 503     | 472     | +31    |
| **3000-5000** | **280** | **273** | **+7** |
| 総数          | 836     | 794     | +42    |

ターゲットの3000-5000範囲で改善なし。探索コストは+1.6%で無視可能だったが、効果がゼロのため全削除。

---

## 残した成果物

### `--score-override` フラグ（bench-ai.ts）

A/Bテスト用に追加した汎用フラグ。今後も使える。

```bash
pnpm bench --score-override=LEAF_COMPOUND_THREAT_BONUS:0
pnpm bench --score-override=FOUR:2000,OPEN_THREE:1200
```

- 直列・並列の両方に対応（ワーカーにも自動反映）
- `scripts/README.md` に使い方を記載済み

### ベンチマークレポート

- `docs/bench-reports/bench-report-2026-02-14-4.md` — ボーナスあり100試合
- `docs/bench-reports/bench-report-2026-02-14-5.md` — A/B比較分析

---

## 次のアプローチへの示唆

### やるべきこと

evaluateBoardに**ミセ手（次の1手で四三を作れる状態）の認識**を追加する。

### evaluatePositionでミセ手をどう検出しているか

`src/logic/cpu/evaluation/positionEvaluation.ts` の `evaluatePosition()` を参照。ミセ手判定 `isMiseMove()` の条件を確認し、同等の判定を evaluateBoard に導入できるか検討する。

### 留意点

1. **evaluateBoardはループ内で全石を走査する**。ミセ手検出は「空き交点に仮置きして四三が作れるか」の判定なので、計算コストが大きい可能性がある。パフォーマンスへの影響を慎重に評価する
2. **evaluatePositionのミセ手判定は「着手候補」に対して行う**。evaluateBoardは「既存の石」を見るので、そもそもアプローチが異なる。evaluateBoardに着手候補の走査を入れると、depth 1の探索と等価になる
3. **代替案**: evaluateBoard側でミセ手を検出するのではなく、探索の最小深度を1に引き上げる（depth 0をなくす）ことでギャップ自体を解消する可能性もある。ただしd0手（強制手等）が2300件/1000試合あるため、コスト増大のリスクがある
4. **ボーナス値**: evaluatePositionの `FOUR_THREE_BONUS(5000)` をそのまま使うのではなく、末端評価の特性に合わせた保守的な値から始める
5. **A/Bテスト**: `--score-override` フラグを活用して効果を定量的に検証する

### 関連ファイル

| ファイル                                          | 役割                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| `src/logic/cpu/evaluation/boardEvaluation.ts`     | 末端評価（変更対象）                           |
| `src/logic/cpu/evaluation/positionEvaluation.ts`  | 手オーダリング評価（ミセ手判定のリファレンス） |
| `src/logic/cpu/evaluation/patternScores.ts`       | スコア定数・型定義                             |
| `src/logic/cpu/search/minimaxCore.ts`             | 探索コア（depth 0でevaluateBoardを呼ぶ）       |
| `src/logic/cpu/evaluation/tactics.ts`             | isMiseMove() 等の戦術判定                      |
| `docs/bench-reports/bench-report-2026-02-14-3.md` | ベースラインベンチ（1000試合）                 |
