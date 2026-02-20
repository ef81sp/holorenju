# Horizon Effect緩和プラン

## 背景

hard vs hard 200局のベンチマークで、VCTスコア（3000-10000）がd4の探索で検出された後、次の手（d4で再評価）でスコアが急落する現象が確認された。

- **game 155**: m17でscore=9468（FORBIDDEN_TRAP_STRONG+ボーナス）→m19で32に急落
- **game 99**: m41でscore=3794→m42白がd3中断→m44で-9858に急落

## 根本原因

> **レビュー指摘（イシュー）**: game 155の主因はhorizon effectではなく、**FORBIDDEN_TRAP_STRONG(8000)の過大評価**の可能性が高い。d4末端で局所的に検出された禁手追い込みパターンを8000点で評価するのは、実際の脅威の確実性に対して高すぎる。静止探索（四の手のみ延長）では、四以外の防御手による回避を検出できない。

1. **FORBIDDEN_TRAP_STRONGの過大評価**: d4末端の評価で禁手追い込みパターンが検出されると8000点が加算されるが、d5以降で白が防御可能な場合がある。パターンの確実性に応じたスコア段階化が必要
2. **静止探索（Quiescence Search）の不在**: depth=0で即座に `evaluateBoard()` を呼び、戦術的手（四を作る手）の強制延長がない
3. **Aspiration Windowの固定幅**: ASPIRATION_WINDOW=75が、8000+クラスの脅威スコアに対して狭すぎる

## 実装計画

### Phase 1: FORBIDDEN_TRAP_STRONGスコア調整（最優先）

> **レビュー指摘（イシュー）**: 静止探索より先に、評価関数側の修正を実施すべき。FORBIDDEN_TRAP_STRONGの8000点は「実質活四」の評価だが、禁手追い込みは活四ほど確実ではない。

**ファイル**: `src/logic/cpu/evaluation/patternScores.ts`

```typescript
// 変更前
FORBIDDEN_TRAP_STRONG: 8000,

// 変更後
FORBIDDEN_TRAP_STRONG: 5000,
```

**根拠**:

- OPEN_FOUR(10000)の半分のスコアに位置づけ
- FOUR_THREE_BONUS(5000)と同等: 禁手追い込みは四三と同程度の脅威度
- d4末端での過大評価を抑制しつつ、依然として高い攻撃価値を維持

**テスト先行**:

- 禁手追い込みの評価スコア変更を反映するテスト更新
- ベンチマークで禁手追い込み率が大幅に低下しないことを確認（白の追い込み能力を過度に弱体化しない）

**Phase 1完了後に必ずベンチマーク**。blunder率とadvantage-squandered率への影響を測定。

### Phase 2: Aspiration Windowの動的調整

**ファイル**: `src/logic/cpu/search/iterativeDeepening.ts`, `src/logic/cpu/search/techniques.ts`

現在の固定幅ウィンドウを、前の深度のスコアに応じて動的に調整。

```typescript
// techniques.ts
export const ASPIRATION_WINDOW_BASE = 75;
export const ASPIRATION_WINDOW_HIGH_THREAT = 300;
export const HIGH_THREAT_THRESHOLD = 3000;
```

```typescript
// iterativeDeepening.ts の反復深化ループ内
function getAspirationWindow(previousScore: number): number {
  if (Math.abs(previousScore) >= HIGH_THREAT_THRESHOLD) {
    return ASPIRATION_WINDOW_HIGH_THREAT;
  }
  return ASPIRATION_WINDOW_BASE;
}
```

**効果**: 高脅威スコア時の不要な再探索を削減し、探索効率を向上。

> **レビュー指摘（イシュー）**: Aspiration Window拡大はhorizon effectの根本原因を解決しない。再探索を減らすだけであり、blunder率への直接効果は小さい。目標は「再探索回数削減」に限定すべき。

**テスト先行**:

- 高スコア時にウィンドウ幅が拡大されることを確認
- 再探索回数がベンチマークで減少することを確認

### Phase 3: 静止探索（Quiescence Search）の導入（Phase 1の結果次第でゲート判断）

> **レビュー指摘（パフォーマンス）**: Phase 1のスコア調整で改善が十分なら、静止探索は不要。Phase 1のベンチマーク結果でblunder改善が0.2/局以上あれば実施、なければ中止。

**ファイル**: `src/logic/cpu/search/minimaxCore.ts`

depth=0到達時に、戦術的な後続手（四を作る手）がある場合のみ探索を延長する。

```typescript
function quiescenceSearch(
  board: BoardState,
  alpha: number,
  beta: number,
  perspective: StoneColor,
  ctx: SearchContext,
  qDepth: number = 0,
): number {
  const MAX_Q_DEPTH = 2;

  // 静止評価
  const standPat = evaluateBoard(board, perspective, ctx.evaluationOptions);

  if (qDepth >= MAX_Q_DEPTH) {
    return standPat;
  }

  if (standPat >= beta) {
    return beta;
  }

  let currentAlpha = Math.max(alpha, standPat);

  // 戦術的手のみ生成（四を作る手）
  const tacticalMoves = findFourMoves(board, perspective);
  if (tacticalMoves.length === 0) {
    return standPat;
  }

  for (const move of tacticalMoves) {
    board[move.row][move.col] = perspective;

    const opponent = perspective === "black" ? "white" : "black";
    const score = -quiescenceSearch(
      board,
      -beta,
      -currentAlpha,
      opponent,
      ctx,
      qDepth + 1,
    );

    board[move.row][move.col] = null;

    if (score >= beta) {
      return beta;
    }
    currentAlpha = Math.max(currentAlpha, score);
  }

  return currentAlpha;
}
```

minimaxCore のリーフ評価を変更:

```typescript
// 変更前
if (depth === 0) {
  return evaluateBoard(board, perspective, options);
}

// 変更後
if (depth === 0) {
  return quiescenceSearch(board, alpha, beta, perspective, ctx);
}
```

**注意点**:

- `MAX_Q_DEPTH = 2` で探索爆発を防止（四の手は通常0-5個で分岐が少ない）
- `standPat >= beta` の早期リターンで多くのリーフでは `findFourMoves` 自体が呼ばれない
- 禁手チェック: 黒番の場合は `findFourMoves` が禁手を除外済み

> **レビュー指摘（イシュー）**: FORBIDDEN_TRAP_STRONGに起因するhorizon effectは、四の手のみの静止探索では検出できない（防御は四以外の手で行われる）。静止探索はVCF関連のhorizon effectには効果があるが、FORBIDDEN_TRAP関連には効果が限定的。

**テスト先行**:

- 四を作る手がある場合に延長されることを確認
- 四がない場合は `standPat` を返すことを確認
- MAX_Q_DEPTH制限が機能することを確認

### ~~Phase 4: 高スコア時の探索延長~~ （ゲート付き）

> **レビュー指摘（パフォーマンス）**: Phase 3の計算量リスクが深刻。depth=1ノードの30-50%で発火→探索ノード1.5-2倍。Phase 3の静止探索と合わせると累積2-3倍になる可能性。
>
> **レビュー指摘（SOLID）**: `extended` 引数追加ではなく `SearchContext` に `extensionUsed` フラグを追加すべき。
>
> Phase 3の静止探索が正しく機能すればPhase 4の探索延長は不要な可能性が高い。Phase 3の効果測定後に実施判断する。実施する場合は以下を修正:
>
> - 閾値を 3000→5000 に引き上げ
> - 延長ノード数のbudget上限を設ける
> - `extended` 引数ではなく `SearchContext.extensionUsed` で制御

## テスト戦略

1. **ユニットテスト**:
   - Phase 1: FORBIDDEN_TRAP_STRONG変更の影響テスト
   - Phase 2: Aspiration Window動的調整のテスト
   - Phase 3: 静止探索のテスト（四がある/ない場合、MAX_Q_DEPTH制限）

2. **パフォーマンステスト**:
   - Phase 3: 1手あたりの探索時間が +30%以内であること

3. **ベンチマーク**: 各Phase後に200局ベンチ

## 検証指標

> **レビュー指摘（イシュー）**: blunder 2.5/局は非現実的。615件のblunderの89%がd4の構造的限界に起因しており、静止探索だけでは到達不可能。2.7-2.8が現実的な目標。Phase 1の目標はblunder率ではなく再探索削減に限定すべき。

| 指標                        | 現在   | Phase 1目標 | Phase 2目標 | 最終目標 |
| --------------------------- | ------ | ----------- | ----------- | -------- |
| blunder/局                  | 3.08   | 2.9         | 2.9         | 2.7-2.8  |
| advantage-squandered/局     | 0.13   | 0.10        | 0.10        | 0.08     |
| Aspiration Window再探索回数 | 未計測 | -           | 20%削減     | 30%削減  |
| 1手あたり探索時間           | 基準   | +0%         | +10%以内    | +30%以内 |

## 主要ファイル

| ファイル                                     | 変更内容                              |
| -------------------------------------------- | ------------------------------------- |
| `src/logic/cpu/evaluation/patternScores.ts`  | FORBIDDEN_TRAP_STRONGスコア調整       |
| `src/logic/cpu/search/techniques.ts`         | Aspiration Window定数追加             |
| `src/logic/cpu/search/iterativeDeepening.ts` | 動的ウィンドウ適用                    |
| `src/logic/cpu/search/minimaxCore.ts`        | 静止探索導入（Phase 3、ゲート判断後） |
| テストファイル                               | 各Phase対応のテスト追加               |

## リスク

- **FORBIDDEN_TRAP_STRONGの弱体化**: 5000に下げることで白の禁手追い込み成功率が低下する可能性。ベンチマークで禁手追い込み率が10%以下に激減したら下げすぎ
- **計算コスト増加**: 静止探索の導入で最悪ケースで探索時間が1.5倍。Phase 3のベンチで許容範囲を確認
- **禁手回避プランとの相互作用**: FORBIDDEN_TRAP_STRONGの調整は禁手回避プランのパラメータ調整と相互に影響する。両方同時に実施する場合は個別のベンチマークで効果を切り分ける
