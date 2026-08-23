# #142 設計メモ: 静止探索（quiescence）で黒の禁手をフィルタする（2026-08-23、オーケストレータ作成）

## 目的

`zig/src/quiescence.zig` の `generateTacticalMoves` / `quiescenceSearch` は黒の禁手（三三・四四・長連）を一切見ずに着手する。黒の禁手着手は連珠では黒の負け（打てない）なので、(a) 黒が「打てない四」で自分の評価を稼ぐ、(b) 白の四に対する黒のブロック点が禁手なのに「受けられた」扱いになる、の 2 つの誤評価がある。#141 で葉評価の FIVE 暴れは消えたが着手自体は残る。

## 現状の構造（quiescence.zig:139-190, 193-330）

1. `generateTacticalMoves` (1): 相手の直前手が四なら `getFourDefensePosition` の `.block` のみを返す（`.unstoppable` は (2) に落ちて自分の四＝カウンター四を探す）。
2. (2): near-mask 内の空点を仮配置し `createsFour` なら候補。
3. `quiescenceSearch`: stand-pat → 候補を `incremental_eval.placeStone` で置いて再帰。

## 不変条件（連珠ルール）

- 黒の着手は `checkFive`（ちょうど五）なら禁手でも合法（五が禁手に優先、`move_gen.zig:91-100` と同じ流儀）。
- 黒の四四・三三・長連点は着手不可。
- 白に禁手はない。

## 変更

### A. (1) 強制ブロックが黒の禁手のとき

- `color == .black` かつ `dp` で `!forbidden.checkFive(cells, dp.row, dp.col, .black)` かつ `forbidden.checkForbiddenMove(cells, dp.row, dp.col) != .none` → 黒は受けられない＝次に白が五。
- 戻り値で「合法な受けなし（forced loss）」を呼び出し側に伝える。API 案: `generateTacticalMoves` の戻り値を `struct { count: u16, forced_loss: bool }` に（または out パラメータ）。
- `quiescenceSearch` 側: `forced_loss` なら現手番（`current_color`）の負けスコアを返す。スコア規約は `minimax.zig:451-453` の終局（`scores.FIVE` / `-scores.FIVE`、perspective 基準）に合わせる: `current_color == perspective` なら `-scores.FIVE`、そうでなければ `+scores.FIVE`（必要なら ply 補正は minimax の流儀に従う。無ければ無しで可）。
- 注意: stand-pat による α-β カットはこの判定より**前**にあるが、forced loss は stand-pat より悪いので順序はそのままでよい（stand-pat ≥ beta で切る場合はその枝はどのみち使われない）。ただし厳密には「受けられない＝負け」が stand-pat より優先されるべきなので、`forced_loss` 判定を stand-pat の**前**に置くのが正しい（= `generateTacticalMoves` を先に呼ぶか、(1) 部分だけ先に評価する）。実装は (1) の判定を独立関数 `forcedBlockOrLoss(cells, color, last_move) -> enum{ none, block: Position, forced_loss }` に切り出し、stand-pat 前に評価する。

### B. (2) 自分の四を作る手が黒の禁手のとき

- `is_four` かつ `color == .black` のとき、石を戻した後に `checkFive`（真なら候補に残す）→ `checkForbiddenMove != .none` なら候補から除外。
- コストは `is_four` のときだけ（候補の大半は四でない）。`createsFour` は SSoT（五点ベース）なので長連の偽四はすでに除外済み；残るのは四四（同時に別方向の四）・四と三三の共存（四+三三は三三で禁手）・四と長連の共存。

### C. 変更しないもの

- `.unstoppable`（活四）で黒がカウンター四を探す経路: B のフィルタが効く。
- TS 側: quiescence は Zig 専用（TS 削除済み）なのでパリティ対象なし。`src/logic/cpu/search/` に対応物がないことを確認してコメントに記す。

## テスト（Zig、先に赤）

1. 白の四（止め四、受け 1 点）に対し黒の受け点が四四点 → `quiescenceSearch(黒手番)` が黒の負けスコア（`-scores.FIVE`、perspective=黒）を返す。修正前は受けを打って stand-pat 付近を返す（赤）。
2. 同じ形で受け点が黒の五点でもある（禁手だが五優先）→ 受けが生成され、結果は黒有利（五）。
3. 黒の四を作る点が四四点 → `generateTacticalMoves(黒)` の候補に含まれない。同じ形で白なら含まれる（白に禁手なし）。
4. 既存テスト（`quiescence.zig` 内 + `reviewSnapshot`）が緑。スナップショット変化があれば理由を明記。

## リスク / 計測

- q-search は対局 CPU の葉で走る → 挙動変化。黒の禁手着手が出現する局面は密局面の一部。commit-bench（オーケストレータ）で Elo 確認。
- `checkForbiddenMove` は (1) で高々 1 回／ノード、(2) で四候補ごと。NPS への影響は小さい見込み。性能レビューで確認。

## 成果物

- `docs/plans/issue-142-quiescence-forbidden-2026-08-23.md` にこのメモを保存してコミット。
- PR（base development）、`Closes #142`。

---

## 実装時の追記（2026-08-23、実装担当）

### 追記 1: 「打てるか」述語は `forbidden.isPlayable` に SSoT 化した

本メモ作成後に `development` へ #146 / #145（PR #149）が入り、`vct.zig` に
`blockIsPlayable`（`checkFive` → `checkForbiddenMove` の順で「攻め側が黒でもその点に
打てるか」を判定）が追加されていた。A / B で必要な述語はこれと**同一**なので、
新規に書き下ろさず `forbidden.zig` に `pub fn isPlayable(cells, row, col, color) bool` として
切り出し、`vct.blockIsPlayable` はそこへ委譲する形にした（`quiescence.zig` から
`vct.zig` を import すると循環になるため、共通の下位モジュールである `forbidden.zig` が
置き場として正しい）。`move_gen.zig` の黒番候補フィルタも同じ順序を手書きしていたので
同じ述語に載せ替えた。これで「黒が打てる点か」の定義は 1 箇所になる。

### 追記 2: `generateTacticalMoves` は `forced` を引数で受け取る

`forcedBlockOrLoss` を stand-pat の前に評価する以上、`generateTacticalMoves` が
同じ判定をもう一度やるのは無駄（`getFourDefensePosition` 4 方向 + 禁手判定が
1 ノードあたり 2 回走る）。そこで `generateTacticalMoves(cells, color, forced, buf)` と
シグネチャを変え、呼び出し側が 1 回だけ計算した結果を渡す形にした。
`generateTacticalMoves` の外部呼び出し元は存在しなかった（`quiescence.zig` 内とテストのみ）。

### 追記 3: TS 側に quiescence の対応物がないことの確認

`src/` 配下で quiescence 相当の実装は存在しない（`grep -rl quiescence src/` の
ヒットは `threatMoves.ts` / `threatPatterns.ts` / `threatLoader.ts` などの
「TS 版 quiescence.ts に対応」というコメント上の言及と、四受け点のパリティテスト
`fourDefenseParity.wasm.test.ts` のみ）。静止探索本体は Zig 単一実装なので、
本 PR にパリティ対象はない。この旨を `quiescence.zig` のコメントに明記した。
