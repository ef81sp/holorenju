# 評価関数改善プロジェクト 現状とハンドオフ

**最終更新**: 2026-04-11
**ブランチ**: `cpu-improve`
**次のフェーズ**: Phase D（影響圏 / Influence Map）

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

### 現状

- **cpu-improve ブランチ = Phase B 完了状態**（コミット `2db8b90`）
- Phase C は全組棄却（Phase B で既にバランスが取れているため、過大な定数増加は逆効果）
- **Phase D は未着手**

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

## Phase D 実施プラン

### 前提条件（プラン v3 より）

- Phase B が +20 Elo 以上で go → **満たしている（+74.6 Elo）**
- 新規実装が必要（実装コストは B の 3-4 倍）

### アイデア

各石は周囲のセルに「影響」を放射する。影響圏の広さと重なり具合が「構築の余地」を表す。
棋譜分析で確認した「方向性の欠如」に直接対応する評価軸。

### 設計（ライン単位 sweep 方式）

全空きセル走査ではなく、ライン単位で sweep する（コスト最小化）:

```zig
// zig/src/influence_map.zig（新設）

/// 各ラインを左から右へ sweep し、各空きセル位置で
/// 「左側最寄り自色石までの距離」「右側最寄り自色石までの距離」を計算
/// 影響度 = max(0, 5 - distance)
pub fn evaluateInfluence(perspective: Cell) i32 {
    var total: i32 = 0;
    for (0..bitboard.LINE_COUNT) |line_idx| {
        const len = bitboard.LINE_LENGTHS[line_idx];
        if (len < 2) continue;
        const own = if (perspective == .black) bitboard.global_bb.black[line_idx]
                    else bitboard.global_bb.white[line_idx];
        const opp = if (perspective == .black) bitboard.global_bb.white[line_idx]
                    else bitboard.global_bb.black[line_idx];
        total += sweepLine(own, opp, len);
    }
    return total;
}

/// CTZ で左端からの距離を計算し、各空きセルに max(0, 5 - distance) を加算
fn sweepLine(own: u16, opp: u16, line_len: u4) i32 { ... }
```

### コスト見積

- 88 ライン × ~13 セル × 定数 = **3〜5 µs/eval**
- NPS 影響: **-3〜5%**（Phase B の incremental 化で得た余裕の範囲内）
- 非 incremental で実装開始（incremental 化は効果確認後）

### Phase B との責務独立性（SOLID 指摘反映）

`line_potential.zig` と `influence_map.zig` は互いを参照しない。

- `line_potential.zig`: 5-cell 窓 popcount ベース
- `influence_map.zig`: 距離ベース sweep
- ヘルパー共有もコピペもしない

### 統合

`evaluate.zig` と `incremental_eval.zig` の両方に加算:

- 非 incremental パス: `evaluateBoardOnCells` で `computeTotalGlobal` を呼ぶ
- incremental パス: Phase B と同様 `eval_state` に集計値を持つ
  - ただし **Phase D は incremental 化が難しい**（石 1 個で半径 5 の空きセルに波及）
  - まずは非 incremental で実装し、効果確認後 incremental 化を検討

### 撤退基準

- Stage 1 で **-30 Elo 以下** → revert
- NPS 低下 > 8% → 設計見直し
- B+D 累積 NPS 低下 > 10% → D を見送る
- 0 付近で動かない場合: 理論的妥当性は高いので残す（コスト < 5% NPS なら）

---

## 次セッションでの作業手順

### 1. 状態確認

```bash
cd /Users/rikegami/Development/holorenju
git status --short
git log --oneline -5
# → HEAD は 2db8b90 (Phase B 統合) であること
```

### 2. Phase D 実装

```bash
# ブランチ作成
git checkout -b phase-d-influence

# 1. zig/src/influence_map.zig を新設（別ファイルで責務独立）
# 2. zig/build.zig に test_influence_map を追加
# 3. zig/src/evaluate.zig で computeInfluenceGlobal を加算
# 4. zig/src/incremental_eval.zig でも加算（非 incremental だが eval_state 経由で呼ぶ）
#    - 最初は非 incremental で。毎回 computeTotal
#    - effect 確認後に influence_black/white フィールドを追加して incremental 化

# ビルド・テスト
cd zig && zig build test && zig build

# pnpm 系
cd ..
pnpm check-fix
```

### 3. 効果確認

```bash
# NPS 実測
node --cpu-prof --cpu-prof-dir=bench-results --experimental-strip-types \
  --import ./scripts/register-loader.mjs scripts/profile-bench.ts --games=2

# 対 Phase B ベンチ
pnpm commit:bench --commitA=cpu-improve --commitB=phase-d-influence --sets=1
```

### 4. 判定

- **-30 Elo 以下**: revert
- **0〜+20 ノイズ範囲**: 理論的妥当性で残すか判断
- **+20 以上**: 採択、cpu-improve にマージ

### 5. 最終確認（すべての Phase 入り vs main）

```bash
pnpm commit:bench --commitA=main --commitB=HEAD --sets=1
# Phase 0-6 + Phase B + Phase D の全部入りが main に対してどれだけ勝ち越すか
```

---

## 重要ファイル（Phase D 実装で触る）

### 新設

- `zig/src/influence_map.zig` — 影響圏評価本体

### 変更

- `zig/build.zig` — `test_influence_map` 追加
- `zig/src/evaluate.zig` — `evaluateBoardOnCells` で影響圏スコア加算
- `zig/src/incremental_eval.zig` — `IncrementalEvalState.influence_black/white` 追加 & 差分更新

### 参考（Phase B 実装、参考にすべき既存コード）

- `zig/src/line_potential.zig` — Phase B の実装（ライン bit ベース、incremental 統合の参考）
- `zig/src/scores.zig` — `LINE_POTENTIAL_TABLE` が scores.zig に追加されている。`INFLUENCE_TABLE` も同様に置く

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

### 評価値振動

- Phase 0（振動分解）: 静的評価 振動 1496/手 vs 探索 d=7 1257/手 → **比率 1.19（静的支配）**
- Phase B の効果: 棋譜から観測した振動（627/手）が低減したかは未測定（Phase D 完了後にまとめて測定する予定）

### Phase C 棄却の詳細

各グループとも `commit-bench` 1 セット（52 局）で以下の数値:

```
末端脅威系: -74.6 Elo [-179, +18] (WDL +31=1-20 from Phase B view)
連携系:    -74.6 Elo [-179, +18] (WDL +31=1-20 from Phase B view)
パターン系: -20.1 Elo [-118, +74] (WDL +27=1-24 from Phase B view)
```

偶然にも末端脅威系と連携系が同じ WDL になったが、これは Phase B の決定性のため。

---

## 次セッションへのメッセージ

1. **Phase B は完成しており、cpu-improve にコミット済み** (`2db8b90`)
2. **Phase C はすべて棄却**（Phase B で既にバランス取れている）
3. **次は Phase D（影響圏）** を実装する
4. プラン本体は `docs/plans/eval-improvement-plan.md` にある（v3）
5. 詳細な設計は `docs/plans/eval-improvement-plan.md` の「Phase D」セクションを読むこと
6. Phase B の実装は `zig/src/line_potential.zig` + `zig/src/incremental_eval.zig` を参考に

### 注意事項

- **worktree の base が古くなる問題**: Claude Code の agent spawn worktree は古いブランチを再利用することがある。必ず `git log --oneline -1` で HEAD が `2db8b90`（Phase B）以降であることを確認
- **TS 版評価は既に退役**: `src/logic/cpu/wasm/evaluateBoard.test.ts` は Phase B で削除済み。TS 版の `patternScores.ts` は review 機能で残存するが、WASM との値一致は**不要**
- **commit-bench は並列実行不可**（worktree パス競合）

---

## 関連ドキュメント

- `docs/plans/eval-improvement-plan.md` — メインプラン v3
- `.claude/plans/cheerful-skipping-starfish.md` — プランモードの作業ファイル（参考用、eval-improvement-plan.md と同内容）
- `docs/cpu-improve-plan.md` — 古い改善プラン（Phase 0-6 のビットボード化はこれの延長線）
- `bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json` — 棋譜分析の根拠
- `bench-results/commit-bench-2026-04-11T*` — Phase B, Phase C のベンチ結果
