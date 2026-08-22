// 禁手専用 thin wasm（Issue #37 P1）
//
// メインスレッドが 48MB のエンジン wasm を載せずに「禁手判定（Zig 単一ソース）」を
// 使うための最小 wasm。`forbidden.zig` を唯一の真実とし、エンジンとは別の
// コンパイル先として出力する（依存は board.zig + jump_patterns.zig + std のみ ≒ 数十KB）。
const board = @import("board.zig");
const forbidden = @import("forbidden.zig");

export fn boardInit() void {
    board.boardInit();
}

export fn boardSet(row: u8, col: u8, value: u8) void {
    board.boardSet(row, col, value);
}

/// 候補マス（空き想定）に黒が打った場合の禁手種別を返す。
/// 0=none / 1=overline / 2=double_four / 3=double_three（黒のみ意味を持つ）。
export fn checkForbiddenPointWasm(row: u8, col: u8) u8 {
    return @intFromEnum(forbidden.checkForbiddenMove(&board.board_cells, row, col));
}

/// (row,col) が color の石として**配置済み**の盤面で、そこを含む五が成立するか。
/// 黒はちょうど 5、白は 5 以上（白に長連禁手はない・#125）。1=五 / 0=五でない。
/// TS の `renjuRules.checkFive` とのパリティ検証用の面。
export fn checkFiveWasm(row: u8, col: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (forbidden.checkFive(&board.board_cells, row, col, c)) 1 else 0;
}
