const std = @import("std");

pub const BOARD_SIZE: u8 = 15;
pub const CELL_COUNT: u16 = 225;

/// 石の色
pub const Cell = enum(u8) {
    empty = 0,
    black = 1,
    white = 2,

    pub fn opposite(self: Cell) Cell {
        return switch (self) {
            .black => .white,
            .white => .black,
            .empty => .empty,
        };
    }
};

/// 端の状態
pub const EndState = enum(u8) {
    empty = 0,
    opponent = 1,
    edge = 2,
};

/// 4方向のベクトル (dr, dc)
pub const Direction = struct {
    dr: i8,
    dc: i8,
};

pub const DIRECTIONS = [4]Direction{
    .{ .dr = 0, .dc = 1 }, // 横（右）
    .{ .dr = 1, .dc = 0 }, // 縦（下）
    .{ .dr = 1, .dc = 1 }, // 右下斜め
    .{ .dr = 1, .dc = -1 }, // 右上斜め
};

/// countInDirection の結果
pub const CountResult = struct {
    count: u8,
    end_state: EndState,
};

/// analyzeDirection の結果
pub const AnalyzeResult = struct {
    count: u8,
    end1: EndState,
    end2: EndState,
};

pub fn isValid(row: i16, col: i16) bool {
    return row >= 0 and row < BOARD_SIZE and col >= 0 and col < BOARD_SIZE;
}

fn cellAt(cells: []const Cell, row: i16, col: i16) Cell {
    return cells[@intCast(@as(u16, @intCast(row)) * BOARD_SIZE + @as(u16, @intCast(col)))];
}

/// 指定方向に連続する同色石をカウントし、端の状態を返す
pub fn countInDirectionOnCells(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) CountResult {
    var count: u8 = 0;
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;

    while (isValid(r, c) and cellAt(cells, r, c) == color) {
        count += 1;
        r += dr;
        c += dc;
    }

    var end_state: EndState = .opponent;
    if (isValid(r, c)) {
        if (cellAt(cells, r, c) == .empty) {
            end_state = .empty;
        }
    } else {
        end_state = .edge;
    }

    return .{ .count = count, .end_state = end_state };
}

/// 両方向のパターンを分析
pub fn analyzeDirectionOnCells(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) AnalyzeResult {
    const pos = countInDirectionOnCells(cells, row, col, dr, dc, color);
    const neg = countInDirectionOnCells(cells, row, col, -dr, -dc, color);

    const count: u8 = pos.count + neg.count + 1;
    var end1 = pos.end_state;
    var end2 = neg.end_state;

    // 黒のオーバーライン補正: count==4 のとき空き端の先に黒石があれば塞がりとして扱う
    if (color == .black and count == 4) {
        if (end1 == .empty) {
            const br: i16 = @as(i16, row) + @as(i16, dr) * (@as(i16, pos.count) + 2);
            const bc: i16 = @as(i16, col) + @as(i16, dc) * (@as(i16, pos.count) + 2);
            if (isValid(br, bc) and cellAt(cells, br, bc) == .black) {
                end1 = .opponent;
            }
        }
        if (end2 == .empty) {
            const br: i16 = @as(i16, row) - @as(i16, dr) * (@as(i16, neg.count) + 2);
            const bc: i16 = @as(i16, col) - @as(i16, dc) * (@as(i16, neg.count) + 2);
            if (isValid(br, bc) and cellAt(cells, br, bc) == .black) {
                end2 = .opponent;
            }
        }
    }

    return .{ .count = count, .end1 = end1, .end2 = end2 };
}

// === WASM global board + exports ===

pub var board_cells: [CELL_COUNT]Cell = [_]Cell{.empty} ** CELL_COUNT;

pub fn boardInit() void {
    board_cells = [_]Cell{.empty} ** CELL_COUNT;
}

pub fn boardGet(row: u8, col: u8) u8 {
    return @intFromEnum(board_cells[@as(u16, row) * BOARD_SIZE + col]);
}

pub fn boardSet(row: u8, col: u8, value: u8) void {
    board_cells[@as(u16, row) * BOARD_SIZE + col] = @enumFromInt(value);
}

/// countInDirection WASM export — packed: count (high 8) | endState (low 8)
pub fn countInDirection(row: u8, col: u8, dr: i8, dc: i8, color: u8) u16 {
    const result = countInDirectionOnCells(&board_cells, row, col, dr, dc, @enumFromInt(color));
    return @as(u16, result.count) << 8 | @intFromEnum(result.end_state);
}

/// analyzeDirection WASM export — packed: count (bits 16-23) | end1 (bits 8-15) | end2 (bits 0-7)
pub fn analyzeDirection(row: u8, col: u8, dr: i8, dc: i8, color: u8) u32 {
    const result = analyzeDirectionOnCells(&board_cells, row, col, dr, dc, @enumFromInt(color));
    return @as(u32, result.count) << 16 | @as(u32, @intFromEnum(result.end1)) << 8 | @intFromEnum(result.end2);
}

// Zig unit tests
test "board init and set/get" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    try std.testing.expectEqual(cells[0], .empty);
    cells[7 * BOARD_SIZE + 7] = .black;
    try std.testing.expectEqual(cells[7 * BOARD_SIZE + 7], .black);
}

test "cell opposite" {
    try std.testing.expectEqual(Cell.black.opposite(), .white);
    try std.testing.expectEqual(Cell.white.opposite(), .black);
    try std.testing.expectEqual(Cell.empty.opposite(), .empty);
}

test "countInDirection basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Place 3 black stones: (7,7), (7,8), (7,9)
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[7 * BOARD_SIZE + 9] = .black;

    // From (7,7) going right
    const result = countInDirectionOnCells(&cells, 7, 7, 0, 1, .black);
    try std.testing.expectEqual(result.count, 2);
    try std.testing.expectEqual(result.end_state, .empty);
}

test "analyzeDirection both directions" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Place 4 black stones: (7,5), (7,6), (7,7), (7,8)
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    const result = analyzeDirectionOnCells(&cells, 7, 7, 0, 1, .black);
    try std.testing.expectEqual(result.count, 4);
    try std.testing.expectEqual(result.end1, .empty);
    try std.testing.expectEqual(result.end2, .empty);
}

test "analyzeDirection blocked end" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .white; // blocker
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = analyzeDirectionOnCells(&cells, 7, 6, 0, 1, .black);
    try std.testing.expectEqual(result.count, 3);
    try std.testing.expectEqual(result.end1, .empty);
    try std.testing.expectEqual(result.end2, .opponent);
}
