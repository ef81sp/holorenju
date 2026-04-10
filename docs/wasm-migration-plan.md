# WASM移植計画

> **ステータス: 完了** (2026-04)
> Zig/WASMへの移行は完了済み。現行の実装詳細は `wasm-execution-flow.md` を参照。
> 本ドキュメントは移行の意思決定記録として残す。

## 背景

TSレベルのチューニング（LMR対数テーブル、NMP条件強化等）では大きな棋力向上が見込めないことが判明。根本的な高速化のため、探索コアを Rust/Zig + WASM に移植する。

## 現状分析

### 既にBitboard化済みの部分

LineTable（`src/logic/cpu/lineTable/`）で方向別Bitboard が実装済み：

- 72本のライン（横15+縦15+斜め42）を `Uint16Array` で管理
- 四候補検出: O(5625) → O(770)（7.3倍）
- パターン走査: O(9000) → O(720)（12.5倍）
- 差分更新: O(4) で石の置き取り

### WASM化で得られる主な恩恵

| ボトルネック                 | 現状                                    | WASM化後                            |
| ---------------------------- | --------------------------------------- | ----------------------------------- |
| Zobrist ハッシュ             | BigInt XOR（遅い）                      | u64 XOR（ネイティブ速度）           |
| BoardState                   | `string[][]`（1800B、キャッシュ非効率） | `u8[225]`（225B、キャッシュ効率的） |
| GC                           | 探索中にGCが走る可能性                  | GCなし                              |
| 評価関数（41%）              | JS関数呼び出しオーバーヘッド            | インライン化可能                    |
| detectOpponentThreats（35%） | JS配列走査                              | ビット演算で高速化                  |

### 移植規模

- 移植対象: 約45-50ファイル、12,000-15,000行
- テスト: 1,100+件が再利用可能
- TSに残すもの: Worker管理（`useCpuPlayer.ts`）、UI連携、型定義

## アーキテクチャ

### ハイブリッド型（推奨）

```
Vue UI (TypeScript)
  ↓ postMessage(CpuRequest)
CPU Worker (TypeScript) ← 既存インターフェース維持
  ↓ Uint8Array(225)
WASM Module (Rust/Zig)
  - 盤面管理（リニアメモリ）
  - 探索アルゴリズム
  - 評価関数
  - VCT/VCF/Mise検出
```

- CpuRequest/CpuResponse インターフェースは変更なし
- 盤面は Uint8Array(225) で受け渡し（0=空, 1=黒, 2=白）
- 段階的に WASM 化可能

## 段階的移植計画

### Phase 1: 基礎層（1-2週）

**対象**: 盤面操作、線分析、Zobrist

- `core/boardUtils.ts` — applyMove, undoMove
- `lineTable/*` — 線テーブル操作
- `zobrist.ts` — BigInt → u64

**検証**: boardUtils.test.ts, lineTable/\*.test.ts でTS版と出力一致を確認
**期待効果**: 5-10%高速化

### Phase 2: 評価関数（2-3週）

**対象**: パターン認識、スコア計算、脅威検出

- `evaluation/boardEvaluation.ts` — 全体の41%
- `evaluation/positionEvaluation.ts`
- `evaluation/threatDetection.ts` — 全体の35%
- `evaluation/stonePatterns.ts`

**検証**: evaluation/\*.test.ts でスコア一致を確認
**期待効果**: +20-30%高速化

### Phase 3: 探索エンジン（3-4週）

**対象**: Minimax、TT、Move Ordering

- `search/minimaxCore.ts` — Alpha-Beta + NMP/LMR/Futility
- `search/iterativeDeepening.ts`
- `transpositionTable.ts` — Map<bigint> → WASM内ハッシュテーブル
- `moveOrdering.ts`

**検証**: minimax.test.ts, minimax.perf.test.ts で同一手選択を確認
**期待効果**: +40-60%高速化

### Phase 4: 特殊探索（2-3週）

**対象**: VCF/VCT、Quiescence

- `search/vcf.ts`, `search/vct.ts`
- `search/quiescence.ts`
- `search/miseVcf.ts`

**検証**: vct.test.ts, vcf.test.ts で追詰検出一致を確認
**期待効果**: +10-20%高速化

### Phase 5: Review Worker（1-2週）

**対象**: 振り返り評価の探索部分

**検証**: review.worker.test.ts
**期待効果**: +5-10%高速化

## テスト戦略

### パリティテスト（最重要）

各Phase完了時に、TS版とWASM版で同じ入力を与え、同じ出力が返ることを確認：

```typescript
// 例: evaluation のパリティテスト
const board = createBoardFromKifu("H8 G7 I9 ...");
const tsResult = evaluateBoard(board, "black"); // TS版
const wasmResult = wasm.evaluate_board(board, 1); // WASM版
expect(wasmResult.total).toBe(tsResult.total); // 一致
```

### 既存テストの再利用

テストデータ（盤面配置+期待結果）はJSON等で共有化し、TS版テストとWASM版テスト（Rust: `#[test]` / Zig: `test`）の両方で使用。

### ベンチマーク

各Phase完了時に `pnpm bench:ai --players=hard --sets=1` で速度比較。

## 言語選択（要検討）

|                      | Rust                                | Zig                   |
| -------------------- | ----------------------------------- | --------------------- |
| WASM成熟度           | **最高**（wasm-pack, wasm-bindgen） | 良好                  |
| 学習コスト           | 高（所有権システム）                | **低**（C系の親しみ） |
| WASMバイナリサイズ   | やや大きい                          | **小さい**            |
| ゲームAI実績         | 多い                                | 少ない                |
| テストフレームワーク | 充実                                | 標準的                |

## 依存関係グラフ

```
Phase 1 (基礎) ← 他の全Phaseが依存
  ↓
Phase 2 (評価) ← Phase 3, 4 が依存
  ↓
Phase 3 (探索) ← Phase 4, 5 が依存
  ↓
Phase 4 (特殊探索) ← Phase 5 が依存
  ↓
Phase 5 (Review)
```

## リスクと対策

| リスク                    | 対策                                             |
| ------------------------- | ------------------------------------------------ |
| 工期超過（2-3ヶ月見込み） | Phase 1 で効果測定し、続行判断                   |
| TS版との結果不一致        | パリティテストで各Phase検証                      |
| WASM↔JS通信オーバーヘッド | 盤面225Bは無視可能。頻繁な小さい呼び出しは避ける |
| デバッグ困難              | TS版を参照実装として維持。WASM版のログ出力を整備 |
