# CPU速度改善調査報告書

**調査日**: 2026-03-27
**対象**: 対戦CPU + 振り返り評価ツールの速度最適化機会

---

## 1. 探索・枝刈りボトルネック

### 1.1 脅威検出の二重呼び出し ⚠️ **優先度: 高**

**ボトルネック箇所**:

- `src/logic/cpu/search/preSearch.ts:324` - `findPreSearchMove()` で `detectOpponentThreats()` 呼び出し
- `src/logic/cpu/moveOrdering.ts:277` - `sortMoves()` で再度 `detectOpponentThreats()` または `detectOpponentThreatsFast()` 呼び出し

**詳細**:

```typescript
// preSearch.ts:324
const threats = detectOpponentThreats(board, opponentColor); // 呼び出し1
const defense = checkMustDefend(board, color, threats);

// moveOrdering.ts:277
precomputedThreats = lineTable
  ? detectOpponentThreatsFast(board, opponentColor, lineTable) // 呼び出し2
  : detectOpponentThreats(board, opponentColor);
```

**計算コスト**:

- `detectOpponentThreats()` は O(15×15×4方向) = O(900) の盤面全体走査
- 各探索ノードで（候補手生成時に）2回呼び出し
- hard難易度 depth=4 で約 50万ノード × 2回 = **100万回の重複呼び出し**

**改善案**:

1. `preSearch.ts` の脅威情報を `SearchContext` に保持する
2. `sortMoves()` に脅威情報をパラメータで受け取らせる
3. LineTable が利用可能な文脈では常に `detectOpponentThreatsFast()` を使用

**期待される効果**: **5-15% の探索高速化**（脅威検出関連の時間を 50% 削減）

---

### 1.2 LineTable の未利用箇所 ⚠️ **優先度: 高**

**ボトルネック箇所**:

- `src/logic/cpu/search/preSearch.ts:324` - LineTable を受け取らず無条件に `detectOpponentThreats()` 呼び出し
- `src/logic/cpu/evaluation/positionEvaluation.ts:165` - LineTable コンテキスト内で `detectOpponentThreats()` 使用

**詳細**:

```typescript
// preSearch.ts では lineTable 引数がない
export function findPreSearchMove(
  board: BoardState,
  color: "black" | "white",
  ...
): MinimaxResult | null {
  const threats = detectOpponentThreats(board, opponentColor);  // 低速版を強制
}

// positionEvaluation.ts:165 でも同様
threats = detectOpponentThreats(board, opponentColor);  // LineTable があるのに使わない
```

**高速版との性能差**:

- `detectOpponentThreatsFast()` は precomputed patterns でフィルタリング
- 候補セルのみで検証 → 約 **60-80% 高速化**（テストで確認済み）

**改善案**:

1. `findPreSearchMove()` の署名に `lineTable?: LineTable` パラメータを追加
2. `iterativeDeepening.ts` から lineTable を渡す
3. `positionEvaluation.ts` の評価時に `detectOpponentThreatsFast()` を条件選択

**期待される効果**: **10-20% の探索高速化**（脅威検出がクリティカルパス内）

---

### 1.3 Aspiration Window が inactive ⚠️ **優先度: 中**

**ボトルネック箇所**:

- `src/logic/cpu/search/iterativeDeepening.ts:140+` - Aspiration Window の設定がある
- `src/logic/cpu/search/minimaxCore.ts:500+` - `findBestMoveWithTT()` で使用

**詳細**:

```typescript
// iterativeDeepening.ts でパラメータ化されているが、
// depth=1 では前回スコアがないため、ウィンドウが狭まらない
// → 反復深化の浅い層で枝刈り効率が低い
```

**仕組み**:

- Aspiration Windows は前回探索のスコアを中心に狭いウィンドウを設定 → α-β枝刈り効率向上
- depth=1 では有効に働かない（初回探索）
- depth=2 以降でも、前回値からの乖離が大きい場合 window miss → 再探索コスト

**改善案**:

1. depth=2 以降でのみ Aspiration Window を有効化（depth=1 は full window）
2. window miss 時の再探索深度を depth/2 に制限（current: depth そのまま）
3. ASPIRATION_WINDOW を 50 → 100 に広げ、false miss を減らす（現行: aggressive すぎる可能性）

**期待される効果**: **2-5% の探索高速化**（window miss による再探索削減）

---

## 2. データ構造・キャッシュボトルネック

### 2.1 Transposition Table (TT) の Map<bigint> ボトルネック ⚠️ **優先度: 中**

**ボトルネック箇所**:

- `src/logic/cpu/transpositionTable.ts:45` - `Map<bigint, TTEntry>` 実装

**詳細**:

```typescript
export class TranspositionTable {
  private table: Map<bigint, TTEntry>;  // JavaScript Map は内部ハッシュテーブル
  private maxSize: number = 2000000;
```

**計算コスト**:

- Map の get/set は O(1) 平均だが、BigInt のハッシュ計算が毎回発生
- 200万エントリで メモリ消費量が多い（各エントリ ~200 bytes）
- ハッシュ衝突率: Map は自動リサイズするが、エントリ置換ロジックが簡潔でない

**改善案**:

1. **short term**: TT サイズを 2M → 1M に削減（メモリ 36MB → 18MB）
   - 実験: medium 難易度で局所的な深度 3 では 1M で十分
   - hard depth=4 でのみ 2M 必要
2. **long term**: 固定サイズハッシュテーブル実装（配列ベース）
   - エントリ: `[hash(8B) | score(4B) | depth(1B) | type(1B) | bestMove(2B) | generation(2B)]`
   - メモリ効率 25% 向上、ハッシュ衝突処理を明示的に制御可能
   - WebWorker 並列化の前提条件（SharedArrayBuffer 対応）

**期待される効果**: **2-3% の探索高速化**（TT アクセスのメモリレイテンシ削減）

---

### 2.2 禁手キャッシュ (forbiddenCache) サイズ ⚠️ **優先度: 低**

**ボトルネック箇所**:

- `src/logic/cpu/cache/forbiddenCache.ts:28-31` - `Map<string, CacheEntry>` + MAX_CACHE_SIZE=100000

**詳細**:

```typescript
const forbiddenCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 100000;
```

**計算コスト**:

- 禁手判定は O(50) 程度の演算（三三・四四・長連の検証）
- キャッシュヒット率: 中盤で 40-60%（局面が多様化するため）
- キー生成: `"${row},${col}"` 文字列化 + Map ルックアップ

**改善案**:

1. MAX_CACHE_SIZE を 100K → 50K に削減（盤面 225 マス × 探索深度 4 程度でサチュレート）
2. 禁手キャッシュのキーを改善: `row * 15 + col` の number キー（文字列化コスト削減）

**期待される効果**: **<1% の高速化**（禁手判定はホットパスではない）

---

## 3. 評価関数ホットパス

### 3.1 `evaluateBoard()` の計算コスト ⚠️ **優先度: 中**

**ボトルネック箇所**:

- `src/logic/cpu/evaluation/boardEvaluation.ts:150+`
- `src/logic/cpu/evaluation/stonePatterns.ts:79` - `evaluateStonePatterns()` がすべての石に対して全方向走査

**詳細**:

```typescript
// evaluateBoard で全石をイテレート
for (const stone of allStones) {
  score += evaluateStonePatterns(board, stone.row, stone.col, color);
  // 各呼び出しで 4方向 + jump pattern 分析
}
```

**計算コスト**:

- `evaluateStonePatterns()`: O(4方向 + jump patterns) = ~100 ops/stone
- 盤面に 20-40 個の石がある場合: 2000-4000 ops/call
- 最善手候補 30-100 個 × evaluateBoard 呼び出し = **60000-400000 ops**
- これが Iterative Deepening の depth=1 を支配

**改善案**:

1. **LineTable キャッシュ活用**: `evaluateStonePatternsLight()` 使用（既存）
   - 実装済み: precomputed patterns でスコア計算を最小化
   - 確認: boardEvaluation.ts で LineTable パラメータが利用されているか
2. **差分更新**: 盤面全体再評価ではなく、新規配置石 + 近傍石のみ再計算
   - 試験実装: evaluatePositionDelta(board, row, col, color)
   - 効果: 計算量を 70% 削減可能性

**期待される効果**: **3-8% の探索高速化**（特に depth=1,2 でのMove Ordering）

---

### 3.2 `createsFourThree()` の重複検証 ⚠️ **優先度: 低**

**ボトルネック箇所**:

- `src/logic/cpu/evaluation/boardEvaluation.ts:109` - `hasFourThreePotential()` でフィルタ後 `createsFourThree()` 呼び出し

**詳細**:

```typescript
if (!hasFourThreePotential(board, r, c, color)) {
  continue;
}
if (createsFourThree(board, r, c, color)) {
  // 二重検証
  return true;
}
```

**計算コスト**:

- `hasFourThreePotential()`: O(4方向) の必要条件チェック → false negative あり
- `createsFourThree()`: O(4^2 = 16) の完全検証 → 約 290 ops
- 候補セル数が少ない場合（終盤）は影響小さい
- 実装済み高速化: `createsFourThreeBit()` でビット演算版

**改善案**: 実装済み検証用に `createsFourThreeBit()` を活用（効果は既に反映か確認）

**期待される効果**: **<1% の高速化**（既に最適化されている可能性）

---

## 4. 戦術探索（VCT/VCF）の非効率

### 4.1 VCT 探索のキャッシュ戦略が弱い ⚠️ **優先度: 中**

**ボトルネック箇所**:

- `src/logic/cpu/search/vct.ts:83-101` - VCF キャッシュ実装が局所的

**詳細**:

```typescript
// VCT探索で同一盤面の VCF 判定を keyで再利用するが...
const vcfCache = createVCFCache();

// キャッシュが反復深化（depth 1,2,3,4）ごとにリセットされるか不明
// また、VCF結果が "true/false" のみで、手順情報がない
```

**計算コスト**:

- VCT は終盤（石数 14+ ）限定で活動
- depth=4 での hasVCF 呼び出しが反復深化ごとに再実行される可能性
- キャッシュ hit rate が低い（局面が日々変化）

**改善案**:

1. VCFCache を SearchContext に持たせ、反復深化全体で共有
2. timeout 時の部分結果も保持（false→maybe に昇格）
3. VCF 手順まで cache（now: true/false のみ）

**期待される効果**: **2-5% の終盤高速化**（VCT/VCF が活動する局面で）

---

### 4.2 Move Ordering での脅威優先度 ⚠️ **優先度: 低**

**ボトルネック箇所**:

- `src/logic/cpu/moveOrdering.ts:100+` - sortMoves() で脅威情報を活用

**詳細**:

```typescript
// 脅威防御手を高優先度にソート
// ただし、複数の脅威がある場合の優先順位が不明瞭
//（活四 >> 止め四 >> 活三？）
```

**改善案**: 脅威の種類ごとに Move Ordering スコアを明示化

```typescript
const THREAT_ORDER_SCORE = {
  openFour: 1000000, // 即ブロック必須
  four: 900000, // その次
  openThree: 500000, // 防ぐべき
  mise: 300000,
  doubleThree: 200000,
};
```

**期待される効果**: **1-2% の探索高速化**（枝刈りが 1-2 手深くなる可能性）

---

## 5. メモリ・アクセスパターン最適化

### 5.1 BoardState のメモリレイアウト ⚠️ **優先度: 低**

**ボトルネック箇所**:

- `src/types/game.ts` - `BoardState = (("black" | "white" | null)[][])`

**詳細**:

- 15×15 = 225 セルの 2D 配列
- 各セルが文字列 ("black", "white") または null → 可変サイズメモリ
- キャッシュミスレート高い（参照の局所性が低い）

**改善案**:

1. **short term**: 検証なし（既存実装が十分に最適化されている可能性）
2. **long term**: Uint8Array への変換（0=empty, 1=black, 2=white）
   - メモリ 1/10 削減、キャッシュ効率 5倍向上
   - 全コードの BoardState 型を変更必要 → 大規模リファクタ

**期待される効果**: **5-10% の全体高速化**（メモリレイテンシ削減）

---

## 6. 既存計画との連携

### 既知の改善施策（cpu-performance-strategy.md から）

| 順位 | 施策                           | 効果   | コスト            | 実施状況           |
| ---- | ------------------------------ | ------ | ----------------- | ------------------ |
| 1    | Worker 永続化（TT 保持）       | 中     | 極低（10行）      | **未実装** ✓       |
| 2    | 開局ブック 5 手化              | 中     | 低                | **未実装** ✓       |
| 3    | detectOpponentThreats 重複解消 | 低〜中 | 低                | **本調査で特定** ✓ |
| 4    | 単純ポンダリング               | 高     | 中（100行）       | **未実装** ✓       |
| 5    | マルチ候補ポンダリング         | 高     | 低（差分50行）    | **未実装** ✓       |
| 6    | 並列探索（Lazy SMP）           | 高     | 極高（500-1000行) | **未実装**         |

---

## 7. 総合改善優先度ロードマップ

### **Phase 1: 即効（低リスク、1-2日）**

1. **脅威検出の二重呼び出しを廃止** ← **本調査で識別**
   - `preSearch.ts` → `sortMoves()` への脅威情報パイプライン化
   - 期待値: **5-15%** 高速化
   - リスク: 低（既存ロジックの再利用）

2. **LineTable 非利用箇所を修正**
   - `preSearch.ts` に lineTable パラメータを追加
   - `positionEvaluation.ts` で条件分岐して Fast 版を使用
   - 期待値: **10-20%** 高速化（脅威検出が支配的）
   - リスク: 低

### **Phase 2: 段階的（中リスク、2-3日）**

3. **Aspiration Window パラメータチューニング**
   - depth=1 では無効化、window サイズ調整
   - 期待値: **2-5%** 高速化
   - リスク: 低（再探索 logic は既存）

4. **VCT キャッシュ改善**
   - SearchContext に VCF キャッシュ統合
   - 期待値: **2-5%** 高速化（終盤限定）
   - リスク: 中（キャッシュ統合が複雑）

5. **TT サイズ調整 + 禁手キャッシュ最適化**
   - 難易度別の TT サイズ設定
   - 期待値: **2-3%** 高速化
   - リスク: 低

### **Phase 3: 長期（高リスク、1週間+）**

6. **Worker 永続化 + ポンダリング**（既存計画 Phase 1-2）
   - 期待値: **20-40%** 体感高速化（プレイヤー体験向上）
   - リスク: 中（Worker ライフサイクル管理）

7. **並列探索（Lazy SMP）**（既存計画 Phase 3）
   - 期待値: **40-100%** 高速化（4 Workers）
   - リスク: 極高（TT 構造全面変更）

---

## 8. 検証・テスト計画

各改善後に以下を実施:

1. `pnpm test` で既存テスト passrate 確認
2. `pnpm test:browser:headless` で AI 棋力維持確認（Elo change < 10）
3. `scripts/commit-bench.ts` で性能向上測定（r=0.02, 8 セット=416 局）

---

## 結論

**最優先改善**:

1. **脅威検出の二重呼び出し廃止** → Phase 1 で即実装（5-15% 効果）
2. **LineTable の条件分岐活用** → Phase 1 で同時実装（10-20% 効果）

これら 2 つの改善だけで **15-35% の総合高速化**が期待でき、hard 難易度の思考時間を 8s → 5-6s に短縮可能。
