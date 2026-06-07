# Issue #37 P1 (#40): メインスレッドの禁手を Zig 化（禁手マップキャッシュ＋thin wasm 基盤）

## 目的

北極星「戦術＝Zig、TS＝プレゼン」の最初の実例。**盤面変更時に Zig（41KB 禁手専用 thin wasm）で「黒の禁手点マップ」を1回計算 → store にキャッシュ → CpuGamePlayer は参照のみ**。thin wasm/ローダー/起動プリロード基盤を新設し、P2 以降の前提を作る。

## スコープ

- thin wasm（禁手）ビルド＋ローダー＋起動プリロード。
- 禁手マップ・キャッシュ（boardStore の盤面変更に連動して再計算）。
- `CpuGamePlayer.vue:194` の `checkForbiddenMove` をキャッシュ参照へ置換。

**対象外**: `vcfPuzzle`（P2）、worker（P3）、`forbiddenMoves.ts` 削除（P4。バレル経由で worker がまだ使う）。

## 設計確定（レビュー反映）：マップ撤回・単点判定

レビュー総意＋ボス整理で、**禁手マップ／キャッシュ／boardStore watch は撤回**。CpuGamePlayer は「クリックした1点」だけ判定すれば足り、`checkForbiddenMove` は**その1点を達四点再帰込みで完全に正しく**判定する。マップは proactive 表示や P2 の多点文脈で初めて要る（その際の影響範囲は「着手筋＋達四点再帰の近傍」。単純な4筋だと三三禁のウソの三を取りこぼす）。→ **P1 は単点 WASM 化のみ**。

## Phase 1: 禁手専用 thin wasm（資産）

### Zig

- 新規ルート `zig/src/forbidden_wasm.zig`（`board.board_cells` 利用）:
  - `boardInit()` / `boardSet(row,col,value)`（盤面同期）
  - `checkForbiddenPointWasm(row,col) u8` — `forbidden.checkForbiddenMove` の `ForbiddenType`（0=none/1=overline/2=double_four/3=double_three）を返す（黒のみ意味を持つ。候補は空きで呼ぶ）。
  - 依存は forbidden.zig + jump_patterns.zig + board.zig のみ（#21 調査で実測 ~41KB）。
- `zig/build.zig`: 2つ目の executable ターゲット（wasm32-freestanding / ReleaseFast / entry=.disabled / rdynamic）→ `zig-out/bin/forbidden.wasm`。既存 cpu-engine・test step に非干渉。
- **サイズ回帰ゲート**: `forbidden.wasm` が想定（~数十KB）に収まることを確認（誤って search 等を引かない担保）。

### TS ローダー

- `src/logic/cpu/wasm/forbiddenLoader.ts`: `loadForbiddenWasm()`。既存 `loader.ts` の node/browser 分岐 `loadWasmBuffer` を**共通化して再利用**（DRY）。`new URL(".../forbidden.wasm", import.meta.url)`。vite が自動 asset 化。
- 型 `ForbiddenWasmContext`（boardInit/boardSet/checkForbiddenPointWasm のみ。最小 ISP）。

## Phase 2: CpuGamePlayer 単点移行

- `src/logic/cpu/wasm/forbiddenAdapter.ts`（薄いアダプタ）:
  - `preloadForbiddenWasm(): Promise<void>`（起動時発火）。
  - `isForbiddenForBlack(board, row, col): boolean` — 盤面を thin wasm に全同期 → `checkForbiddenPointWasm` → `!= 0`。**wasm 未ロード時は TS `checkForbiddenMove` にフォールバック**（#21 パリティ保証下で挙動同値・クラッシュ回避。フォールバックは移行期の保険で、P4 の `forbiddenMoves.ts` 削除条件に「この経路撤去」を含める）。
- `main.ts`: `app.mount` 後に `preloadForbiddenWasm().catch(...)` を非ブロッキング発火（41KB・数ms。未ハンドル rejection を出さない）。
- `CpuGamePlayer.vue:194`: `checkForbiddenMove(...).isForbidden` を `isForbiddenForBlack(...)` に置換。`renjuRules` からの `checkForbiddenMove` 直 import を撤去。boardStore/watch/cache は触らない。

## テスト

- **#21 パリティ**が TS==WASM(単点) を保証。
- 新規 `forbiddenAdapter.test.ts`: コーパス局面の全空き点で `isForbiddenForBlack`（wasm）== TS `checkForbiddenMove(...).isForbidden`。フォールバック経路（wasm 未注入時に TS 一致）も検証。
- 既存テスト緑（CpuGamePlayer 周辺は挙動不変）。

## 検証ゲート

- `pnpm check-fix` / `pnpm test` / `zig build test`（両 wasm 生成）緑。
- `pnpm build` で `dist/assets/forbidden-*.wasm` が出る。
- 手動 or e2e: CPU 対戦で黒の禁手マークが従来通り出る。

## リスク

- 起動レース → フォールバック＋ロード後再計算で吸収。
- 2つ目 wasm のバンドル → dist 確認。
- 挙動同値 → パリティ＋マップ一致テスト。性能無関係（盤面変更時1回＝1着手1回）。

## バーンダウン（#37）

- CpuGamePlayer の `checkForbiddenMove`（バレル経由）利用を撤去。`forbiddenMoves.ts` 自体はバレル経由で worker/vcfPuzzle が使うため P1 では削除されない（P4）。

## ワークツリー運用

- コミット前: `cd zig && zig build`（両 wasm）＋ `CI=true pnpm install --frozen-lockfile --ignore-scripts`（lefthook用、worktree が main の node_modules link を当 worktree に向ける副作用あり＝worktree 削除時に main で再 install 要）＋ `pnpm check-fix`。
- ステージは個別ファイル指定（`git add -A` は deny）。
