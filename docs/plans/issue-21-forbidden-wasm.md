# Issue #21: 連珠ルールの TS⇄Zig ドリフトを CI パリティテストで防止

## 方針（確定）

連珠の禁手・パターン判定は **TS (`renjuRules/`) と Zig (`zig/src/`) に二重実装**されている。#19 (PR #20) では TS/Zig 両方を直す必要があり、片方だけ直すと**サイレントに食い違う**（ドリフト）。

物理的な単一ソース化（TS削除）は、調査の結果**氷山の本体が `patterns.ts`（連珠プリミティブ6関数、26ファイルが依存）⇄ `jump_patterns.zig`** にあり、これを消すには review worker の連珠ロジック層を丸ごと Zig 移植する大工事（`project_full_zig_migration` 級）が必要と判明。

→ 本 issue は **TS を残したまま、TS と Zig が一致していることを CI で常時検証するパリティテストを導入**し、#19級ドリフトを「**サイレントなバグ → 失敗するテスト**」に変える。**氷山全面（forbiddenMoves.ts ＋ patterns.ts）をカバー**する。最小・低リスク・最広カバレッジ。

- 物理削除・本番コード移行は**やらない**（別 issue: 連珠ロジック全面 Zig 移植）。
- 成果物 = CI 常駐パリティテスト ＋ それが使う Zig export。

## 調査で判明した対応関係（パリティ設計の前提）

`patterns.ts` の6 export 関数は **`jump_patterns.zig` に完全1:1対応**（同名・同ロジック）:

| TS (`renjuRules/patterns.ts`)                 | Zig (`zig/src/jump_patterns.zig`) |
| --------------------------------------------- | --------------------------------- |
| `checkOpenPattern` (L28)                      | `checkOpenPattern` (L281)         |
| `getConsecutiveThreeStraightFourPoints` (L99) | 同名 (L413)                       |
| `getJumpThreeStraightFourPoints` (L175)       | 同名 (L474)                       |
| `checkStraightFour` (L298)                    | 同名 (L348)                       |
| `checkJumpThree` (L392)                       | 同名 (L201)                       |
| `checkJumpFour` (L512)                        | 同名 (L93)                        |

`forbiddenMoves.ts:checkForbiddenMove` (L466, 黒のみ) ⇄ `forbidden.zig:checkForbiddenMove` (L319) も関数として1:1（内部構造は別だが入出力は同義）。

依存: `forbidden.zig`・`jump_patterns.zig` とも `board.zig` + `std` のみ（探索/TTを引かない）。`loadWasmModule()` は node/vitest で動作（テストから WASM 検証可）。

## 設計：分類オラクル方式

同一 `(board, row, col, color)` に対し、TS と Zig 双方から**観測可能な連珠判定をパックして突き合わせる**。

### Zig 側（`zig/src/main.zig` に export 1本追加）

```zig
// 既存の boardInit/boardSet/boardGet を再利用して盤面同期。
// 1点の全方向パターン分類＋禁手種別を u32 にパックして返す。
export fn classifyPointWasm(row: u8, col: u8, color: u8) u32 {
    var bits: u32 = 0;
    const c: board.Cell = @enumFromInt(color);
    inline for (0..4) |dir| {
        const op = jump_patterns.checkOpenPattern(&board.board_cells, row, col, dir, c);
        const sf = jump_patterns.checkStraightFour(&board.board_cells, row, col, dir, c);
        const jf = jump_patterns.checkJumpFour(&board.board_cells, row, col, dir, c);
        const jt = jump_patterns.checkJumpThree(&board.board_cells, row, col, dir, c);
        // dirあたり5bit: four,open4,open3,straightFour,jumpFour,jumpThree → 6bit
        const base = dir * 6;
        bits |= packBit(op.four, base + 0) | packBit(op.open4, base + 1) | packBit(op.open3, base + 2)
              | packBit(sf, base + 3) | packBit(jf, base + 4) | packBit(jt, base + 5);
    }
    // 禁手種別（黒のみ意味を持つ）を上位2bit
    if (color == 1) bits |= @as(u32, @intFromEnum(forbidden.checkForbiddenMove(&board.board_cells, row, col))) << 24;
    return bits;
}
```

- **既存エンジン wasm (`cpu-engine.wasm`) に export を足すだけ**。新ビルドターゲット・vite 変更・本番コード変更は不要。`pnpm build:wasm` で反映。
- 4方向 × 6bit = 24bit ＋ 禁手2bit が u32 に収まる。バッファ/ポインタ不要で境界越え1回。

### TS 側（テストヘルパー `classifyPointTs`）

```ts
// 同じ (board,row,col,color) で patterns.ts の同関数群＋checkForbiddenMove を呼び、同レイアウトで u32 にパック。
function classifyPointTs(board, row, col, color): number {
  /* checkOpenPattern/checkStraightFour/checkJumpFour/checkJumpThree ×4dir + checkForbiddenMove */
}
```

### パリティテスト（`src/logic/renjuRules/renjuParity.test.ts`）

1. **コーパス**:
   - **#19型局面を明示投入（必須・乱数任せにしない）**: 同方向の2飛び四＋「ウソの四(XXXX_X)」など、`renjuRules.test.ts` の #19 リグレッションケースおよび `forbidden.zig` の test 群（L378「同方向の2飛び四」/L394「ウソの四」）相当の局面を**種局面として固定投入**。これが #19 再発検出の生命線。
   - 既存 `renjuRules.test.ts` の局面群 ＋ ベンチ/テスト棋譜（reference の実戦譜）。
   - **決定的 PRNG（mulberry32/xorshift32 等、外部依存なし）**で生成した盤面（黒白混在・石密度を疎/中/密で段階化）。**非合法局面でも可**（同一盤面での TS/Zig 一致のみを問うため。むしろエッジケースを炙り出せて有益）。
   - **コーパス局面数は定数/env で可変**（CI は固定シードのサブセット、ローカルは全量）。
2. **WASM は `beforeAll` で1回だけロード**（48MB エンジン wasm。`loadWasmModule`）。全局面で使い回す（点/局面毎に再ロードしない）。
3. 各局面で WASM に全同期（`boardInit`＋石数 `boardSet`、局面毎1回。同期直後に board_cells が局面と一致することをアサート）。
4. 各空き点 × {black, white} について `classifyPointTs == classifyPointWasm` をアサート。
5. 不一致時は **局面・点・色・両者の分解結果＋「TS/Zigどちらかをドリフトさせた。両方直すかルール解釈を確認せよ」の指示**を出力して落とす。

### ビットレイアウトの一元化（SSoT補強）

- ビット位置（dirあたり `four,open4,open3,straightFour,jumpFour,jumpThree`＝6bit×4dir、禁手種別＝24bit目〜）を **TS 側 named const 1セット**＋**テスト冒頭の対応表（本プランの表）**に集約。Zig 側は数値直書きなので隣にミラーコメント。
- **禁手種別の数値マッピング**（TS `"overline"→1, "double-four"→2, "double-three"→3` ⇄ Zig `ForbiddenType`）もテスト内マッピング関数1箇所に閉じる（罠リスト参照）。
- **自己検証アサート**: 既知の単独パターン局面（例: 横の活三のみ）で「該当ビットだけ立つ」ことをパリティ比較とは独立にアサート（レイアウト自体のドリフト検知）。

## getConsecutive/getJumpThreeStraightFourPoints（点リスト返却）の扱い

- `getConsecutiveThreeStraightFourPoints`（両端の単純計算）→ `checkForbiddenMove` 経由の**間接カバーで可**。
- `getJumpThreeStraightFourPoints` は Zig 側の gap_offset 座標逆算（jump_patterns.zig L501-541）が非自明でバグ余地が大きい → **初回から達四点リストの直接比較を入れる**（点集合の一致を検証。バッファ返し or 点数+座標を別 export）。

## 想定される「初回失敗」＝既存ドリフトの露見

- パリティテストは**初回に既存の TS/Zig 不一致を炙り出す可能性**がある（それが本来の価値）。
- 不一致が出たら：局面を最小化し、連珠ルール上どちらが正しいかを判定 → 誤っている側を修正。**判断はボスに報告**してから直す。

## 罠（パリティ設計の注意点・テストで吸収）

- **方向インデックスの対応**: TS `dirIndex` と Zig の方向順 (`DIRECTION_PAIR_INDICES=[0,2,1,3]` 等) が食い違うと偽 fail。`classifyPoint` は**両側で同一の物理方向順**を使う。既知局面で方向対応を1点検証してから全体を回す。
- **色変換**: TS `"black"/"white"` ⇄ Zig `Cell`(black=1/white=2)。
- **禁手種別の数値マッピング**: TS `"overline"→1, "double-four"→2, "double-three"→3, null→0` ⇄ Zig `ForbiddenType`。テスト内マッピング関数1箇所に閉じる。
- **盤面復元**: 両実装とも仮置き→復元する（TS undo / Zig `@constCast` 復元）。同期後の board_cells が局面と一致することを最初にアサート。
- **禁手は黒のみ**: 白の禁手ビットは比較対象外（両側0）。

## スコープ

- **オラクル対象 = `patterns.ts` ＋ `forbiddenMoves.ts`**（氷山＝連珠ルールの二重実装）。`core.ts` の `checkFive`/`checkOverline`/`getLineLength` は `checkForbiddenMove` 経由の間接観測のみで**直接は対象外**（board.zig 側、氷山外）。
- **既存 Zig 単体テスト（`forbidden.zig`/`jump_patterns.zig` の `test` 群）は維持**（縦軸＝正しさの担保。パリティは横軸＝一致の担保で、両軸を残す）。
- **既存 `renjuRules.test.ts`（人手期待値）も維持**（縦軸）。TS正しい ∧ TS==Zig ⇒ Zig正しい、の二軸担保。

### PR 分割基準（ドリフト露見への備え）

- **ドリフト0〜1件**: PR1本（テスト基盤＋export＋修正）。
- **ドリフト2件以上 or ルール解釈の判断を要する**: **テスト基盤を先行マージ**（該当局面のみ `it.skip`＋TODO化）し、ドリフト修正は後続PR。基盤を先に常駐化する。
- ドリフト修正コミットはテスト導入コミットと**分離**。

### 対象外（別issue「連珠ロジック全面Zig移植」へ）

- TS削除・本番WASM移行・メインスレッドプリロード・差分同期・バッチAPI。
- 将来 wasm ロードが CI で重くなれば `ReleaseSmall` の thin wasm（patterns+forbidden+board のみ、数十KB）を別ターゲット化（今は不要）。

## TDD 手順

1. (RED) `renjuParity.test.ts` を最小コーパス＋ `classifyPointTs` だけで書く（WASM未exportで落ちる/コンパイル不可）。
2. (GREEN) `classifyPointWasm` を export、`zig build`、WASM ラッパ（`forbiddenLoader` 不要、既存 `loadWasmModule` 利用）でテストを通す。
3. 方向対応・色変換を1点検証 → コーパス拡大。
4. 不一致が出れば最小化→ボス報告→修正（PR分割基準に従う）。
5. コーパスを #19型種局面＋実戦譜＋決定的乱数で厚くし安定化。
6. **防御の主役は CI 常駐テスト**。クロスリファレンスコメントは従（「変更すると `renjuParity.test.ts` が落ちる」と因果を併記）。`forbiddenMoves.ts`/`patterns.ts` ⇄ `forbidden.zig`/`jump_patterns.zig` 冒頭にリンク。
7. **`CLAUDE.md` に一文追加**: 「patterns.ts/forbidden.zig（連珠ルール）を触ったら `renjuParity.test.ts` が緑か確認」。メモリ更新。
8. **issue #21 にゴール再定義コメント**: 「物理的ダブルメンテ解消（TS削除）ではなく、TS⇄Zig ドリフトの CI 検出に再定義。物理統一は別issue（連珠ロジック全面Zig移植）」。クローズ条件を明記。

## ワークツリー運用

- コミット前: `cd zig && zig build` ＋ `pnpm install --frozen-lockfile --ignore-scripts` ＋ `pnpm check-fix`。
- コミットメッセージは `-m` のみ（パイプ/`$()` 禁止）。`/review` 実施。
