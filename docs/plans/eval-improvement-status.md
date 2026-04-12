# 評価関数改善プロジェクト 現状とハンドオフ

**最終更新**: 2026-04-12
**ブランチ**: `cpu-improve`
**次のフェーズ**: 新アプローチ検討（方向分散ペナルティ / コンタクト志向など）

---

## 全体サマリ

連珠 CPU の「組み方が弱い」問題の改善プロジェクト。

### 達成状況

| フェーズ           | 内容                                                            | 結果                         |
| ------------------ | --------------------------------------------------------------- | ---------------------------- |
| Phase 0-6          | ビットボード化・LUT 導入                                        | **NPS +85〜105%** 達成       |
| Phase 0 (振動分解) | 静的評価ノイズ vs horizon effect の切り分け                     | **静的ノイズが支配的**と確認 |
| Phase B            | ライン単位ポテンシャル評価（incremental 化）                    | **+74.6 Elo [−17.9, 179.2]** |
| Phase C 末端脅威系 | `LEAF_FOUR_THREE_THREAT 2000→3500`, `LEAF_MISE_THREAT 500→1000` | **-74.6 Elo** 棄却           |
| Phase C 連携系     | `CONNECTIVITY_BONUS 30→60`, `MULTI_THREAT_BONUS 500→800`        | **-74.6 Elo** 棄却           |
| Phase C パターン系 | `THREE 30→80`, `OPEN_TWO 50→80`                                 | -20.1 Elo ノイズ範囲 / 棄却  |
| Phase D 影響圏     | ライン sweep 距離ベース評価（shift 方式 + 望遠鏡和）            | **−40.3 Elo** 棄却 + revert  |

### 現状

- **cpu-improve ブランチ = Phase B 完了状態**（コミット `cdfb3af`）
- Phase C は全組棄却（Phase B で既にバランスが取れているため、過大な定数増加は逆効果）
- **Phase D も棄却済み**（ブランチ `phase-d-influence` 削除、詳細は後述）
- 次は **新アプローチ検討**（方向分散ペナルティ / コンタクト志向 / 相手石への重ね評価）

### Phase B が効いた理由（確認済み）

棋譜 16 局分析（`bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json`）から:

- 平均評価値振動 627/手 の大半は静的評価のノイズ
- Phase B は「ライン上の相手なし窓に自色石が何個あるか」を加算し、素材の蓄積を直接評価
- 中盤の方向性が安定し、勝率が 61% (31/52) に上昇

### Phase C が効かなかった理由（仮説）

- 過去の調整案（+50〜+160%）は Phase B 導入前の想定
- Phase B で `LINE_POTENTIAL_TABLE` が加わり、評価ベースラインが変わった
- 既存定数を大きく増やすと重複加算・過大評価になり、評価がブレる
- どの変更でも深度が +0.23〜0.32 増加するが、勝率は下がる（評価ノイズの増加）

---

## Phase D 実施結果（棄却）

### 実装（最小実装版）

イシューレビューの「Phase C 再演リスク」指摘と、パフォーマンスレビューの最適化案を反映し、当初プランから **最小実装＋即ベンチ** に切り替えて実施:

- `zig/src/evaluate.zig` に `computeLineInfluence` / `computeInfluenceTotal` を private 関数として追加（新規 .zig ファイル作らず）
- アルゴリズム: **shift 方式 + 望遠鏡和**（per-cell sweep より 5 倍速い）
- 重み `{1,1,1,1}`（シンプルな望遠鏡和、INFLUENCE_TABLE 不要）
- 88 ライン × 4 iter × 定数 ≈ 2,112 ops/eval
- 非 incremental（毎回全ライン走査）
- コミット `8ff9b3d`（後に revert、ブランチ削除）

### Stage 1 結果（2026-04-12, 52 局 hard）

```
commitA: cdfb3af (cpu-improve = Phase B only)
commitB: 8ff9b3d (phase-d-influence = Phase B + Phase D)
WDL (commitA視点): +28 =2 -22
Elo差 (A視点): +40.3 [-52.3, +139] → Phase D 視点 -40.3
NPS: A=20,847, B=19,193 → -7.9% (設計値 -1〜2% を大きく超過)
深度: A=4.20, B=4.41 → Phase D のほうが 0.21 深い
```

### 棄却の根拠

1. **Elo −40.3 は判定基準 −30 以下**（中央値）
2. **NPS −7.9% は設計値を 4-8 倍超過**（予測と実測の乖離）
3. **深度が増えているのに勝てていない** — 評価関数が歪んでいる動かぬ証拠
4. **イシューレビュー指摘通り Phase C 再演**: ライン窓 popcount（Phase B）と距離線形減衰（Phase D）は実質同じ情報の別変換で、Phase B と相殺し悪化

### 学び

- 「ライン上で自色石の近傍セルを重み付けする」系の評価は Phase B と情報が重複する
- 等方的な距離ベースは「方向性欠如」問題と筋が悪い（4 方向散らばりを逆に助長）
- NPS 見積もりは WASM での実測と乖離しがち（eval function が 1.8% しか占めないのに NPS は −7.9% 低下）
- **「理論的妥当性で残す」方針は、評価値の質が悪化する改変には適用できない**（Phase C で学んだことの再確認）

### 次のアプローチ候補

Phase D 棄却を踏まえ、Phase B と **情報が独立する** 方向で検討:

1. **方向分散ペナルティ**: 石が複数方向に散らばっていると減点、主軸方向への集中を評価
2. **コンタクト志向**: 相手石と接している自色石を評価（防御力の向上＋攻守一体化）
3. **相手石への重ね評価**: 相手の ポテンシャル/影響圏 を相殺する位置を優先
4. **禁手誘導評価**: 黒なら四四・三三が発生しうる状況を積極的に作る

いずれも Phase B の窓 popcount とは明確に異なる評価軸。ただしイシューレビューが指摘したように「事前の情報独立性検証」をして、Phase C/D の教訓を活かしたい。

---

## 重要ファイル

### Phase B（成功）

- `zig/src/line_potential.zig` — ライン単位ポテンシャル評価本体
- `zig/src/scores.zig` — `LINE_POTENTIAL_TABLE`
- `zig/src/incremental_eval.zig` — `line_potential_black/white` 差分更新
- `zig/src/evaluate.zig` — 非 incremental パスでの加算

---

## Phase B の技術メモ（次セッション向け）

### incremental 化のポイント

- `IncrementalEvalState` に `line_potential_black/white` フィールド追加
- `placeStone`/`removeStone` の前に `subtractLinePotential`、後に `addLinePotential`
- これで石配置のコストは 4 ライン × ~6 窓 × 5ns ≈ **160 ns/手**
- `getEvaluation` は O(1) 参照のみ（集計値の減算）

### VERIFY_INCREMENTAL 整合性

- `evaluate.evaluateBoardOnCells`（非 incremental パス）にも `computeTotalGlobal` を呼んで加算
- Debug モードで `incremental_eval.getEvaluation` と `evaluate.evaluateBoardOnCells` の結果一致を assert
- Release では incremental 経路のみ使われる

### quiescence/minimax 統合

- Phase B で quiescence と minimax の両方を `incremental_eval.placeStone`/`removeStone` 経由に変更
- `search.zig` で `incremental_eval.initFromBoard` を探索開始時に呼ぶ
- テストは `incremental_eval.initFromBoard` を呼んでから quiescenceSearch / minimaxWithTT を呼ぶように修正

---

## 参考: 過去の結果

### NPS 推移

| 時点                          | NPS (HEAD) | vs main |
| ----------------------------- | ---------- | ------- |
| main                          | ~10,000    | 基準    |
| Phase 0-2（LUT 部分導入）     | ~10,700    | +7%     |
| Phase 3-4                     | ~15,300    | +53%    |
| Phase 5                       | ~15,300    | +53%    |
| Phase 6+ext（完了）           | ~20,000    | +100%   |
| Phase B（線単位ポテンシャル） | ~19,300    | +93%    |
| Phase D（影響圏、棄却）       | ~17,700    | +77%    |

### 評価値振動

- Phase 0（振動分解）: 静的評価 振動 1496/手 vs 探索 d=7 1257/手 → **比率 1.19（静的支配）**
- Phase B の効果: 棋譜から観測した振動（627/手）が低減したかは未測定

### Phase C 棄却の詳細

各グループとも `commit-bench` 1 セット（52 局）で以下の数値:

```
末端脅威系: -74.6 Elo [-179, +18] (WDL +31=1-20 from Phase B view)
連携系:    -74.6 Elo [-179, +18] (WDL +31=1-20 from Phase B view)
パターン系: -20.1 Elo [-118, +74] (WDL +27=1-24 from Phase B view)
```

偶然にも末端脅威系と連携系が同じ WDL になったが、これは Phase B の決定性のため。

### Phase D 棄却の詳細

```
影響圏 (shift+望遠鏡和): -40.3 Elo [-139, +52] (WDL +28=2-22 from Phase B view)
NPS: 20,847 → 19,193 (-7.9%) 設計値 -1〜2% を大きく超過
深度: Phase B 4.20, Phase D 4.41 (+0.21) なのに負け越し → 評価歪みの証拠
```

---

## 次セッションへのメッセージ

1. **Phase B は完成しており、cpu-improve にコミット済み** (`2db8b90`, HEAD は `cdfb3af`)
2. **Phase C / Phase D は棄却済み**（Phase B で既にバランスが取れており、重複する評価軸は相殺で悪化する）
3. **次は新アプローチ検討**: Phase B と情報的に独立する評価軸を探す
4. 候補: (a) 方向分散ペナルティ (b) コンタクト志向 (c) 相手石への重ね評価 (d) 禁手誘導評価
5. **事前の情報独立性検証を強く推奨**（Phase B との相関を盤面サンプルで測る）
6. Phase B の実装は `zig/src/line_potential.zig` + `zig/src/incremental_eval.zig` を参考に

### Phase C/D の教訓

- **評価軸が Phase B と情報的に重複すると相殺で悪化する**（等方的な近傍重み付けは全部 Phase B の窓 popcount と本質的に同じ）
- **中央値の Elo で判定する**、CI がまたいでいても中央値 −30 以下は revert
- **深度が増えたのに勝てない場合は評価歪みの証拠**（NPS 損失を補って余りある評価悪化）
- **NPS 見積もりは WASM 実測と乖離しがち**（プロファイル比率 1.8% の関数でも NPS は数% 落ちうる）
- **「理論的妥当性で残す」は評価値の質が悪化する改変には適用できない**

### 注意事項

- **worktree の base が古くなる問題**: Claude Code の agent spawn worktree は古いブランチを再利用することがある。必ず `git log --oneline -1` で HEAD が `cdfb3af`（Phase B + handoff）以降であることを確認
- **TS 版評価は既に退役**: `src/logic/cpu/wasm/evaluateBoard.test.ts` は Phase B で削除済み
- **commit-bench は並列実行不可**（worktree パス競合）

---

## 関連ドキュメント

- `docs/plans/eval-improvement-plan.md` — メインプラン v3
- `docs/cpu-improve-plan.md` — 古い改善プラン（Phase 0-6 のビットボード化はこれの延長線）
- `bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json` — 棋譜分析の根拠
- `bench-results/commit-bench-2026-04-11T*` — Phase B, Phase C のベンチ結果
- `bench-results/commit-bench-2026-04-11T15-18-01-638Z.json` — Phase D Stage 1 結果
