# 次セッション開始用スクリプト

以下のテキストをそのまま新しいセッションに貼り付けてください。

---

## 貼り付け用プロンプト

```
連珠 CPU の評価関数改善プロジェクトを再開します。前セッションまでで以下の状態です:

- Phase 0-6（ビットボード化）完了: NPS +85〜105%
- Phase B（ライン単位ポテンシャル評価）完了: +74.6 Elo、cpu-improve にコミット済み
- Phase C（パラメータチューニング）は全組棄却
- Phase D（影響圏 / Influence Map）も棄却済み、ブランチ削除済み
  - 理由: shift方式+望遠鏡和で最小実装したが -40.3 Elo + NPS -7.9%
  - Phase B の窓 popcount と距離線形減衰が実質同じ情報で相殺

まず現在の状態を把握してください:

1. `git status --short && git log --oneline -5` で作業ツリーと HEAD を確認
2. `docs/plans/eval-improvement-status.md` を読む — Phase B/C/D 結果、Phase C/D の教訓、次アプローチ候補、作業方針
3. `zig/src/line_potential.zig` を読む — Phase B の実装（参考）

その後、以下のタスクを進めてください:

**次セッションのタスク**: Phase B と情報的に独立する新評価軸の検討と実装

候補（eval-improvement-status.md の「次のアプローチ候補」より）:
- (a) 方向分散ペナルティ: 主軸方向への集中ボーナス、散らばりへの減点
- (b) コンタクト志向: 相手石と接する自色石を評価
- (c) 相手石への重ね評価: 相手のポテンシャルを相殺する位置を優先
- (d) 禁手誘導評価: 黒なら四四・三三を発生させうる配置を積極的に評価

**Phase C/D の教訓を必ず踏まえる**:
- 評価軸が Phase B と情報的に重複すると相殺で悪化する（等方的な近傍重み付けは全部 Phase B の窓 popcount と本質的に同じ）
- 新しい評価軸を考えたら、実装前に **Phase B との情報独立性** をどう担保するか検討する
- 「理論的妥当性で残す」は評価値の質が悪化する改変には適用できない
- 深度が増えているのに勝てない場合は評価歪みの証拠 → revert

**手順**:
1. 候補から 1-2 種類を選び、`/review` でイシュー視点のレビューを先にもらう（実装前の筋判定）
2. 筋が良さそうなら最小実装＋即ベンチのアプローチを継続
3. `zig build test && zig build && pnpm check-fix`
4. `pnpm commit:bench --commitA=cpu-improve --commitB=<new-branch> --sets=1`
5. 判定（Phase C/D と同じ）:
   - -30 Elo 以下 → revert
   - ノイズ範囲（0 付近）→ 相関分析して情報独立性を再評価
   - +20 以上 → 採択

**重要な注意**:
- Claude Code の agent spawn worktree が古い base を再利用するバグがあるので、agent を使う場合は worktree の `git log --oneline -1` で HEAD が `cdfb3af` 以降であることを確認すること
- TS 版評価関数は退役済み。`evaluateBoard.test.ts` は削除済みで、TS 側との値一致は不要
- `commit-bench` は並列実行不可（worktree 競合）
- 最小実装＋即ベンチ方式を継続（新規 .zig ファイル作成は +20 Elo 確認後のリファクタで）
```

---

## 補足: 次セッション途中で必要になったらこのファイルも見ること

- **状態把握**: `docs/plans/eval-improvement-status.md`
- **メインプラン**: `docs/plans/eval-improvement-plan.md`
- **棋譜分析データ**: `bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json`
- **Phase D 結果**: `bench-results/commit-bench-2026-04-11T15-18-01-638Z.json`
- **振動分解ベンチ**: `scripts/eval-vibration-bench.ts`（新評価軸導入後に流して振動低減を確認）
- **時間-深度ベンチ**: `scripts/time-to-depth-bench.ts`（必要なら depth 到達時間を計測）
