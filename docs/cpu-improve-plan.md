# CPU改善プラン（レビュー反映版）

## Context

対戦CPU/振り返りツールの「精度向上」と「速度向上」を目的に、2名のサブエージェントで調査を実施。3名のレビュワー（SOLID/パフォーマンス/イシュー）のフィードバックを反映。

**イシューレビュー指摘**: 元の目的は「精度+速度」だが、旧プランは低優先度の速度改善を先行させており目的と矛盾。精度（末端評価ギャップ=ブランダー60%の原因）を最優先に修正。

## 調査レポート

- [精度改善調査（11件）](precision-improvement-survey.md)
- [速度改善調査（7件）](cpu-speed-improvement-survey.md)

## 改善ロードマップ

### Phase 1: 末端評価ギャップ対策（最高優先度・精度）

**目的**: ブランダーの60%（~1685件/2800件）を占める3000-5000スコア差の原因を解消

**問題の本質**: `evaluateBoard()`（末端評価）は盤上の既存パターンしか見ず、「次の1手で四三が作れる（ミセ手）」を認識しない。一方 `evaluatePosition()`（手オーダリング）はミセ手に+5000を加算しており、両者に5000のギャップがある。

**過去の失敗**: LEAF_COMPOUND_THREAT_BONUS（「同一石が四+活三を持つ場合にボーナス」）は、既に勝ち確定の局面をさらに高評価するだけで3000-5000範囲に効果ゼロだった（[leaf-eval-gap-analysis.md](leaf-eval-gap-analysis.md)）。

**今回のアプローチ**: 「既に四三成立」ではなく「次手で四三になれる空き点」を検出する。`positionEvaluation.ts` の `isMiseMove()` ロジックを参考に末端版を実装。

**実装方針**（SOLIDレビュー反映）:

- `evaluateBoard()` に直接追加せず、独立した関数 `detectMiseOpportunityAtLeaf()` を実装
- `boardEvaluation.ts` から呼び出し、スコアに加算
- disableフラグ付きで実装し、失敗時に即座に無効化可能にする

**対象ファイル**:

- `src/logic/cpu/evaluation/boardEvaluation.ts` — 呼び出し元
- `src/logic/cpu/evaluation/patternScores.ts` — 新定数 LEAF_MISE_THREAT
- 参考: `src/logic/cpu/evaluation/miseTactics.ts` の `isMiseMove()`

**検証**:

- `commit-bench.ts` でベンチマーク（r=0.02, 8セット=416局）
- 効果なし/悪化時は disableフラグで即rollback
- ブランダー3000-5000範囲の削減率を定量化

### Phase 2: NMP安全条件の強化（高優先度・精度）

**目的**: 相手の活三をNMPで見逃す問題を解消

**現状**: `minimaxCore.ts` の `hasImmediateThreat()` は相手の「四」のみチェック。活三（次手で四になる可能性）を見ていない。

**改善**: hasImmediateThreat() に活三チェックを追加。活三がある場合もNMPをスキップ。

**対象ファイル**:

- `src/logic/cpu/search/minimaxCore.ts` — hasImmediateThreat()
- `src/logic/cpu/search/techniques.ts` — NMPパラメータ

**検証**: ベンチマーク必須（+20-50 Elo期待）

### Phase 3: 速度基盤改善（低リスク・速度）

**目的**: 品質を変えずに探索効率を15-35%向上

**3a. detectOpponentThreats重複解消**

- `preSearch.ts` → `sortMoves()` で同じ脅威検出が2回実行されている
- SearchContext に `cachedOpponentThreats` を追加し、1回目の結果を再利用
- 対象: `iterativeDeepening.ts`, `preSearch.ts`, `moveOrdering.ts`, `context.ts`

**3b. LineTable活用拡大**

- `preSearch.ts` が lineTable を受け取らず、常に遅い `detectOpponentThreats()` を使用
- `detectOpponentThreatsFast()` は60-80%高速（既に実装済み）
- preSearch の署名に `lineTable?: LineTable` を追加

**既存計画**: [phase3-threat-cache.md](cpu-flow-review-plan/phase3-threat-cache.md) に詳細あり

**検証**: ベンチで棋力同等（Elo差 < 20）を確認

## 今回の着手範囲

Phase 1-3 を実装対象とする。

## Phase 4以降（別タスク）

| Phase | 内容                                 | 優先度             |
| ----- | ------------------------------------ | ------------------ |
| 4     | Aspiration Windowチューニング        | 中                 |
| 5     | 水平線効果対策（Quiescence深度拡張） | 高（設計検討必要） |
| 6     | VCTカウンター脅威 F-2/F-3            | 中                 |
| 7     | Worker永続化+ポンダリング            | 長期               |
| 8     | 並列探索 Lazy SMP                    | 長期               |

## 検証方法

- 各Phase後に `pnpm check-fix`
- Phase 1: ベンチマーク（r=0.02, 8セット）— ブランダー3000-5000範囲の削減率を測定
- Phase 2: ベンチマーク — Elo変化を測定
- Phase 3: ベンチマーク — 速度変化を測定、棋力同等を確認
- **失敗時対応**: 各Phaseの変更はdisable可能に設計。効果なし/悪化時はrollbackし、次Phaseに進む
