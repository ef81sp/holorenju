# Issue #37 P2 (#41): vcfPuzzle の禁手を Zig 化（メインスレッド禁手の Zig 化完了）

## 目的

シナリオの VCF ソルバー（`vcfPuzzle.ts`、`useVcfSolver` 経由・メインスレッド）の `checkForbiddenMove` 直呼びを、P1 で作った禁手 thin wasm 経由へ移す。**完了後、メインスレッドは `forbiddenMoves.ts` を一切直接使わない**（残りはバレル経由の worker のみ＝P3/P4 対象）。

## 調査結果（前提）

- vcfPuzzle の直接 `checkForbiddenMove` は2箇所＋ループ1系統:
  - **L90 `validateAttackMove`**: 固定盤面・黒候補・単点・`.isForbidden` のみ。
  - **L140 `getDefenseResponse`**: 固定盤面・黒防御点・単点・`.isForbidden` のみ。
  - **`hasRemainingAttacks`**: 固定盤面で 225 点ループ → 各点 `validateAttackMove` → L90 の禁手判定が**最大225回/クリック**。
- `forbiddenMoves` からの直接 import は `checkForbiddenMove` のみ。`checkFive`(core)・`threatPatterns`/`threatMoves`(worker共有) は **P2 対象外**（P3/氷山外）。
- クリック駆動（着手検証）でレイテンシ非 critical。preloadForbiddenWasm（P1, main.ts 起動時）でロード猶予あり。

## 設計（レビュー反映：バッチ撤回・ミニマル単点置換）

レビュー総意で**バッチ map / getForbiddenMap / DI は撤回**。理由:

- `hasRemainingAttacks` は「blocked 分岐」時のみ実行（毎クリックでない）＋ループ内に TS の `checkFive`/`createsFour`/`cloneBoard` が225回残るため、禁手だけバッチ化しても wall-clock 改善は限定的（バッチが効くのはループ全体が Zig 化される P3+）。
- クリック駆動・非 critical。バッチは Zig 変更＋wasm 再ビルド＋DI＋新テストの面積に見合わない（YAGNI）。

→ **P1 既存の単点 `isForbiddenForBlack` で2箇所を置換するだけ。Zig 変更・wasm 再ビルド・新 API なし。**

### vcfPuzzle 置換（2箇所）

- **L90 `validateAttackMove`**: `checkForbiddenMove(board, row, col).isForbidden` → `isForbiddenForBlack(board, row, col)`。**元盤面 `board`（tempBoard でない）を渡す**点を維持。
- **L140 `getDefenseResponse`**: `checkForbiddenMove(board, defensePos.row, defensePos.col).isForbidden` → `isForbiddenForBlack(...)`。
- `forbiddenMoves` の直接 import を撤去（`isForbiddenForBlack` を import）。
- `hasRemainingAttacks` は `validateAttackMove` 経由で自動的に単点 wasm を使う（225回/「blocked」クリック。サブ ms・非 critical。遅いと計測で判明したらバッチ化を別途）。

## スコープ注記（issue #41 本文との差分）

- P2 で達成するのは「**メインスレッドが forbiddenMoves を直接 import する箇所 = 0**」（= vcfPuzzle と CpuGamePlayer のみだった直接利用が消える）。
- ただし vcfPuzzle は `threatPatterns`/`threatMoves` を import し続け、**`threatPatterns.ts` が内部で `checkForbiddenMove` を import** するため、forbiddenMoves は**transitive にはメインバンドルに残る**。issue #41 本文の「メインスレッドは forbiddenMoves/patterns を一切使わない」完全達成は **threatPatterns/threatMoves の Zig 化（P3）まで未達**。この差分を明記。

## テスト

- 既存 vcfPuzzle テスト（`vcfPuzzle.test.ts`）＋ `useVcfSolver` テストが緑（挙動不変）。
- `isForbiddenForBlack` は #21 パリティ＋P1 `forbiddenAdapter.test` で `checkForbiddenMove(...).isForbidden` と同値が担保済み → 新規テストは不要（バッチを落としたため）。

## 検証ゲート

- `pnpm check-fix` / `pnpm test` / `zig build test` 緑（P2 は Zig 変更なし）。
- シナリオ VCF パズルで禁手絡みの判定が従来通り（既存テスト＋手動）。

## バーンダウン（#37）

- **メインスレッドの `forbiddenMoves.ts` 直接 import が 0 に**（CpuGamePlayer=P1, vcfPuzzle=P2）。以降 `forbiddenMoves.ts` の利用はバレル経由の worker ＋ threatPatterns 経由の transitive のみ → P3 で worker/threatPatterns を移し、P4 で削除。

## リスク

- 挙動同値：#21 パリティ＋P1 `forbiddenAdapter.test` で `isForbiddenForBlack == checkForbiddenMove(...).isForbidden` を担保。既存 vcfPuzzle テストで vcfPuzzle 自体の挙動不変を担保。
- board 引数の取り違え（元盤面 `board` を渡す。tempBoard でない）→ 置換時に維持済み。
- 性能：`hasRemainingAttacks` は単点を最大225回/「blocked」クリック呼ぶが、クリック駆動・サブ ms で非 critical。遅いと計測で判明したらバッチ化を別途（P3+ でループ全体 Zig 化時が本命）。

## ワークツリー運用

- コミット前: `cd zig && zig build`（両 wasm）＋ `CI=true pnpm install --frozen-lockfile --ignore-scripts`（worktree が main の node_modules link を当 worktree に向ける副作用＝削除時に main 再 install 要）＋ `pnpm check-fix`。
- ステージは個別ファイル指定（`git add -A` は deny）。
