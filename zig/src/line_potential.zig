//! ライン単位ポテンシャル評価
//!
//! 各ラインの 5-cell スライドウィンドウで「相手石なしかつ自色石数 N」の窓を集計し、
//! `LINE_POTENTIAL_TABLE[N]` で重みづけして合計する。
//!
//! 「素材の蓄積」を直接評価することで、中盤の方向性を安定させることを狙う。
//!
//! 設計:
//! - bitboard ベース（cells を見ない）。`bitboard.global_bb` が同期している前提。
//! - incremental 化前提: `placeStone`/`removeStone` で影響 4 ラインのみ再計算する。
//! - 値は `scores.LINE_POTENTIAL_TABLE` で集中管理。

const std = @import("std");
const bitboard = @import("bitboard.zig");
const scores = @import("scores.zig");

/// 単一ラインのポテンシャル値を計算する。
/// `line_bits`: 自色のビット列
/// `opp_bits`: 相手色のビット列
/// `line_len`: ラインの長さ（1..15）
pub fn computeLinePotential(line_bits: u16, opp_bits: u16, line_len: u4) i32 {
    if (line_len < 5) return 0;
    var total: i32 = 0;
    const window_count: u8 = @as(u8, line_len) - 4;
    var start: u4 = 0;
    while (start < window_count) : (start += 1) {
        const mask: u16 = @as(u16, 0x1F) << start;
        if ((opp_bits & mask) != 0) continue;
        const own_in_u16: u16 = @popCount(line_bits & mask);
        const own_in: usize = @intCast(own_in_u16);
        // sentinel [5]=0 のおかげで clamp 不要だが、念のため
        const idx = if (own_in > 5) 5 else own_in;
        total += scores.LINE_POTENTIAL_TABLE[idx];
    }
    return total;
}

/// 全ライン集計（初期化用）
pub fn computeTotal(perspective: bitboard.Bitboard, color: @import("board.zig").Cell) i32 {
    const own_lines = if (color == .black) &perspective.black else &perspective.white;
    const opp_lines = if (color == .black) &perspective.white else &perspective.black;

    var total: i32 = 0;
    for (0..bitboard.LINE_COUNT) |i| {
        const len = bitboard.LINE_LENGTHS[i];
        if (len < 5) continue;
        total += computeLinePotential(own_lines[i], opp_lines[i], len);
    }
    return total;
}

/// グローバル bitboard を使った全ライン集計
pub fn computeTotalGlobal(color: @import("board.zig").Cell) i32 {
    return computeTotal(bitboard.global_bb, color);
}

// ============================================================
// Tests
// ============================================================

const Cell = @import("board.zig").Cell;
const BOARD_SIZE = @import("board.zig").BOARD_SIZE;
const CELL_COUNT = @import("board.zig").CELL_COUNT;

test "empty line returns 0" {
    try std.testing.expectEqual(@as(i32, 0), computeLinePotential(0, 0, 15));
}

test "single own stone in line of 15" {
    // 15 cell line, 1 own stone at position 7 (center)
    // Windows that contain position 7: starts 3..7 (5 windows)
    // Each window has own=1, opp=0 → score += 3
    // Total: 5 * 3 = 15
    const own: u16 = 1 << 7;
    const result = computeLinePotential(own, 0, 15);
    try std.testing.expectEqual(@as(i32, 15), result);
}

test "two adjacent own stones" {
    // 15 cell line, stones at 7,8
    // Windows containing both: starts 4..7 = 4 windows (each has own=2 → 12)
    // Windows containing only 7: start=3 (own=1 → 3)
    // Windows containing only 8: start=8 (own=1 → 3)
    // Total: 4*12 + 3 + 3 = 54
    const own: u16 = (1 << 7) | (1 << 8);
    const result = computeLinePotential(own, 0, 15);
    try std.testing.expectEqual(@as(i32, 54), result);
}

test "blocked by opponent" {
    // own at 7, opp at 8: windows containing 8 are blocked
    // Windows containing 7 but not 8: starts 3 only (covers 3..7)
    //   start=3 → covers 3,4,5,6,7 (no 8) → own=1 → 3
    //   start=4 → covers 4..8 (has 8) → blocked
    //   ...
    // Total: 3
    const own: u16 = 1 << 7;
    const opp: u16 = 1 << 8;
    const result = computeLinePotential(own, opp, 15);
    try std.testing.expectEqual(@as(i32, 3), result);
}

test "line shorter than 5 returns 0" {
    try std.testing.expectEqual(@as(i32, 0), computeLinePotential(0xFF, 0, 4));
}

test "computeTotal symmetric: empty board returns 0" {
    var bb = bitboard.Bitboard{ .black = .{0} ** bitboard.LINE_COUNT, .white = .{0} ** bitboard.LINE_COUNT };
    try std.testing.expectEqual(@as(i32, 0), computeTotal(bb, .black));
    try std.testing.expectEqual(@as(i32, 0), computeTotal(bb, .white));
    _ = &bb;
}

test "computeTotal: single black stone gets nonzero potential" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    const black = computeTotalGlobal(.black);
    const white = computeTotalGlobal(.white);
    try std.testing.expect(black > 0);
    try std.testing.expectEqual(@as(i32, 0), white);
}

test "computeTotal: black blocked by white loses potential" {
    var cells_unblocked = [_]Cell{.empty} ** CELL_COUNT;
    cells_unblocked[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells_unblocked);
    const black_unblocked = computeTotalGlobal(.black);

    var cells_blocked = [_]Cell{.empty} ** CELL_COUNT;
    cells_blocked[7 * BOARD_SIZE + 7] = .black;
    cells_blocked[7 * BOARD_SIZE + 8] = .white;
    cells_blocked[8 * BOARD_SIZE + 7] = .white;
    cells_blocked[8 * BOARD_SIZE + 8] = .white;
    cells_blocked[6 * BOARD_SIZE + 8] = .white;
    bitboard.initFromCells(&cells_blocked);
    const black_blocked = computeTotalGlobal(.black);

    try std.testing.expect(black_blocked < black_unblocked);
}

test "computeTotal stress: doesn't crash on full-ish board" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Fill alternating
    var i: usize = 0;
    while (i < CELL_COUNT) : (i += 3) {
        cells[i] = .black;
        if (i + 1 < CELL_COUNT) cells[i + 1] = .white;
    }
    bitboard.initFromCells(&cells);
    _ = computeTotalGlobal(.black);
    _ = computeTotalGlobal(.white);
}
