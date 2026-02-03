# CPU AI 改善計画: 防御と四伸び評価の修正

## 課題

### 1. 三を見逃す問題

**現象**: mediumでもプレイヤーの活三を見逃してしまう

**原因** (`evaluation.ts:978`):

```typescript
defenseScore = opponentPatternScore * 0.5;
```

- 防御スコアが相手のパターンスコアの**50%固定**
- 相手の活三(1000点)への防御 → 500点
- 自分の止め四(1000点) → 1000点
- **攻撃が防御の2倍の価値**になり、防御より攻撃を優先してしまう

### 2. 無駄な四伸び問題

**現象**: 四追いに繋がらない単発の四伸びを打ちがち

**原因**:

- 止め四: 1000点（活三と同じ）
- 四三同時ボーナス: +5000点
- しかし**後続の脅威がない単発の四**も同じ1000点

**連珠の原則**:

> 四は四追いやミセ手・フクミ手等のトドメか、どうしようもないときの防御に使うべきもの

単発の四伸びは相手に手番を渡すだけで、形勢を悪化させることが多い。

---

## 解決策

### 解決策A: 必須防御ルールの導入（主要解決策）

活三・活四への対応は**係数調整ではなく、必須ルール**として扱う。

**連珠の原則**:

- 相手の活四を放置 → 次手で五連、即負け
- 相手の活三を放置 → 次手で活四、その次で五連、負け確定

つまり活三・活四への防御は「優先度が高い」ではなく「**必須**」。

```typescript
function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  context: ThreatContext,
): number {
  const dominated = canDominateOpponent(board, row, col, color);
  // dominated = 活四や四三を作れる（自分が先に勝てる）

  // 相手の活四がある場合
  if (context.opponentOpenFours.length > 0) {
    if (dominated) {
      // 自分が先に勝てるなら防御不要
      return evaluateWinningMove(board, row, col, color);
    }
    if (!blocksAnyOpenFour(row, col, context.opponentOpenFours)) {
      return -Infinity; // 活四を止めない手は論外
    }
  }

  // 相手の活三がある場合
  if (context.opponentOpenThrees.length > 0) {
    if (dominated) {
      // 自分が先に勝てるなら防御不要
      return evaluateWinningMove(board, row, col, color);
    }
    if (!blocksAnyOpenThree(row, col, context.opponentOpenThrees)) {
      return -Infinity; // 活三を止めない手は論外
    }
  }

  // 通常の評価...
}
```

**例外（防御不要のケース）**:

1. 自分が活四を作れる（即勝ち）
2. 自分が四三を作れる（止められない勝ち）
3. 自分がVCF（四追い勝ち）を持っている

これら以外は、活三を止めない手は**候補から除外**される。

### 解決策B: 防御係数の調整（補助的）

必須防御以外の脅威（止め三など）への対応は係数で調整。

```typescript
function getDefenseMultiplier(threatLevel: ThreatLevel): number {
  switch (threatLevel) {
    case "openFour":
    case "openThree":
      return 1.0; // 必須防御ルールで処理するため係数は不要
    case "four":
      return 0.7; // 止め四への防御
    case "three":
      return 0.5; // 止め三への防御（現状維持）
    default:
      return 0.3;
  }
}
```

### 解決策C: 単発四伸びのスコア低下

四追いに繋がらない単発の四を低評価にする。

```typescript
// 現在: 四は一律1000点

// 改善案: 後続の脅威を確認
function evaluateFour(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): number {
  const baseScore = PATTERN_SCORES.FOUR; // 1000

  // 四三が作れる → 高評価（既存のFOUR_THREE_BONUSで対応済み）
  // ミセ手/フクミ手に繋がる → 高評価（既存ボーナスで対応済み）

  // 後続の脅威がない単発の四 → 低評価
  if (!hasFollowUpThreat(board, row, col, color)) {
    return baseScore * 0.3; // 300点に低下
  }

  return baseScore;
}

function hasFollowUpThreat(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): boolean {
  // 四を打った後の盤面で:
  // 1. 別の四が作れるか（四追い継続）
  // 2. 活三が作れるか（四三への発展）
  // 3. ミセ手になるか
  // いずれかがtrueなら後続脅威あり
}
```

**期待効果**:

- 無意味な四伸び: 1000点 → 300点
- 四追いの一部/ミセ手: 1000点（維持）
- 四三同時: 6000点（維持）

### 解決策D: 防御四の評価向上

「防御しながら四を作る」手の評価を上げる（カウンターフォーの拡張）。

```typescript
// 現在: hardのみ、係数1.5倍
if (options.enableCounterFour) {
  if (
    attackScore >= PATTERN_SCORES.FOUR &&
    opponentPatternScore >= PATTERN_SCORES.OPEN_THREE
  ) {
    defenseScore *= 1.5;
  }
}

// 改善案: mediumでも有効化、より高い評価
// さらに「防御四」専用のボーナスを追加
if (blocksOpponentThreat && createsFour) {
  score += PATTERN_SCORES.DEFENSE_FOUR_BONUS; // +800
}
```

---

## 実装計画

### Phase 1: 必須防御ルールの実装（解決策A）

**ファイル**: `src/logic/cpu/evaluation.ts`, `src/logic/cpu/moveGenerator.ts`

**変更内容**:

1. `ThreatContext` 型を追加（相手の活三・活四の位置リスト）
2. 探索開始前に `detectOpponentThreats()` で脅威を検出
3. `evaluatePosition()` に必須防御ロジックを追加
4. 活三/活四を止めない手は `-Infinity` を返す（候補から除外）
5. 例外処理: 自分が活四/四三/VCFを持つ場合は防御不要

**影響範囲**: 全難易度（easy以上で有効化を推奨）

**テスト方法**:

- 相手が活三を持つ局面で、必ず防御手が選ばれるか確認
- 自分が四三を作れる場合は防御せず攻めるか確認
- ベンチマーク実行で勝率変化を確認

### Phase 2: 単発四伸びの低評価化（解決策C）

**ファイル**: `src/logic/cpu/evaluation.ts`

**変更内容**:

1. `hasFollowUpThreat()` 関数を追加
2. 四のスコア計算時に後続脅威を確認

**実装の注意点**:

- 計算コストが増えるため、簡易チェックに留める
- 四を打った後に「もう1つ四が作れるか」を1手先読み

### Phase 3: 難易度別の必須防御有効化

**ファイル**: `src/logic/cpu/evaluation.ts`

**変更内容**:

1. `EvaluationOptions` に `enableMandatoryDefense` フラグを追加
2. 難易度ごとに有効/無効を設定

**難易度別の有効化**:
| 機能 | beginner | easy | medium | hard |
|-----|----------|------|--------|------|
| 必須防御ルール | ❌ | ✅ | ✅ | ✅ |
| 単発四低評価 | ❌ | ❌ | ✅ | ✅ |

**beginnerで無効にする理由**:

- 初心者向けは「わざと弱く」する必要がある
- 活三を見逃すことがある方が初心者には勝ちやすい

### Phase 4: テストとチューニング

1. **ユニットテスト追加**
   - 活三がある局面で防御手が選ばれるか
   - 単発四伸びより防御が優先されるか

2. **ベンチマーク比較**
   - 修正前後でmedium vs medium の勝率変化
   - 修正前後でプレイヤー(hard相当)vs medium の感触

3. **スコア微調整**
   - 防御係数: 0.8が強すぎれば0.7に
   - 単発四係数: 0.3が弱すぎれば0.5に

---

## スコア設計案（まとめ）

### 現在のスコア

| パターン | スコア       |
| -------- | ------------ |
| 活四     | 10,000       |
| 止め四   | 1,000        |
| 活三     | 1,000        |
| 止め三   | 100          |
| 防御係数 | ×0.5（一律） |

### 改善後のスコア

| パターン           | スコア |
| ------------------ | ------ |
| 活四               | 10,000 |
| 止め四（後続あり） | 1,000  |
| 止め四（単発）     | 300    |
| 活三               | 1,000  |
| 止め三             | 100    |
| 防御係数（止め四） | ×0.7   |
| 防御係数（止め三） | ×0.5   |

**必須防御ルール**:
| 相手の脅威 | 自分の状況 | 結果 |
|-----------|-----------|------|
| 活四あり | 活四/四三なし | 止めない手は `-Infinity`（除外）|
| 活三あり | 活四/四三/VCFなし | 止めない手は `-Infinity`（除外）|
| 活三あり | 活四/四三あり | 防御不要（先に勝てる）|

### 評価例

**局面1**: 相手が活三を持ち、自分は単発の四が打てる

| 手                           | 現在 | 改善後              |
| ---------------------------- | ---- | ------------------- |
| 単発四伸び（活三を止めない） | 1000 | `-Infinity`（除外） |
| 活三を止める                 | 500  | 有効な候補          |
| 活三を止めつつ三を作る       | 600  | 有効な候補（最善）  |

→ 改善後は単発四伸びが候補から除外され、必ず防御手が選ばれる

**局面2**: 相手が活三を持ち、自分は四三が作れる

| 手           | 現在 | 改善後                         |
| ------------ | ---- | ------------------------------ |
| 四三を作る   | 6000 | 6000（先に勝てるので防御不要） |
| 活三を止める | 500  | 有効だが四三より低い           |

→ 自分が先に勝てる場合は攻める

---

---

## 追加課題: 探索の実行環境対応

### 課題3: 時間ベース打ち切りの問題

**現状** (`minimax.ts`):

```typescript
const elapsed = performance.now() - startTime;
if (elapsed > timeLimit) {
  // 打ち切り
}
```

**問題点**:

- ユーザー端末の計算能力は一律ではない
- 遅いデバイス: 深度3で時間切れ → 弱い手を返す
- 速いデバイス: 深度5を余裕で完了 → 無駄に待つ

**解決策: ノード数ベースの打ち切り**

```typescript
interface SearchLimits {
  maxDepth: number;      // 最大探索深度（必須）
  maxNodes?: number;     // 最大ノード数（オプション）
  timeLimit?: number;    // 時間制限（保険、オプション）
}

// 探索コンテキストにノードカウンタを追加
interface SearchContext {
  nodeCount: number;
  maxNodes: number;
}

function alphaBeta(ctx: SearchContext, ...): number {
  ctx.nodeCount++;

  if (ctx.nodeCount >= ctx.maxNodes) {
    throw new SearchAbortedError("node limit");
  }
  // ...
}
```

**難易度別のノード数上限案**:

| 難易度   | maxDepth | maxNodes | 期待動作   |
| -------- | -------- | -------- | ---------- |
| beginner | 2        | 10,000   | 即座に返す |
| easy     | 3        | 50,000   | 0.5秒程度  |
| medium   | 5        | 200,000  | 1-2秒程度  |
| hard     | 5        | 500,000  | 2-5秒程度  |

**メリット**:

- 遅いデバイスでも同じ強さ（同じノード数を探索）
- 速いデバイスでは早く終わる
- 再現性が高い（デバッグしやすい）

**Iterative Deepeningとの組み合わせ**:

- 各深度を完了するまで探索
- ノード上限に達したら、完了した最深の深度の結果を返す
- 時間制限は「万一の保険」として残す（10秒等の長め）

### 課題4: マルチスレッド化

**現状**: Web Worker 1つでシングルスレッド探索

**マルチスレッド化の方法**:

1. **ルート並列化（シンプル）**
   - ルートの候補手を複数Workerに分配
   - 各Workerが独立に探索、最良の結果を採用

2. **Lazy SMP（高度）**
   - 複数Workerが同じ探索木を探索
   - Transposition Tableを共有（SharedArrayBuffer）
   - 異なる深度・順序で探索し、協調的に枝刈り

**課題**:

- SharedArrayBufferはセキュリティ制限あり（COOP/COEP必須）
- Worker間通信のオーバーヘッド
- 探索木の非均一性により効率低下
- 実装・デバッグの複雑さ

**結論**: 現状の深度5程度では**優先度は低い**。ノード数ベース打ち切りの方が効果的。

将来的にhard++等の難易度を追加する場合は検討価値あり。

---

## 参考: 連珠の格言

- 「四は最後の切り札」
- 「三を止めずに四を打つな」
- 「無駄な四伸びは悪手」
- 「止めながら攻めろ」

これらの格言を評価関数に反映させることで、より人間らしい思考に近づく。
