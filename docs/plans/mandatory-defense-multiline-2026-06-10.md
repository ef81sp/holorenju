# 必須防御マスクの全活線カバー化 — 第一歩（過小防御の解消）

## 狙い

hard CPU が相手の脅威に「必須防御マスク」（この点に打たねば負ける強制防御点集合）で
着手を絞る際、**独立した活三が2本以上ある局面で過小防御になる**バグを解消する。
corpus の blunder 分類 `allowed-opponent-threat=8件` に直結する実バグ。

## 現状の欠陥（調査確定, file:line）

- `ThreatInfo`（zig/src/threats.zig:77-93）は脅威をカテゴリ単位の**フラットunion**で保持
  （open_threes 等が1リスト・脅威ごとのグループ情報なし）。
- `detectThreatsCore`（threats.zig:527-584）が全方向の防御点を `addUniqueList` で1リストに混ぜる。
- 評価枝刈り `position_eval.zig:304-367`（活三は :339-340）が
  `threat.open_threes.contains(row,col)` 一発で「unionのどれか1点を踏めばOK」と判定。
- **帰結（過小防御）**: 独立活三A・Bが同時にあると、Aだけ止める手も union に含まれ
  `contains`=true で生き残る → CPU は「必須防御クリア」と誤認 → B で負ける。
  ※既存の `can_win_first`（四三/活四の反撃, position_eval.zig:325-326）は除外対象外なので
  「反撃テンポ」は部分的に考慮済みだが、**グループ別の全止め判定は無い**。

## 必須防御枝刈りは WASM 専用（重要）

- この枝刈りロジックは Zig/WASM のみ。TS には移植されていない
  （TS `threatDetection.ts`/`patternScores.ts` の ThreatInfo は review/scripts 専用）。
- パリティ: 実在するのは `src/logic/cpu/wasm/threatAdapter.test.ts`（WASM⇄TS の
  `detectOpponentThreats` をフラット5カテゴリで照合）。**`renjuParity.test.ts` は実在しない**
  （CLAUDE.md の記述は不正確）。
- → **`ThreatInfo` の構造を変えなければ TS同期もパリティ改修も不要**。

## 第一歩 A（最小・パリティ非破壊・除外を緩めるだけ）

`ThreatInfo` 構造は据え置き（フラットunion維持＝threatAdapter パリティ無傷）。

1. `detectThreatsCore` に **独立活三の本数カウンタ** `open_three_group_count: u8` を追加。
   各方向で新しい活三を検出するたびにインクリメント（止め点リストは従来どおり union に統合）。
2. `position_eval.zig:339` の活三枝刈りを変更:
   `open_three_group_count >= 2` のときは、`can_win_first`（既存の四三/活四反撃）でない限り
   **活三マスクによる除外を発動しない**（＝複数活線時はどの手も安全除外せず探索に委ねる）。
3. `move_order.zig:217-247` の union 枝刈りは**触らない**（探索手集合を変える最大リスク要因のため後回し）。

### なぜ安全か

- 変更は「除外を緩める」方向のみ。誤って正解手まで切る危険がない。
- 真に二重活三で受けが無い局面では CPU は元々負け。広げても悪化しない一方、
  反撃の四がある局面では探索がそれを拾える（過小防御の盲打ちを回避）。
- 複数活三は稀なので、枝刈り緩和による深度コストは局所的。

## テスト・検証

- Zig: position_eval.zig:779-966 の mandatory-defense テスト群に
  「独立活三2本＋片止め手は必須防御を満たさない／反撃四は許容」の RED→GREEN を追加。
- 影響: 静的評価値（≒move順）のみ。move_order の探索手集合は不変。
- commit-bench r0.02（効率セット数）で Elo 計測。corpus の該当局面（allowed-opponent-threat）で
  analyze-position による実証も行う。

## 第二歩（効果が出たら・別コミット）

`ThreatInfo` を真のグループ別配列へ拡張し「全グループ止め OR 同等速反撃（createsFourThree/has_four）」
の正確判定を導入。`move_order.zig` の defense_bitmap も AND 化。このとき TS `threatDetection.ts`＋
`threatAdapter.test.ts`＋Zig テストを同時更新（パリティ維持）。回帰リスク高のため第一歩の効果確認後。

## 原則

1コミット1施策 / 評価のみ先・探索手集合(move_order)は後 / commit-bench で符号確認 / ボス承認後に着手。
