# 振り返り画面 右パネル（評価パネル）再デザイン

2026-11-19。Claude Design のキャンバス「振り返り画面 デザイン見直し」で決めた内容を実装する。
対象は `ReviewEvalPanel` 配下（ReviewVerdict / ReviewCandidateGrid / ReviewProgression / BranchOptions / TabList）のみ。
色・文字サイズは既存トークンを維持し、レイアウトと表示ルールだけを変える。

## 決定事項

### 表示ルール（ロジック）

1. **候補手は最大 3 件**。最善手（`bestMove`）と自分の手（実着手）は必ず含め、残り枠を上位（配列順）から補う。表示順・順位番号は元の配列順のまま。
2. **候補手のスコア差の代わりに最善からの距離ゲージ**を表示する（2026-11-19 にランク表示から変更）。長さは差に比例し差400（疑問手の境界）で底、色は S/A/B/C の4段階。基準は最善との差（`best.searchScore - c.searchScore`）で、
   品質判定 `classifyMoveQuality` と同じしきい値を使う（SSoT）。
   - S = excellent（差 0）、A = good（≤150）、B = inaccuracy（≤400）、C = mistake / blunder
   - 上限値（`scoreExact=false`）はその値で判定する（真値はそれ以下なので、ゲージが実際より長く出ることはない）
   - 差の数値は `title` / `aria-label` に残す（`formatCandidateDelta` は継続利用）
3. 候補手見出しの件数表示（「N件」）を削除。

### レイアウト（CSS、4px 単位）

- パネル: padding 12、縦 gap 8。セクション間は `<hr>` で区切る（`* + *` の border-top/padding 方式を廃止）。セクション内 gap 8。
- 結論: スコアは「ラベル 値」を横並び・下揃えの 2 列。タグは padding 4/8・角丸 4。
- 候補カード: 高さ 36・横並び。順位丸（12px 真円）を左上の角に重ねる（-4px）。座標を中央に置き、下端（left/right 8・bottom 4・高さ 4）に距離ゲージ。最低 4% は残す。
  危〜／フクミのラベルは右下の角に重ねる。カード間 gap 4、3 列、スクロールなし。
- 最善の進行:
  - タブは「最善 / G10」の 1 行、高さ 24。
  - 操作ボタン高さ 28・角丸 8。
  - 手順ボタン高さ 32・角丸 8。番号丸は 16px 真円を左上の角に重ね（-4px）、数字は system-ui・`text-box: trim-both cap alphabetic` で上下中央。
  - 分岐行は選択肢を独立ボタンにして gap 4、点線枠 padding 8。
  - 手順ボタン間 gap 4。

## フェーズ

1. ロジック（TDD）: `src/logic/reviewCandidateDisplay.ts` に `gradeFromDelta` / `selectDisplayCandidates` を追加し単体テスト。
2. コンポーネント: ReviewCandidateGrid → ReviewVerdict / ReviewEvalPanel → ReviewProgression / BranchOptions / TabList。
3. 評価ヘルプ（ReviewEvalHelpDialog）の品質しきい値（80/300 → 150/400）と候補手の説明をゲージ表示に合わせて更新。
4. `pnpm check-fix`、サブエージェントでレビュー、コミット。

## 対象外

- 左パネル・盤面・セリフ欄
- 盤面連動（ホバー○・PV プレビュー）の挙動
