// 脅威分類専用 thin wasm（Issue #37 P3 / PR2）
//
// review worker / メインスレッド（vcfPuzzle）が、TS の `createsFour` / `createsOpenThree`
// （= 四 / 活三 判定）を **Zig 単一ソース**経由で使うための最小 wasm。
//
// 橋の本体は `vct.classifyThreat`（vct.zig）。これは TS `threatMoves.ts` の `classifyThreat`
// と 1:1 構造一致し、**黒長連除外（isJumpFourOverline / isOverlineEnd）を内包**する。
// 注意: `main.zig` の `classifyPointWasm` は生パターンビット（長連除外なし）なので**使わない**。
//
// forbidden_wasm.zig との唯一の構造差: `vct.classifyThreat` は `line_lookup.queryPatternByCell`
// 経由で `bitboard.global_bb` に依存するため、cells 同期に加えて `bitboard.initFromCells` の
// 同期（syncBitboard）が必須。
//
// vct.zig は探索スタック全体を import するが、ここから到達するのは classifyThreat の呼ぶ
// 関数のみ（Zig のデッドコード削除で thin に保たれる）。
const bitboard = @import("bitboard.zig");
const board = @import("board.zig");
const vct = @import("vct.zig");

export fn boardInit() void {
    board.boardInit();
}

export fn boardSet(row: u8, col: u8, value: u8) void {
    board.boardSet(row, col, value);
}

/// cells から bitboard.global_bb を再構築する。classifyThreatWasm の前に必ず呼ぶ。
export fn syncBitboard() void {
    bitboard.initFromCells(&board.board_cells);
}

/// (row,col) に color が**配置済み**の盤面で、四 / 活三ができるかを返す。
/// bit0 = createsFour（黒は長連除外済）, bit1 = createsOpenThree。
/// 呼び出し前に boardSet で cells を、syncBitboard で bitboard を同期しておくこと。
export fn classifyThreatWasm(row: u8, col: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    const r = vct.classifyThreat(&board.board_cells, row, col, c);
    var bits: u8 = 0;
    if (r.creates_four) bits |= 1;
    if (r.creates_open_three) bits |= 2;
    return bits;
}
