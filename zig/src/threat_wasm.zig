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
const evaluate = @import("evaluate.zig");
const threats = @import("threats.zig");
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

/// (row,col) が**空き**の盤面で、そこに color を打つと四三ができるか（黒は禁手考慮）。
/// 内部で候補を仮置き・復元する（候補は空き前提）。事前に boardSet/syncBitboard で同期しておくこと。
export fn createsFourThreeWasm(row: u8, col: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (evaluate.createsFourThree(&board.board_cells, row, col, c)) 1 else 0;
}

// === detectOpponentThreats（ThreatInfo）の wire（#37 P3 PR4）===
//
// ThreatInfo = 5 リスト（open_fours/fours/open_threes/mises/double_threes、各 PositionList cap=64）。
// バッファに [u8 count][count*(u8 row, u8 col)] を 5 回連結してシリアライズする。
// 最大 5*(1 + 64*2) = 645 バイト。
var threat_info_buffer: [768]u8 = undefined;

export fn getThreatInfoBuffer() [*]u8 {
    return &threat_info_buffer;
}

fn writeList(off: usize, list: *const threats.PositionList) usize {
    var o = off;
    threat_info_buffer[o] = list.len;
    o += 1;
    for (0..list.len) |i| {
        threat_info_buffer[o] = list.items[i].row;
        threat_info_buffer[o + 1] = list.items[i].col;
        o += 2;
    }
    return o;
}

/// 相手(opponent_color)の脅威を検出し ThreatInfo をバッファにシリアライズする。
/// 事前に boardSet で cells、syncBitboard で bitboard を同期しておくこと。
export fn detectOpponentThreatsWasm(opponent_color: u8) void {
    const c: board.Cell = @enumFromInt(opponent_color);
    const info = threats.detectOpponentThreats(&board.board_cells, c);
    var o: usize = 0;
    o = writeList(o, &info.open_fours);
    o = writeList(o, &info.fours);
    o = writeList(o, &info.open_threes);
    o = writeList(o, &info.mises);
    o = writeList(o, &info.double_threes);
}
