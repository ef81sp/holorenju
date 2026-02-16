# CPUアルゴリズム処理フロー見直し計画

## 概要

CPUアルゴリズムはパッチの繰り返しにより処理フローに過不足が生じている。
本タスクは「あるべき姿への見直し」であり、不足している処理の追加と冗長な処理の整理を行う。

### 処理の過不足一覧

| #   | 種別     | 内容                                            | 箇所                                     |
| --- | -------- | ----------------------------------------------- | ---------------------------------------- |
| F-1 | **不足** | VCT攻撃がメインフローに未統合                   | iterativeDeepening.ts                    |
| F-2 | **不足** | VCTカウンター脅威の`ct=four`処理が未実装        | vct.ts L195-199                          |
| F-3 | **不足** | VCTカウンター脅威の`ct=three`処理が未実装       | vct.ts L195-199                          |
| R-1 | **冗長** | `detectOpponentThreats` の二重呼び出し          | iterativeDeepening.ts L126, L392         |
| R-2 | **冗長** | 候補手制限ロジックが2箇所に分散                 | iterativeDeepening.ts L248-284, L390-407 |
| R-3 | **冗長** | `findPreSearchMove` の7責務混在（194行）        | iterativeDeepening.ts L91-285            |
| R-4 | **冗長** | `VCT_BONUS=8000` 定義 + `vctBonus=0` の死コード | patternScores.ts, positionEvaluation.ts  |

### 現状フロー → あるべき姿

```
【現状】                              【あるべき姿】
即勝ち                                Phase 2: 即勝ち
必守(detectOpponentThreats 1回目)     Phase 3: 必守（1回のみ、結果キャッシュ）
VCF攻撃                              Phase 4a: VCF攻撃
（VCTなし）← 不足                    Phase 4b: VCT攻撃 ← 新規
Mise-VCF                              Phase 4c: Mise-VCF
相手VCF → VCF防御                    Phase 5: 相手VCF
--- ここから別関数 ---                Phase 6: 候補手制限（統一）
候補手生成                              ├ VCF防御セット
detectOpponentThreats 2回目 ← 冗長     └ 活三防御セット（キャッシュ利用）
活三防御                              Phase 7: 候補手生成 & 動的時間
反復深化                              Phase 8: 反復深化Minimax
```

### 実施フェーズ

| Phase                                                  | 対象     | 内容                          | リスク | ベンチマーク |
| ------------------------------------------------------ | -------- | ----------------------------- | ------ | ------------ |
| [1](cpu-flow-review-plan/phase1-vct-counter-threat.md) | F-2, F-3 | VCTカウンター脅威改善         | 高     | 必要         |
| [2](cpu-flow-review-plan/phase2-vct-main-flow.md)      | F-1      | VCTメインフロー統合           | 中     | 必要         |
| [3](cpu-flow-review-plan/phase3-threat-cache.md)       | R-1      | detectOpponentThreats重複解消 | 最小   | 不要         |
| [4](cpu-flow-review-plan/phase4-restriction-unify.md)  | R-2      | 候補手制限ロジック統一        | 低     | 不要         |
| [5](cpu-flow-review-plan/phase5-phase-separation.md)   | R-3      | findPreSearchMoveフェーズ分離 | 低     | 不要         |
| [6](cpu-flow-review-plan/phase6-dead-code.md)          | R-4      | 死コード削除                  | 最小   | 不要         |
