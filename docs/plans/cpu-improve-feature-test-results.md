# cpu-improve ブランチ個別機能テスト結果

## 実施日: 2026-03-16

## 背景

cpu-improve ブランチは main と比較して Elo +20.9 [-12.2, 54.4]（main視点、416局 r0.02）で有意差なし〜やや弱い。
複数機能が相殺し合っている可能性があり、各機能を個別に無効化してテスト。

## ベンチマーク結果（r0 52局 hard main視点）

| テスト                        | Elo差     | 95% CI         | WDL     | 解釈                              |
| ----------------------------- | --------- | -------------- | ------- | --------------------------------- |
| no-threat-probe (A+B+F全無効) | -20.1     | [-117.7, 74.4] | 24-1-27 | Threat Probe はやや有効           |
| no-vct-probe (Bのみ無効)      | **+33.5** | [-60.3, 132.6] | 28-1-23 | VCTプローブが弱体化要因           |
| no-counter-move (C無効)       | -33.5     | [-132.6, 60.3] | 23-1-28 | Counter-move は有効               |
| no-defense-filter (E無効)     | **+60.7** | [-32, 163.3]   | 30-1-21 | 防御VCFフィルタが最大の弱体化要因 |

## 有効な機能

- **VCF Threat Probe**: 無効化でElo -20.1。VCTなしのVCFプローブ単体は強化要因
- **Counter-move heuristic**: 無効化でElo -33.5。有効

## 弱体化要因

- **活三防御VCFフィルタ** (`filterDefenseByOpponentVCF`): Elo +60.7で最大の弱体化要因
  - hasVCF(maxDepth=8, timeLimit=50) × 候補数のコスト
  - 最善の防御手が候補から完全除外され、minimax探索が劣った手しか見えない
- **VCTプローブ** (threatProbe内のVCT): Elo +33.5で弱体化要因
  - `hasVCT` 再帰内でカウンター脅威（四/活三/ミセ手）を未チェック → 偽陽性の可能性
  - ただしバジェットが小さい（vctDepth=3, vctNodes=200）ため影響度は不確実

## 試みた改善と結果

### 試行1: 防御VCFフィルタ削除（Phase 1）

- `filterDefenseByOpponentVCF` を削除し `threats.openThrees` をそのまま返す
- コミット → revert
- **問題**: 「入れてみて効果がなかったから消す」だけで、改善ではない

### 試行2: hasVCT にカウンター脅威チェック追加（Phase 2）

- `hasVCT()` の防御ループで `checkFive` のみ → `evaluateCounterThreat` に変更
- 他のVCT関数（`findVCTSequenceRecursive`, `isVCTFirstMove`）と統一
- **問題**: 探索が厳密になりすぎて実用的でない
  - ct=three → VCFフォールバックで、以前はVCT再帰で見つかっていたケースが見つからなくなる
  - `findVCTMove` が60秒でもタイムアウト（以前は30秒で完了）
  - unit test (`ct=three: VCFがある場合VCT成立`) も失敗

### 教訓

- `hasVCT` はあえてカウンター脅威チェックを省略して高速化している（楽観的判定）
  - `evaluateCounterThreat` を入れると正確になるが、探索コストが大幅増
  - 他のVCT関数と不整合だが、性能トレードオフとして意図的
- 防御フィルタは削除だけでなく「ソフト優先化」（除外→順序ヒント）も検討すべきだった

## 未解決の改善方向

1. **防御フィルタのソフト優先化**: フィルタ結果をハード除外ではなくmove orderingのヒントにする
2. **VCTプローブのバジェット調整**: depth/nodesを下げて偽陽性リスクを減らす
3. **threatProbeキャッシュ改善**: enableVCTフラグを区別していない問題
4. **VCTプローブ無効化**: 最もシンプルな改善（enableVCT=false固定）
