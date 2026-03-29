# CPU改善プラン

## v1 の結果と教訓（2026-03-27）

### 実施した改善

| Phase | 内容                                       | 結果                                                  |
| ----- | ------------------------------------------ | ----------------------------------------------------- |
| 1     | 末端ミセ手推定（estimateMiseOpportunity）  | Elo +15 [-18.3, +48.7]（有意差なし）                  |
| 2     | NMP活三チェック（hasOpenThreeInDirection） | **Elo -81.6 [48.1, 116.8]（棋力低下）→ 切り戻し済み** |
| 3     | 脅威検出パイプライン化 + LineTable活用     | 悪影響なし（個別未測定）                              |

### 教訓

1. **探索深度 > 評価精度**: depth 1 の差 = 20-50 Elo。末端評価の改善（+500スコア）より、同じ時間でより深く読めることの方が棋力に直結
2. **「理論的に正しい」≠「実装で有効」**: NMP活三チェックは理論通りだが、連珠では活三が常時存在するためNMPがほぼ全面無効化 → depth 6到達率 -15.8pt
3. **実装前に頻度を測定すべき**: 改善対象のパターンが実際にどの程度発生するか、事前に計測する
4. **末端評価ギャップは「原因」ではなく「相関」**: ブランダー3000-5000スコア差と末端評価ギャップに相関はあるが、末端評価を改善してもブランダーは減らなかった

### 現在の状態（commit `11ff7a1`）

- Phase 1（末端ミセ推定）: 維持（悪影響なし、disable可能）
- Phase 2（NMP活三チェック）: 切り戻し済み
- Phase 3（脅威検出パイプライン）: 維持（悪影響なし）

## v2: 探索効率改善

教訓に基づき、**計測 → 仮説 → 実装** の順序を厳守する。

### Phase 0: プロファイリング（完了）

10局 hard vs hard で計測。条件: commit `11ff7a1`

#### コスト分布（単一局面 depth 6 タイミング）

| コンポーネント      | 割合     | 詳細                                                      |
| ------------------- | -------- | --------------------------------------------------------- |
| generateSortedMoves | **53%**  | 内訳: detectOpponentThreats 35% + evaluatePosition 15%    |
| evaluateBoard       | **41%**  | QSearchのstand-patで大量呼び出し（74μs/回、108万回/game） |
| miseBonus           | **9.4%** | evaluatePosition内で最重（38μs/回）                       |
| threatProbe         | 4.3%     | VCFチェック（315μs/回だが呼び出し少）                     |

#### 枝刈り統計（10局平均）

| 指標              | 値            | 意味                                           |
| ----------------- | ------------- | ---------------------------------------------- |
| NMP試行           | 5,314/game    | hasImmediateThreat: 1-10μs/回 → **高速化不要** |
| NMPカットオフ率   | 61.2%         | NMP自体は有効に動作                            |
| LMR発動率         | 2.7%          | 全ノード中わずか                               |
| LMR re-search率   | **4.7%**      | 非常に低い → **削減量を増やす余地大**          |
| LMR moveIndex分布 | 5+: **96.3%** | ほぼ全てが後方候補手                           |
| QSearchノード比率 | **48.2%**     | 全ノードの半分                                 |
| QSearch平均分岐   | 1.85手        | 小さい                                         |
| Futility Prune    | 117,558/game  | 活発に動作                                     |

### Phase 1: LMR対数テーブル導入

**根拠**: re-search率4.7%（余地大）、moveIndex 5+が96%（後方手で積極削減可能）

**仮説**: 固定 `LMR_REDUCTION=1` を対数テーブルに変更すれば、同じ時間でdepth +1 が可能。depth +1 = Elo +20-50。

**前提条件**: re-search率が30%以下を維持すること

**実装**:

- `techniques.ts` に `getLMRReduction(depth, moveIndex)` テーブル関数を追加
- `minimaxCore.ts` L668-670 でテーブル値を使用
- 活三・四の手は既にLMR除外されているので安全

**検証**:

1. re-search率の変化を計測（30%以下を確認）
2. SPRTベンチで棋力向上を確認

**対象ファイル**: `techniques.ts`, `minimaxCore.ts`

### Phase 2: detectOpponentThreats のLineTable高速化

**根拠**: 全体の35%を占める最大ボトルネック（226μs/回）

**仮説**: LineTable版（`detectOpponentThreatsFast`）は60-80%高速。深いノードでも使えばgenerateSortedMoves全体を20-30%高速化。

**前提条件**: LineTable版が通常版と同じ結果を返すこと（既にprecomputedEquivalence.test.tsで検証済み）

**実装**:

- `moveOrdering.ts` の `sortMoves` で、LineTableがある場合は常にFast版を使用
- 現状は `precomputedThreats` がない場合のみFast版を使う条件分岐 → 常にFast版に統一

**検証**: SPRTベンチで棋力同等を確認

**対象ファイル**: `moveOrdering.ts`

### Phase 3: miseBonus軽量化

**根拠**: evaluatePosition内で9.4%（38μs/回）。深いノードでは不要な可能性。

**仮説**: depth≤2（浅いノード）でのみmiseBonusを計算すれば、深いノードの評価が高速化。

**検証**: SPRTベンチで棋力同等を確認

**対象ファイル**: `positionEvaluation.ts`, `minimaxCore.ts`

### 棄却した施策と理由

| 施策                     | 棄却理由                                                             |
| ------------------------ | -------------------------------------------------------------------- |
| hasImmediateThreat高速化 | 計測で1-10μs/回と判明。コスト無視可能                                |
| QSearch活三追加          | QSearch分岐1.85手 → 活三追加で分岐爆発リスク。v1教訓（活三常時存在） |
| evaluateBoard差分評価    | 効果大だが実装コスト極高（1週間級）。Phase 1-2 を先に                |

### ベンチマーク方針

- `--sprt` で早期停止を活用
- 改善ごとに個別ベンチ（複数Phase同時は原因切り分け困難）
- 各Phase実装後に re-search率等のカウンターを確認

## 関連ドキュメント

- [精度改善調査（11件）](precision-improvement-survey.md)
- [速度改善調査（7件）](cpu-speed-improvement-survey.md)
- [末端評価ギャップ分析](leaf-eval-gap-analysis.md)
- [処理フロー見直し計画](cpu-flow-review-plan.md)
- [性能向上戦略](cpu-performance-strategy.md)
- [ベンチ分析レポート](bench-reports/bench-report-2026-03-27-1.md)
