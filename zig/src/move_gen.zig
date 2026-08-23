/// 候補手生成
///
/// 既存石の周囲2マスのみを探索対象とし、黒番の場合は禁手を除外。
/// TS版 moveGenerator.ts に対応

const board_mod = @import("board.zig");
const forbidden = @import("forbidden.zig");
const threats = @import("threats.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
pub const Position = threats.Position;

/// 最大候補手数
pub const MAX_MOVES = 225;

/// 候補手リスト
pub const MoveList = struct {
    items: [MAX_MOVES]Position,
    len: u16,

    pub fn init() MoveList {
        return .{
            .items = undefined,
            .len = 0,
        };
    }

    pub fn push(self: *MoveList, pos: Position) void {
        if (self.len < MAX_MOVES) {
            self.items[self.len] = pos;
            self.len += 1;
        }
    }

    pub fn get(self: *const MoveList, index: u16) Position {
        return self.items[index];
    }
};

/// 候補手生成オプション
pub const GenerateMovesOptions = struct {
    skip_forbidden_check: bool = false,
};

/// 候補手を生成
pub fn generateMoves(cells: []Cell, color: Cell, options: GenerateMovesOptions) MoveList {
    var moves = MoveList.init();
    const is_black = color == .black;

    // 盤面に石があるかチェック
    if (cells[7 * BOARD_SIZE + 7] == .empty) {
        var has_stones = false;
        for (0..BOARD_SIZE) |row| {
            for (0..BOARD_SIZE) |col| {
                if (cells[@as(u16, @intCast(row)) * BOARD_SIZE + @as(u16, @intCast(col))] != .empty) {
                    has_stones = true;
                    break;
                }
            }
            if (has_stones) break;
        }
        if (!has_stones) {
            moves.push(.{ .row = 7, .col = 7 });
            return moves;
        }
    }

    // 既存石の周囲2マスを候補として収集
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            const idx = @as(u16, row) * BOARD_SIZE + col;

            // 空きマスでなければスキップ
            if (cells[idx] != .empty) continue;

            // 既存石の周囲でなければスキップ
            if (!threats.isNearFromMask(near_mask, row, col)) continue;

            // 黒番の場合は禁手チェック（五連は禁手に優先＝`forbidden.isPlayable` が
            // 「打てる点か」の SSoT。vct / quiescence も同じ述語を使う）
            if (is_black and !options.skip_forbidden_check) {
                if (!forbidden.isPlayable(cells, row, col, .black)) continue;
            }

            moves.push(.{ .row = row, .col = col });
        }
    }

    return moves;
}

// === Tests ===

test "generateMoves: empty board returns center" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const moves = generateMoves(&cells, .black, .{});
    try std.testing.expectEqual(moves.len, 1);
    try std.testing.expectEqual(moves.items[0].row, 7);
    try std.testing.expectEqual(moves.items[0].col, 7);
}

test "generateMoves: generates moves near stones" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    const moves = generateMoves(&cells, .white, .{});
    try std.testing.expect(moves.len > 0);
    // All moves should be near (7,7)
    for (0..moves.len) |i| {
        const m = moves.items[i];
        const dr = if (m.row > 7) m.row - 7 else 7 - m.row;
        const dc = if (m.col > 7) m.col - 7 else 7 - m.col;
        try std.testing.expect(dr <= 2 and dc <= 2);
    }
}

test "generateMoves: excludes forbidden moves for black" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Set up a position where (7,7) is a double-four forbidden point
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 7] = .black;

    const moves = generateMoves(&cells, .black, .{});
    // (7,7) should be excluded (double-four)
    for (0..moves.len) |i| {
        const m = moves.items[i];
        if (m.row == 7 and m.col == 7) {
            try std.testing.expect(false); // Should not contain (7,7)
        }
    }
}
