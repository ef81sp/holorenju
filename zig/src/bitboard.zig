const std = @import("std");
const board_mod = @import("board.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;

/// ライン数: 行15 + 列15 + 対角29 + 反対角29 = 88
pub const LINE_COUNT = 88;

pub const Bitboard = struct {
    black: [LINE_COUNT]u16,
    white: [LINE_COUNT]u16,
};

/// 各セル×各方向のライン情報
pub const CellLineInfo = struct {
    line_index: u8,
    bit_pos: u4, // 0-14
};

/// [row * 15 + col][direction] -> CellLineInfo
/// direction: 0=横, 1=縦, 2=右下斜め, 3=右上斜め (board.zig DIRECTIONS順)
pub const CELL_LINES: [225][4]CellLineInfo = blk: {
    var table: [225][4]CellLineInfo = undefined;
    for (0..15) |row| {
        for (0..15) |col| {
            const idx = row * 15 + col;
            // 方向0: 横 (dr=0, dc=1) → 行ライン, line_index = row, bit_pos = col
            table[idx][0] = .{ .line_index = @intCast(row), .bit_pos = @intCast(col) };
            // 方向1: 縦 (dr=1, dc=0) → 列ライン, line_index = 15 + col, bit_pos = row
            table[idx][1] = .{ .line_index = @intCast(15 + col), .bit_pos = @intCast(row) };
            // 方向2: 右下斜め (dr=1, dc=1) → 対角ライン
            // diag_id = row - col + 14 (0..28), line_index = 30 + diag_id
            // bit_pos = col - max(0, col - row) = min(row, col) からの距離...
            // On diagonal row-col=const, bit_pos = col - start_col where start_col = max(0, col-row)
            // Actually: for diagonal d = row-col+14, the line starts at:
            //   if d < 14: start = (0, 14-d) i.e. row=0, col=14-d  → bit_pos = row
            //   if d >= 14: start = (d-14, 0) i.e. row=d-14, col=0 → bit_pos = col
            // Simplified: bit_pos = min(row, col) ... no.
            // d = row - col + 14. Start cell: row_start = max(0, d-14), col_start = max(0, 14-d)
            // Position along line = row - row_start = row - max(0, d-14)
            // When d >= 14: bit_pos = row - (d - 14) = row - row + col - 14 + 14 = col
            // When d < 14: bit_pos = row - 0 = row
            // So bit_pos = min(row, col) ... let's verify:
            //   row=3, col=5: d=12 (<14), bit_pos = row = 3. Line goes (0,2),(1,3),(2,4),(3,5)... pos=3. Correct.
            //   row=5, col=3: d=16 (>=14), bit_pos = col = 3. Line goes (2,0),(3,1),(4,2),(5,3)... pos=3. Correct.
            //   row=3, col=3: d=14 (>=14), bit_pos = col = 3. Line goes (0,0),(1,1),(2,2),(3,3)... pos=3. Correct.
            table[idx][2] = .{
                .line_index = @intCast(30 + row + 14 - col),
                .bit_pos = @intCast(if (row <= col) row else col),
            };
            // 方向3: 右上斜め (dr=1, dc=-1) → 反対角ライン
            // anti_diag_id = row + col (0..28), line_index = 59 + anti_diag_id
            // Start cell: if row+col <= 14: start = (0, row+col) → bit_pos = row
            //             if row+col > 14: start = (row+col-14, 14) → bit_pos = row - (row+col-14) = 14 - col
            // Simplified: bit_pos = min(row, 14 - col)
            //   row=3, col=5: sum=8 (<=14), bit_pos = row = 3. Line goes (0,8),(1,7),(2,6),(3,5)... pos=3. Correct.
            //   row=10, col=12: sum=22 (>14), bit_pos = 14-12 = 2. Line goes (8,14),(9,13),(10,12)... pos=2. Correct.
            table[idx][3] = .{
                .line_index = @intCast(59 + row + col),
                .bit_pos = @intCast(if (row <= 14 - col) row else 14 - col),
            };
        }
    }
    break :blk table;
};

/// 各ラインの長さ
pub const LINE_LENGTHS: [LINE_COUNT]u4 = blk: {
    var lens: [LINE_COUNT]u4 = undefined;
    // 行 0-14: 長さ15
    for (0..15) |i| {
        lens[i] = 15;
    }
    // 列 15-29: 長さ15
    for (0..15) |i| {
        lens[15 + i] = 15;
    }
    // 対角 30-58: diag_id = 0..28, d = diag_id
    // 長さ = 15 - |diag_id - 14|
    for (0..29) |d| {
        const diff = if (d > 14) d - 14 else 14 - d;
        lens[30 + d] = @intCast(15 - diff);
    }
    // 反対角 59-87: anti_diag_id = 0..28
    // 長さ = 15 - |anti_diag_id - 14|  (same formula, just mirrored)
    // Wait: anti_diag_id = row + col. Range 0..28.
    // When sum=0: only (0,0), length=1. |0-14|=14, 15-14=1. Correct.
    // When sum=7: (0,7)..(7,0), length=8. |7-14|=7, 15-7=8. Correct.
    // When sum=14: (0,14)..(14,0), length=15. Correct.
    for (0..29) |d| {
        const diff = if (d > 14) d - 14 else 14 - d;
        lens[59 + d] = @intCast(15 - diff);
    }
    break :blk lens;
};

/// グローバルビットボード
pub var global_bb: Bitboard = .{ .black = .{0} ** LINE_COUNT, .white = .{0} ** LINE_COUNT };

/// cells 配列からビットボードを初期化
pub fn initFromCells(cells: []const Cell) void {
    global_bb = .{ .black = .{0} ** LINE_COUNT, .white = .{0} ** LINE_COUNT };
    for (0..225) |i| {
        const cell = cells[i];
        if (cell == .empty) continue;
        const lines = CELL_LINES[i];
        const target = if (cell == .black) &global_bb.black else &global_bb.white;
        for (0..4) |d| {
            target[lines[d].line_index] |= @as(u16, 1) << lines[d].bit_pos;
        }
    }
}

/// 石を置く（4ラインでビットセット）
pub fn placeStone(row: u8, col: u8, color: Cell) void {
    const idx = @as(usize, row) * 15 + col;
    const lines = CELL_LINES[idx];
    const target = if (color == .black) &global_bb.black else &global_bb.white;
    for (0..4) |d| {
        target[lines[d].line_index] |= @as(u16, 1) << lines[d].bit_pos;
    }
}

/// 石を取り除く（4ラインでビットクリア）
pub fn removeStone(row: u8, col: u8) void {
    const idx = @as(usize, row) * 15 + col;
    const lines = CELL_LINES[idx];
    for (0..4) |d| {
        global_bb.black[lines[d].line_index] &= ~(@as(u16, 1) << lines[d].bit_pos);
        global_bb.white[lines[d].line_index] &= ~(@as(u16, 1) << lines[d].bit_pos);
    }
}

// ============================================================
// Tests
// ============================================================

test "CELL_LINES consistency: each cell maps to valid line and bit_pos" {
    for (0..225) |i| {
        for (0..4) |d| {
            const info = CELL_LINES[i][d];
            try std.testing.expect(info.line_index < LINE_COUNT);
            try std.testing.expect(info.bit_pos < LINE_LENGTHS[info.line_index]);
        }
    }
}

test "CELL_LINES: no two cells share same (line_index, bit_pos) in same direction" {
    // For each direction, collect (line_index, bit_pos) pairs and ensure uniqueness
    for (0..4) |d| {
        var seen = [_]bool{false} ** (LINE_COUNT * 16);
        for (0..225) |i| {
            const info = CELL_LINES[i][d];
            const key = @as(usize, info.line_index) * 16 + info.bit_pos;
            try std.testing.expect(!seen[key]);
            seen[key] = true;
        }
    }
}

test "LINE_LENGTHS correctness" {
    // rows
    for (0..15) |i| {
        try std.testing.expectEqual(@as(u4, 15), LINE_LENGTHS[i]);
    }
    // cols
    for (0..15) |i| {
        try std.testing.expectEqual(@as(u4, 15), LINE_LENGTHS[15 + i]);
    }
    // main diagonal (row-col+14 = 14) should be 15
    try std.testing.expectEqual(@as(u4, 15), LINE_LENGTHS[30 + 14]);
    // corner diagonals should be 1
    try std.testing.expectEqual(@as(u4, 1), LINE_LENGTHS[30 + 0]); // row-col+14=0 → row=0,col=14
    try std.testing.expectEqual(@as(u4, 1), LINE_LENGTHS[30 + 28]); // row-col+14=28 → row=14,col=0
}

test "initFromCells and placeStone/removeStone" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * 15 + 7] = .black; // H8
    cells[7 * 15 + 8] = .black; // I8
    cells[7 * 15 + 9] = .white; // J8

    initFromCells(&cells);

    // Row 7 line: black bits at col 7 and 8
    try std.testing.expectEqual(@as(u16, (1 << 7) | (1 << 8)), global_bb.black[7]);
    // Row 7 line: white bit at col 9
    try std.testing.expectEqual(@as(u16, 1 << 9), global_bb.white[7]);

    // Remove stone at (7,8)
    removeStone(7, 8);
    try std.testing.expectEqual(@as(u16, 1 << 7), global_bb.black[7]);

    // Place white at (7,8)
    placeStone(7, 8, .white);
    try std.testing.expectEqual(@as(u16, (1 << 8) | (1 << 9)), global_bb.white[7]);
}
