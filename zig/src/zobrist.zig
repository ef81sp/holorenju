/// Zobrist Hashing
///
/// 盤面を高速にハッシュ化。XOR演算で差分更新可能。
/// comptime でテーブル生成。
/// TS版 zobrist.ts に対応

const board_mod = @import("board.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;

/// Zobrist テーブル: [row][col][color_index] => u64
/// color_index: 0 = black, 1 = white
const ZobristTable = [BOARD_SIZE][BOARD_SIZE][2]u64;

/// comptime で疑似乱数テーブルを生成
/// xoshiro256++ を使用
fn generateZobristTable() ZobristTable {
    @setEvalBranchQuota(100000);
    var table: ZobristTable = undefined;
    // Seed from a fixed value for reproducibility
    var state: [4]u64 = .{
        0x243F6A8885A308D3, // pi digits
        0x13198A2E03707344,
        0xA4093822299F31D0,
        0x082EFA98EC4E6C89,
    };

    for (0..BOARD_SIZE) |row| {
        for (0..BOARD_SIZE) |col| {
            for (0..2) |color_idx| {
                table[row][col][color_idx] = xoshiro256pp(&state);
            }
        }
    }

    return table;
}

fn xoshiro256pp(state: *[4]u64) u64 {
    const result = std.math.rotl(u64, state[0] +% state[3], 23) +% state[0];
    const t = state[1] << 17;

    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= t;
    state[3] = std.math.rotl(u64, state[3], 45);

    return result;
}

/// comptime 生成された Zobrist テーブル
const zobrist_table: ZobristTable = generateZobristTable();

/// 石の色をインデックスに変換
fn colorIndex(color: Cell) u8 {
    return switch (color) {
        .black => 0,
        .white => 1,
        .empty => unreachable,
    };
}

/// 盤面全体の Zobrist ハッシュを計算
pub fn computeBoardHash(cells: []const Cell) u64 {
    var hash: u64 = 0;

    for (0..BOARD_SIZE) |row| {
        for (0..BOARD_SIZE) |col| {
            const stone = cells[@as(u16, @intCast(row)) * BOARD_SIZE + @as(u16, @intCast(col))];
            if (stone != .empty) {
                hash ^= zobrist_table[row][col][colorIndex(stone)];
            }
        }
    }

    return hash;
}

/// ハッシュ値を差分更新
pub fn updateHash(hash: u64, row: u8, col: u8, color: Cell) u64 {
    if (color == .empty) return hash;
    return hash ^ zobrist_table[row][col][colorIndex(color)];
}

/// Zobrist テーブルの値を取得（テスト用）
pub fn getZobristValue(row: u8, col: u8, color: Cell) u64 {
    return zobrist_table[row][col][colorIndex(color)];
}

// === Tests ===

test "zobrist table is comptime generated" {
    // 異なる位置は異なるハッシュ値を持つ
    const v1 = getZobristValue(0, 0, .black);
    const v2 = getZobristValue(0, 1, .black);
    const v3 = getZobristValue(0, 0, .white);
    try std.testing.expect(v1 != v2);
    try std.testing.expect(v1 != v3);
    try std.testing.expect(v2 != v3);
}

test "empty board hash is 0" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const hash = computeBoardHash(&cells);
    try std.testing.expectEqual(hash, 0);
}

test "updateHash is reversible" {
    var hash: u64 = 0;
    hash = updateHash(hash, 7, 7, .black);
    try std.testing.expect(hash != 0);

    // XOR twice returns to 0
    hash = updateHash(hash, 7, 7, .black);
    try std.testing.expectEqual(hash, 0);
}

test "computeBoardHash matches incremental updates" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[3 * BOARD_SIZE + 5] = .white;

    const full_hash = computeBoardHash(&cells);

    // Incremental
    var inc_hash: u64 = 0;
    inc_hash = updateHash(inc_hash, 7, 7, .black);
    inc_hash = updateHash(inc_hash, 3, 5, .white);

    try std.testing.expectEqual(full_hash, inc_hash);
}
