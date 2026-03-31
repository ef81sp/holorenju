const board_mod = @import("board.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;

/// renjuRules 互換の8方向ベクトル
/// [上(0), 右上(1), 右(2), 右下(3), 下(4), 左下(5), 左(6), 左上(7)]
pub const DIRECTIONS_8 = [8]struct { dr: i8, dc: i8 }{
    .{ .dr = -1, .dc = 0 }, // 0: 上
    .{ .dr = -1, .dc = 1 }, // 1: 右上
    .{ .dr = 0, .dc = 1 }, // 2: 右
    .{ .dr = 1, .dc = 1 }, // 3: 右下
    .{ .dr = 1, .dc = 0 }, // 4: 下
    .{ .dr = 1, .dc = -1 }, // 5: 左下
    .{ .dr = 0, .dc = -1 }, // 6: 左
    .{ .dr = -1, .dc = -1 }, // 7: 左上
};

/// board.zig の4方向インデックス → renjuRules の dirIndex マッピング
/// board DIRECTIONS: [横(0,1), 縦(1,0), 右下(1,1), 右上(1,-1)]
pub const DIRECTION_INDICES = [4]u8{ 2, 0, 3, 1 };

/// 逆マッピング: renjuRules dirIndex → board.zig の4方向インデックス
/// dirIndex: 0=縦→1, 1=右上→3, 2=横→0, 3=右下→2
pub const DIR_INDEX_TO_BOARD = [4]u8{ 1, 3, 0, 2 };

/// ライン上のセル状態（11マス分）
const LineCell = enum(u8) {
    empty,
    same_color,
    other, // 相手の石、盤外
};

/// 指定方向のライン（11マス）を取得
/// center_idx = 5 が仮置き位置
fn getLine(cells: []const Cell, row: u8, col: u8, dir_index: u8, color: Cell) [11]LineCell {
    var line: [11]LineCell = undefined;
    const dir1 = DIRECTIONS_8[dir_index];
    const dir2 = DIRECTIONS_8[(dir_index + 4) % 8];

    // dir2方向（負の方向）に5マス
    var i: usize = 0;
    while (i < 5) : (i += 1) {
        const dist: i16 = @as(i16, 5) - @as(i16, @intCast(i));
        const r = @as(i16, row) + @as(i16, dir2.dr) * dist;
        const c = @as(i16, col) + @as(i16, dir2.dc) * dist;
        if (board_mod.isValid(r, c)) {
            const cell = cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))];
            line[i] = if (cell == color) .same_color else if (cell == .empty) .empty else .other;
        } else {
            line[i] = .other;
        }
    }

    // 仮置き位置（index 5）
    line[5] = .same_color;

    // dir1方向（正の方向）に5マス
    i = 0;
    while (i < 5) : (i += 1) {
        const dist: i16 = @as(i16, @intCast(i)) + 1;
        const r = @as(i16, row) + @as(i16, dir1.dr) * dist;
        const c = @as(i16, col) + @as(i16, dir1.dc) * dist;
        if (board_mod.isValid(r, c)) {
            const cell = cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))];
            line[6 + i] = if (cell == color) .same_color else if (cell == .empty) .empty else .other;
        } else {
            line[6 + i] = .other;
        }
    }

    return line;
}

/// 跳び四パターンをチェック
/// 仮置きした状態でライン走査し、1つの空きを含む4石パターンを検出
/// パターン: ●●●・●, ●●・●●, ●・●●●
pub fn checkJumpFour(cells: []const Cell, row: u8, col: u8, dir_index: u8, color: Cell) bool {
    const line = getLine(cells, row, col, dir_index, color);
    const placed: usize = 5;

    // パターン1: ●●●・● (3石, 空, 1石)
    const offsets1 = [_]i8{ -4, -2, -1, 0 };
    for (offsets1) |offset| {
        const start = @as(i16, placed) + offset;
        if (start < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s] == .same_color and
            line[s + 1] == .same_color and
            line[s + 2] == .same_color and
            line[s + 3] == .empty and
            line[s + 4] == .same_color)
        {
            if (placed >= s and placed <= s + 4) return true;
        }
    }

    // パターン2: ●●・●● (2石, 空, 2石)
    const offsets2 = [_]i8{ -4, -3, -1, 0 };
    for (offsets2) |offset| {
        const start = @as(i16, placed) + offset;
        if (start < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s] == .same_color and
            line[s + 1] == .same_color and
            line[s + 2] == .empty and
            line[s + 3] == .same_color and
            line[s + 4] == .same_color)
        {
            if (placed >= s and placed <= s + 4) return true;
        }
    }

    // パターン3: ●・●●● (1石, 空, 3石)
    const offsets3 = [_]i8{ 0, -2, -3, -4 };
    for (offsets3) |offset| {
        const start = @as(i16, placed) + offset;
        if (start < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s] == .same_color and
            line[s + 1] == .empty and
            line[s + 2] == .same_color and
            line[s + 3] == .same_color and
            line[s + 4] == .same_color)
        {
            if (placed >= s and placed <= s + 4) return true;
        }
    }

    return false;
}

/// 跳び三パターンをチェック
/// パターン: ・●●・●・, ・●・●●・
pub fn checkJumpThree(cells: []const Cell, row: u8, col: u8, dir_index: u8, color: Cell) bool {
    const line = getLine(cells, row, col, dir_index, color);
    const placed: usize = 5;

    // パターン1: ・●●・●・ (空, 2石, 空, 1石, 空)
    const offsets1 = [_]i8{ -3, -1, 0 };
    for (offsets1) |offset| {
        const start = @as(i16, placed) + offset;
        if (start - 1 < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s - 1] == .empty and
            line[s] == .same_color and
            line[s + 1] == .same_color and
            line[s + 2] == .empty and
            line[s + 3] == .same_color and
            line[s + 4] == .empty)
        {
            if (placed >= s and placed <= s + 3) return true;
        }
    }

    // パターン2: ・●・●●・ (空, 1石, 空, 2石, 空)
    const offsets2 = [_]i8{ -3, -2, 0 };
    for (offsets2) |offset| {
        const start = @as(i16, placed) + offset;
        if (start - 1 < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s - 1] == .empty and
            line[s] == .same_color and
            line[s + 1] == .empty and
            line[s + 2] == .same_color and
            line[s + 3] == .same_color and
            line[s + 4] == .empty)
        {
            if (placed == s or placed == s + 2 or placed == s + 3) return true;
        }
    }

    return false;
}

/// checkOpenPattern 相当: 仮置きして連続パターン（三・四）を確認
pub const OpenPatternResult = struct {
    four: bool,
    open4: bool,
    open3: bool,
};

pub fn checkOpenPattern(cells: []const Cell, row: u8, col: u8, dir_index: u8, color: Cell) OpenPatternResult {
    const dir1 = DIRECTIONS_8[dir_index];
    const dir2 = DIRECTIONS_8[(dir_index + 4) % 8];

    // 仮置き状態でカウント
    var count1: u8 = 0;
    var r1: i16 = @as(i16, row) + dir1.dr;
    var c1: i16 = @as(i16, col) + dir1.dc;
    while (board_mod.isValid(r1, c1)) {
        const cell = cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))];
        if (cell != color) break;
        count1 += 1;
        r1 += dir1.dr;
        c1 += dir1.dc;
    }
    const end1_open = board_mod.isValid(r1, c1) and
        cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))] == .empty;

    var count2: u8 = 0;
    var r2: i16 = @as(i16, row) + dir2.dr;
    var c2: i16 = @as(i16, col) + dir2.dc;
    while (board_mod.isValid(r2, c2)) {
        const cell = cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))];
        if (cell != color) break;
        count2 += 1;
        r2 += dir2.dr;
        c2 += dir2.dc;
    }
    const end2_open = board_mod.isValid(r2, c2) and
        cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))] == .empty;

    const total = count1 + count2 + 1;

    return .{
        .four = total == 4 and (end1_open or end2_open),
        .open4 = total == 4 and end1_open and end2_open,
        .open3 = total == 3 and end1_open and end2_open,
    };
}

/// getLineLength: 指定方向の連続数（仮置きなし、既にある石を数える）
pub fn getLineLength(cells: []const Cell, row: u8, col: u8, dir_index: u8, color: Cell) u8 {
    const dir1 = DIRECTIONS_8[dir_index];
    const dir2 = DIRECTIONS_8[(dir_index + 4) % 8];

    var count1: u8 = 0;
    var r1: i16 = @as(i16, row) + dir1.dr;
    var c1: i16 = @as(i16, col) + dir1.dc;
    while (board_mod.isValid(r1, c1) and cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))] == color) {
        count1 += 1;
        r1 += dir1.dr;
        c1 += dir1.dc;
    }

    var count2: u8 = 0;
    var r2: i16 = @as(i16, row) + dir2.dr;
    var c2: i16 = @as(i16, col) + dir2.dc;
    while (board_mod.isValid(r2, c2) and cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))] == color) {
        count2 += 1;
        r2 += dir2.dr;
        c2 += dir2.dc;
    }

    return count1 + count2 + 1;
}

/// checkStraightFour: 達四点に仮置きして、その方向の四が達四かどうかを検証
pub fn checkStraightFour(cells: []const Cell, row: u8, col: u8, dir_index: u8, color: Cell) bool {
    const dir1 = DIRECTIONS_8[dir_index];
    const dir2 = DIRECTIONS_8[(dir_index + 4) % 8];

    // 仮置き
    const idx = @as(u16, row) * BOARD_SIZE + col;
    const original = cells[idx];
    @constCast(cells)[idx] = color;

    var count1: u8 = 0;
    var r1: i16 = @as(i16, row) + dir1.dr;
    var c1: i16 = @as(i16, col) + dir1.dc;
    while (board_mod.isValid(r1, c1) and cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))] == color) {
        count1 += 1;
        r1 += dir1.dr;
        c1 += dir1.dc;
    }

    var count2: u8 = 0;
    var r2: i16 = @as(i16, row) + dir2.dr;
    var c2: i16 = @as(i16, col) + dir2.dc;
    while (board_mod.isValid(r2, c2) and cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))] == color) {
        count2 += 1;
        r2 += dir2.dr;
        c2 += dir2.dc;
    }

    const total = count1 + count2 + 1;

    // 復元
    @constCast(cells)[idx] = original;

    // 4連でない場合は既存ロジックに委ねる
    if (total != 4) return true;

    // 両端が空いているかチェック
    const end1_open = board_mod.isValid(r1, c1) and
        cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))] == .empty;
    const end2_open = board_mod.isValid(r2, c2) and
        cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))] == .empty;

    if (!end1_open or !end2_open) return false;

    // 黒のみ: 両端の先に黒石がないかチェック（長連回避）
    if (color == .black) {
        const b1r = r1 + dir1.dr;
        const b1c = c1 + dir1.dc;
        if (board_mod.isValid(b1r, b1c) and cells[@intCast(@as(u16, @intCast(b1r)) * BOARD_SIZE + @as(u16, @intCast(b1c)))] == .black) {
            return false;
        }
        const b2r = r2 + dir2.dr;
        const b2c = c2 + dir2.dc;
        if (board_mod.isValid(b2r, b2c) and cells[@intCast(@as(u16, @intCast(b2r)) * BOARD_SIZE + @as(u16, @intCast(b2c)))] == .black) {
            return false;
        }
    }

    return true;
}

pub const Position = struct { row: u8, col: u8 };
pub const StraightFourPoints = struct { points: [2]Position, count: u8 };
pub const JumpThreePoint = struct { point: Position, found: bool };

/// 連続三の達四点を取得（最大2点）
pub fn getConsecutiveThreeStraightFourPoints(
    cells: []const Cell,
    row: u8,
    col: u8,
    dir_index: u8,
    color: Cell,
) StraightFourPoints {
    const dir1 = DIRECTIONS_8[dir_index];
    const dir2 = DIRECTIONS_8[(dir_index + 4) % 8];

    // 仮置き
    const idx = @as(u16, row) * BOARD_SIZE + col;
    const original = cells[idx];
    @constCast(cells)[idx] = color;

    var count1: u8 = 0;
    var r1: i16 = @as(i16, row) + dir1.dr;
    var c1: i16 = @as(i16, col) + dir1.dc;
    while (board_mod.isValid(r1, c1) and cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))] == color) {
        count1 += 1;
        r1 += dir1.dr;
        c1 += dir1.dc;
    }

    var count2: u8 = 0;
    var r2: i16 = @as(i16, row) + dir2.dr;
    var c2: i16 = @as(i16, col) + dir2.dc;
    while (board_mod.isValid(r2, c2) and cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))] == color) {
        count2 += 1;
        r2 += dir2.dr;
        c2 += dir2.dc;
    }

    const total = count1 + count2 + 1;

    // 復元
    @constCast(cells)[idx] = original;

    var result: StraightFourPoints = .{
        .points = undefined,
        .count = 0,
    };

    if (total != 3) return result;

    // 端1が空いていれば達四点
    if (board_mod.isValid(r1, c1) and cells[@intCast(@as(u16, @intCast(r1)) * BOARD_SIZE + @as(u16, @intCast(c1)))] == .empty) {
        result.points[result.count] = .{ .row = @intCast(r1), .col = @intCast(c1) };
        result.count += 1;
    }

    // 端2が空いていれば達四点
    if (board_mod.isValid(r2, c2) and cells[@intCast(@as(u16, @intCast(r2)) * BOARD_SIZE + @as(u16, @intCast(c2)))] == .empty) {
        result.points[result.count] = .{ .row = @intCast(r2), .col = @intCast(c2) };
        result.count += 1;
    }

    return result;
}

/// 跳び三の達四点を取得（最大1点）
pub fn getJumpThreeStraightFourPoints(
    cells: []const Cell,
    row: u8,
    col: u8,
    dir_index: u8,
    color: Cell,
) JumpThreePoint {
    const line = getLine(cells, row, col, dir_index, color);
    const placed: usize = 5;
    const dir1 = DIRECTIONS_8[dir_index];
    const dir2 = DIRECTIONS_8[(dir_index + 4) % 8];

    // パターン1: ・●●・●・ → 達四点は [startIdx+2]（飛びの空き）
    const offsets1 = [_]i8{ -3, -1, 0 };
    for (offsets1) |offset| {
        const start = @as(i16, placed) + offset;
        if (start - 1 < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s - 1] == .empty and
            line[s] == .same_color and
            line[s + 1] == .same_color and
            line[s + 2] == .empty and
            line[s + 3] == .same_color and
            line[s + 4] == .empty)
        {
            if (placed >= s and placed <= s + 3) {
                // 達四点の座標を計算: start+2 の位置
                const gap_offset: i16 = @as(i16, @intCast(s + 2)) - @as(i16, placed);
                const pr: i16 = if (gap_offset > 0)
                    @as(i16, row) + @as(i16, dir1.dr) * gap_offset
                else
                    @as(i16, row) + @as(i16, dir2.dr) * (-gap_offset);
                const pc: i16 = if (gap_offset > 0)
                    @as(i16, col) + @as(i16, dir1.dc) * gap_offset
                else
                    @as(i16, col) + @as(i16, dir2.dc) * (-gap_offset);
                return .{ .point = .{ .row = @intCast(pr), .col = @intCast(pc) }, .found = true };
            }
        }
    }

    // パターン2: ・●・●●・ → 達四点は [startIdx+1]（飛びの空き）
    const offsets2 = [_]i8{ -3, -2, 0 };
    for (offsets2) |offset| {
        const start = @as(i16, placed) + offset;
        if (start - 1 < 0 or start + 4 >= 11) continue;
        const s: usize = @intCast(start);
        if (line[s - 1] == .empty and
            line[s] == .same_color and
            line[s + 1] == .empty and
            line[s + 2] == .same_color and
            line[s + 3] == .same_color and
            line[s + 4] == .empty)
        {
            if (placed == s or placed == s + 2 or placed == s + 3) {
                const gap_offset: i16 = @as(i16, @intCast(s + 1)) - @as(i16, placed);
                const pr: i16 = if (gap_offset > 0)
                    @as(i16, row) + @as(i16, dir1.dr) * gap_offset
                else if (gap_offset < 0)
                    @as(i16, row) + @as(i16, dir2.dr) * (-gap_offset)
                else
                    @as(i16, row);
                const pc: i16 = if (gap_offset > 0)
                    @as(i16, col) + @as(i16, dir1.dc) * gap_offset
                else if (gap_offset < 0)
                    @as(i16, col) + @as(i16, dir2.dc) * (-gap_offset)
                else
                    @as(i16, col);
                return .{ .point = .{ .row = @intCast(pr), .col = @intCast(pc) }, .found = true };
            }
        }
    }

    return .{ .point = .{ .row = 0, .col = 0 }, .found = false };
}

// === Zig unit tests ===

test "checkJumpFour: ●●●・● pattern" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒: (7,4),(7,5),(7,6),_,(7,8) → 跳び四 ●●●・●
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    // dir_index=2 (右方向) でチェック
    // 石(7,5) から見て: 仮置き(7,5)、ライン上に (7,4)黒,(7,5)黒,(7,6)黒,空,(7,8)黒
    try std.testing.expect(checkJumpFour(&cells, 7, 5, 2, .black));
}

test "checkJumpFour: ●●・●● pattern" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒: (7,4),(7,5),_,(7,7),(7,8) → 跳び四 ●●・●●
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    try std.testing.expect(checkJumpFour(&cells, 7, 4, 2, .black));
}

test "checkJumpThree: ・●●・●・ pattern" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒: (7,5),(7,6),_,(7,8) → 仮置き(7,5): ・●●・●・
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    try std.testing.expect(checkJumpThree(&cells, 7, 5, 2, .black));
}

test "checkJumpThree: no pattern without enough stones" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    // Only 2 stones, can't form jump three
    try std.testing.expect(!checkJumpThree(&cells, 7, 5, 2, .black));
}

test "checkStraightFour basic" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒3連: (7,5),(7,6),(7,7) — 両端空き → (7,4)または(7,8)に置くと四
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    // (7,8) に仮置きすると dir_index=2 で四連になる → 達四
    try std.testing.expect(checkStraightFour(&cells, 7, 8, 2, .black));
}
