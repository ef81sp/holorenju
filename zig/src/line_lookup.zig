const std = @import("std");
const board_mod = @import("board.zig");
const bitboard = @import("bitboard.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;

pub const PatternResult = packed struct {
    count: u4, // consecutive count including center (1-15)
    end1: u2, // positive direction end: 0=empty, 1=blocked (opponent or edge)
    end2: u2, // negative direction end: 0=empty, 1=blocked
    has_jump_four: bool,
    has_jump_three: bool,
    has_raw_open_three: bool,
    _padding: u5 = 0,
};

/// [own_bits(9)][block_bits(9)] -> PatternResult
var PATTERN_TABLE: [512][512]PatternResult = undefined;
var initialized: bool = false;

pub fn init() void {
    if (initialized) return;

    for (0..512) |own_i| {
        const own: u9 = @intCast(own_i);
        for (0..512) |block_i| {
            const block: u9 = @intCast(block_i);
            PATTERN_TABLE[own_i][block_i] = computePattern(own, block);
        }
    }
    initialized = true;
}

fn computePattern(own: u9, block: u9) PatternResult {
    // Center is bit 4
    const center_bit: u9 = 1 << 4;

    // If center is not own, return empty result
    if (own & center_bit == 0) {
        return .{
            .count = 0,
            .end1 = 0,
            .end2 = 0,
            .has_jump_four = false,
            .has_jump_three = false,
            .has_raw_open_three = false,
        };
    }

    // own and block must not overlap
    // (caller should ensure this, but be defensive)

    // Count consecutive stones from center in positive direction (bits 5,6,7,8)
    var count_pos: u4 = 0;
    for (5..9) |bit| {
        if (own & (@as(u9, 1) << @intCast(bit)) != 0 and block & (@as(u9, 1) << @intCast(bit)) == 0) {
            count_pos += 1;
        } else break;
    }

    // End state in positive direction
    const end1_bit = @as(u5, 4) + 1 + count_pos;
    const end1: u2 = if (end1_bit > 8) 1 // beyond window = wall
    else if (block & (@as(u9, 1) << @intCast(end1_bit)) != 0) 1 // blocked
    else 0; // empty

    // Count consecutive stones from center in negative direction (bits 3,2,1,0)
    var count_neg: u4 = 0;
    var neg_pos: i8 = 3;
    while (neg_pos >= 0) : (neg_pos -= 1) {
        const bit: u4 = @intCast(neg_pos);
        if (own & (@as(u9, 1) << bit) != 0 and block & (@as(u9, 1) << bit) == 0) {
            count_neg += 1;
        } else break;
    }

    // End state in negative direction
    const end2: u2 = blk: {
        if (count_neg > 4) break :blk 1; // beyond window
        const end2_bit_signed: i8 = 3 - @as(i8, count_neg);
        if (end2_bit_signed < 0) break :blk 1; // beyond window = wall
        const end2_bit: u4 = @intCast(end2_bit_signed);
        if (block & (@as(u9, 1) << end2_bit) != 0) break :blk 1; // blocked
        break :blk 0; // empty
    };

    const count = 1 + count_pos + count_neg;

    // Jump four detection
    const has_jump_four = detectJumpFour(own, block);

    // Jump three detection
    const has_jump_three = detectJumpThree(own, block);

    // Raw open three: count==3, both ends empty
    const has_raw_open_three = (count == 3 and end1 == 0 and end2 == 0);

    return .{
        .count = count,
        .end1 = end1,
        .end2 = end2,
        .has_jump_four = has_jump_four,
        .has_jump_three = has_jump_three,
        .has_raw_open_three = has_raw_open_three,
    };
}

/// Detect jump four: exactly 4 stones + 1 gap in 5 consecutive positions, center(bit 4) is one of the stones.
/// Patterns: OOO_O, OO_OO, O_OOO where O=own, _=empty(not block)
fn detectJumpFour(own: u9, block: u9) bool {
    // Try all start positions s=0..4 for each pattern shape
    // 5-cell window starting at position s: bits s, s+1, s+2, s+3, s+4

    // For each start position, check that center (bit 4) is within [s, s+4]
    // and center is one of the stone positions (not the gap)

    return detectJumpFourShape(own, block, &[_]u3{ 0, 1, 2, 4 }, &[_]u3{3}) or // OOO_O
        detectJumpFourShape(own, block, &[_]u3{ 0, 1, 3, 4 }, &[_]u3{2}) or // OO_OO
        detectJumpFourShape(own, block, &[_]u3{ 0, 2, 3, 4 }, &[_]u3{1}); // O_OOO
}

fn detectJumpFourShape(own: u9, block: u9, stone_offsets: []const u3, gap_offsets: []const u3) bool {
    // Try all starting positions where bit 4 (center) is one of the stone positions
    // Start position s: actual bit = s + offset
    // We need s + offset to be in range [0, 8]
    // And center (4) must equal s + one_of(stone_offsets)

    for (0..9) |s| {
        // Check if center is at one of the stone positions
        var center_is_stone = false;
        for (stone_offsets) |off| {
            if (s + off == 4) {
                center_is_stone = true;
                break;
            }
        }
        if (!center_is_stone) continue;

        // Check all stone positions are own and not block
        var valid = true;
        for (stone_offsets) |off| {
            const bit = s + @as(usize, off);
            if (bit > 8) {
                valid = false;
                break;
            }
            const mask = @as(u9, 1) << @intCast(bit);
            if (own & mask == 0 or block & mask != 0) {
                valid = false;
                break;
            }
        }
        if (!valid) continue;

        // Check all gap positions are empty (not own and not block)
        var gaps_ok = true;
        for (gap_offsets) |off| {
            const bit = s + @as(usize, off);
            if (bit > 8) {
                gaps_ok = false;
                break;
            }
            const mask = @as(u9, 1) << @intCast(bit);
            if (own & mask != 0 or block & mask != 0) {
                gaps_ok = false;
                break;
            }
        }
        if (gaps_ok) return true;
    }
    return false;
}

/// Detect jump three: 3 stones + 1 gap in 4 consecutive positions, with empty on both sides.
/// Patterns: _OO_O_ and _O_OO_ where O=own, _=empty
fn detectJumpThree(own: u9, block: u9) bool {
    return detectJumpThreeShape(own, block, &[_]u3{ 0, 1, 3 }, &[_]u3{2}) or // _OO_O_
        detectJumpThreeShape(own, block, &[_]u3{ 0, 2, 3 }, &[_]u3{1}); // _O_OO_
}

fn detectJumpThreeShape(own: u9, block: u9, stone_offsets: []const u3, gap_offsets: []const u3) bool {
    // 6-cell pattern: empty, (4 cells with stones and gap), empty
    // stone_offsets and gap_offsets are relative to the 4-cell inner part
    // So actual pattern: bit s-1 = empty, stones at s+offset, gaps at s+offset, bit s+4 = empty

    for (0..9) |s_raw| {
        // s is the start of the 4-cell inner part. s-1 and s+4 are the flanking empties.
        if (s_raw == 0) continue; // s-1 would be negative
        const s = s_raw;
        if (s + 4 > 8) continue; // s+4 out of range

        // Check center (bit 4) is one of the stone positions
        var center_is_stone = false;
        for (stone_offsets) |off| {
            if (s + off == 4) {
                center_is_stone = true;
                break;
            }
        }
        if (!center_is_stone) continue;

        // Check flanking empties
        const left_bit = s - 1;
        const right_bit = s + 4;
        const left_mask = @as(u9, 1) << @intCast(left_bit);
        const right_mask = @as(u9, 1) << @intCast(right_bit);

        if (own & left_mask != 0 or block & left_mask != 0) continue;
        if (own & right_mask != 0 or block & right_mask != 0) continue;

        // Check stone positions
        var valid = true;
        for (stone_offsets) |off| {
            const bit = s + @as(usize, off);
            const mask = @as(u9, 1) << @intCast(bit);
            if (own & mask == 0 or block & mask != 0) {
                valid = false;
                break;
            }
        }
        if (!valid) continue;

        // Check gap positions (empty)
        var gaps_ok = true;
        for (gap_offsets) |off| {
            const bit = s + @as(usize, off);
            const mask = @as(u9, 1) << @intCast(bit);
            if (own & mask != 0 or block & mask != 0) {
                gaps_ok = false;
                break;
            }
        }
        if (gaps_ok) return true;
    }
    return false;
}

/// Extract a 9-bit window from the bitboard for a given line position.
/// Returns (own_window, block_window) where bit 4 = center position.
/// Out-of-line positions are treated as walls (block=1).
pub fn extractWindow(line_index: u8, bit_pos: u4, color: Cell) struct { own: u9, block: u9 } {
    const line_len = bitboard.LINE_LENGTHS[line_index];
    const own_line = if (color == .black) bitboard.global_bb.black[line_index] else bitboard.global_bb.white[line_index];
    const opp_line = if (color == .black) bitboard.global_bb.white[line_index] else bitboard.global_bb.black[line_index];

    var own_window: u9 = 0;
    var block_window: u9 = 0;

    // Window bits 0..8 correspond to positions (bit_pos - 4) .. (bit_pos + 4)
    for (0..9) |w| {
        const pos_signed: i8 = @as(i8, @intCast(bit_pos)) - 4 + @as(i8, @intCast(w));
        const w_bit: u4 = @intCast(w);

        if (pos_signed < 0 or pos_signed >= line_len) {
            // Out of bounds = wall (block)
            block_window |= @as(u9, 1) << w_bit;
        } else {
            const pos: u4 = @intCast(pos_signed);
            if (own_line & (@as(u16, 1) << pos) != 0) {
                own_window |= @as(u9, 1) << w_bit;
            } else if (opp_line & (@as(u16, 1) << pos) != 0) {
                block_window |= @as(u9, 1) << w_bit;
            }
            // else: empty (both 0)
        }
    }

    return .{ .own = own_window, .block = block_window };
}

/// Query pattern for a specific cell and direction using the lookup table.
pub fn queryPattern(line_index: u8, bit_pos: u4, color: Cell) PatternResult {
    if (!initialized) init();
    const w = extractWindow(line_index, bit_pos, color);
    return PATTERN_TABLE[w.own][w.block];
}

/// Convenience: query the pattern at (row, col) for `dir_index` using the
/// global bitboard. The caller must ensure that `bitboard.global_bb` is in
/// sync with the cell state at the queried position.
pub fn queryPatternByCell(row: u8, col: u8, dir_index: usize, color: Cell) PatternResult {
    if (!initialized) init();
    const cell_idx = @as(usize, row) * BOARD_SIZE + col;
    const info = bitboard.CELL_LINES[cell_idx][dir_index];
    return queryPattern(info.line_index, info.bit_pos, color);
}

/// Query pattern directly from cells array (no bitboard sync needed).
/// dir_index: 0=横, 1=縦, 2=右下斜め, 3=右上斜め (board.zig DIRECTIONS 順)
/// Useful for temporary probe positions where bitboard is not updated (VCT/VCF等).
pub fn queryPatternFromCells(cells: []const Cell, row: u8, col: u8, dir_index: usize, color: Cell) PatternResult {
    if (!initialized) init();

    const dir = board_mod.DIRECTIONS[dir_index];
    const dr: i8 = dir.dr;
    const dc: i8 = dir.dc;

    var own_window: u9 = 0;
    var block_window: u9 = 0;

    for (0..9) |w| {
        const offset: i8 = @as(i8, @intCast(w)) - 4;
        const r: i16 = @as(i16, row) + @as(i16, dr) * offset;
        const c: i16 = @as(i16, col) + @as(i16, dc) * offset;
        const w_bit: u4 = @intCast(w);

        if (!board_mod.isValid(r, c)) {
            block_window |= @as(u9, 1) << w_bit;
        } else {
            const cell = cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))];
            if (cell == color) {
                own_window |= @as(u9, 1) << w_bit;
            } else if (cell != .empty) {
                block_window |= @as(u9, 1) << w_bit;
            }
        }
    }

    return PATTERN_TABLE[own_window][block_window];
}

// ============================================================
// Tests
// ============================================================

const jump_patterns = @import("jump_patterns.zig");

test "init lookup table" {
    init();
    try std.testing.expect(initialized);
}

test "basic consecutive count" {
    init();
    // own = center only (bit 4), no block
    const r = PATTERN_TABLE[1 << 4][0];
    try std.testing.expectEqual(@as(u4, 1), r.count);
    try std.testing.expectEqual(@as(u2, 0), r.end1);
    try std.testing.expectEqual(@as(u2, 0), r.end2);
}

test "consecutive 3 with both ends empty" {
    init();
    // own bits: 3,4,5 = 0b00111000 = 0x38
    const own: u9 = (1 << 3) | (1 << 4) | (1 << 5);
    const r = PATTERN_TABLE[own][0];
    try std.testing.expectEqual(@as(u4, 3), r.count);
    try std.testing.expectEqual(@as(u2, 0), r.end1);
    try std.testing.expectEqual(@as(u2, 0), r.end2);
    try std.testing.expect(r.has_raw_open_three);
}

test "consecutive blocked by opponent" {
    init();
    // own bits: 4,5 = 0b00110000
    // block at bit 6
    const own: u9 = (1 << 4) | (1 << 5);
    const block: u9 = 1 << 6;
    const r = PATTERN_TABLE[own][block];
    try std.testing.expectEqual(@as(u4, 2), r.count);
    try std.testing.expectEqual(@as(u2, 1), r.end1); // blocked
    try std.testing.expectEqual(@as(u2, 0), r.end2); // empty
}

test "jump four OOO_O" {
    init();
    // own at 2,3,4,6 (OOO_O starting at pos 2)
    const own: u9 = (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6);
    const r = PATTERN_TABLE[own][0];
    try std.testing.expect(r.has_jump_four);
}

test "jump four OO_OO" {
    init();
    // own at 2,3,5,6 (OO_OO starting at pos 2)
    const own: u9 = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6);
    // center (4) is not a stone here... need center to be stone
    const r = PATTERN_TABLE[own][0];
    // center is not own, so count=0
    try std.testing.expectEqual(@as(u4, 0), r.count);

    // Better: own at 3,4,6,7 (OO_OO starting at pos 3)
    const own2: u9 = (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7);
    const r2 = PATTERN_TABLE[own2][0];
    try std.testing.expect(r2.has_jump_four);
}

test "jump three _OO_O_" {
    init();
    // _OO_O_ : empty at 1, own at 2,3, empty at 4... no, center must be own
    // Try: empty at 2, own at 3,4, empty at 5, own at 6, empty at 7
    // Pattern starts inner part at 3: stones at 3,4,6, gap at 5, flanking empties at 2 and 7
    // Wait, stone_offsets for _OO_O_ are {0,1,3} relative to inner start
    // Inner start = 3: stones at 3,4,6, gap at 5
    const own: u9 = (1 << 3) | (1 << 4) | (1 << 6);
    const r = PATTERN_TABLE[own][0];
    try std.testing.expect(r.has_jump_three);
}

test "extractWindow basic" {
    init();
    // Setup: place black stones at row 7, cols 6,7,8
    var cells = [_]Cell{.empty} ** 225;
    cells[7 * 15 + 6] = .black;
    cells[7 * 15 + 7] = .black;
    cells[7 * 15 + 8] = .black;
    bitboard.initFromCells(&cells);

    // Row 7 (line_index=7), bit_pos=7 (col 7), horizontal
    const w = extractWindow(7, 7, .black);
    // Positions 3..11 in the line, but window is bit_pos-4..bit_pos+4 = 3..11
    // Own at cols 6,7,8 → window bits 3,4,5
    try std.testing.expectEqual(@as(u9, (1 << 3) | (1 << 4) | (1 << 5)), w.own);
    try std.testing.expectEqual(@as(u9, 0), w.block);
}

test "extractWindow with edge" {
    init();
    var cells = [_]Cell{.empty} ** 225;
    cells[7 * 15 + 0] = .black;
    cells[7 * 15 + 1] = .black;
    bitboard.initFromCells(&cells);

    // Row 7, bit_pos=0 (col 0), horizontal
    const w = extractWindow(7, 0, .black);
    // Window positions -4..-1 are out of bounds (block), 0..4 are in bounds
    // Own at cols 0,1 → window bits 4,5
    // Block at window bits 0,1,2,3 (edges)
    try std.testing.expectEqual(@as(u9, (1 << 4) | (1 << 5)), w.own);
    try std.testing.expectEqual(@as(u9, 0b1111), w.block); // bits 0-3
}

test "queryPattern matches analyzeDirectionOnCells exhaustively" {
    init();

    const StoneSetup = struct { row: u8, col: u8, color: Cell };
    const TestBoard = struct {
        name: []const u8,
        setup: []const StoneSetup,
    };

    const test_boards = [_]TestBoard{
        .{ .name = "empty board", .setup = &.{} },
        .{
            .name = "opening",
            .setup = &.{
                .{ .row = 7, .col = 7, .color = .black },
                .{ .row = 7, .col = 8, .color = .white },
                .{ .row = 8, .col = 8, .color = .black },
                .{ .row = 6, .col = 6, .color = .white },
            },
        },
        .{
            .name = "midgame",
            .setup = &.{
                .{ .row = 7, .col = 7, .color = .black },
                .{ .row = 7, .col = 8, .color = .white },
                .{ .row = 8, .col = 8, .color = .black },
                .{ .row = 6, .col = 6, .color = .white },
                .{ .row = 6, .col = 8, .color = .black },
                .{ .row = 8, .col = 6, .color = .white },
                .{ .row = 5, .col = 9, .color = .black },
                .{ .row = 9, .col = 5, .color = .white },
                .{ .row = 9, .col = 9, .color = .black },
                .{ .row = 8, .col = 7, .color = .white },
                .{ .row = 6, .col = 7, .color = .black },
                .{ .row = 5, .col = 7, .color = .white },
                .{ .row = 10, .col = 10, .color = .black },
                .{ .row = 4, .col = 6, .color = .white },
            },
        },
        .{
            .name = "edge patterns",
            .setup = &.{
                .{ .row = 0, .col = 0, .color = .black },
                .{ .row = 0, .col = 1, .color = .black },
                .{ .row = 0, .col = 2, .color = .black },
                .{ .row = 14, .col = 12, .color = .white },
                .{ .row = 14, .col = 13, .color = .white },
                .{ .row = 14, .col = 14, .color = .white },
                .{ .row = 0, .col = 14, .color = .black },
                .{ .row = 1, .col = 13, .color = .black },
                .{ .row = 2, .col = 12, .color = .black },
            },
        },
        .{
            .name = "jump four patterns",
            .setup = &.{
                .{ .row = 3, .col = 3, .color = .black },
                .{ .row = 3, .col = 4, .color = .black },
                .{ .row = 3, .col = 5, .color = .black },
                .{ .row = 3, .col = 7, .color = .black },
                .{ .row = 5, .col = 3, .color = .white },
                .{ .row = 5, .col = 4, .color = .white },
                .{ .row = 5, .col = 6, .color = .white },
                .{ .row = 5, .col = 7, .color = .white },
                .{ .row = 2, .col = 10, .color = .black },
                .{ .row = 4, .col = 10, .color = .black },
                .{ .row = 5, .col = 10, .color = .black },
                .{ .row = 6, .col = 10, .color = .black },
            },
        },
        .{
            .name = "jump three patterns",
            .setup = &.{
                .{ .row = 2, .col = 5, .color = .black },
                .{ .row = 2, .col = 6, .color = .black },
                .{ .row = 2, .col = 8, .color = .black },
                .{ .row = 4, .col = 5, .color = .white },
                .{ .row = 4, .col = 7, .color = .white },
                .{ .row = 4, .col = 8, .color = .white },
            },
        },
        .{
            .name = "overline test",
            .setup = &.{
                // ●●●●_● pattern for black overline correction
                .{ .row = 7, .col = 3, .color = .black },
                .{ .row = 7, .col = 4, .color = .black },
                .{ .row = 7, .col = 5, .color = .black },
                .{ .row = 7, .col = 6, .color = .black },
                .{ .row = 7, .col = 8, .color = .black },
                // Diagonal overline
                .{ .row = 1, .col = 1, .color = .black },
                .{ .row = 2, .col = 2, .color = .black },
                .{ .row = 3, .col = 3, .color = .black },
                .{ .row = 4, .col = 4, .color = .black },
                .{ .row = 6, .col = 6, .color = .black },
            },
        },
        .{
            .name = "dense board",
            .setup = &.{
                .{ .row = 6, .col = 6, .color = .black },
                .{ .row = 6, .col = 7, .color = .white },
                .{ .row = 6, .col = 8, .color = .black },
                .{ .row = 7, .col = 6, .color = .white },
                .{ .row = 7, .col = 7, .color = .black },
                .{ .row = 7, .col = 8, .color = .white },
                .{ .row = 8, .col = 6, .color = .black },
                .{ .row = 8, .col = 7, .color = .white },
                .{ .row = 8, .col = 8, .color = .black },
                .{ .row = 5, .col = 5, .color = .white },
                .{ .row = 5, .col = 9, .color = .white },
                .{ .row = 9, .col = 5, .color = .white },
                .{ .row = 9, .col = 9, .color = .white },
            },
        },
    };

    var analyze_mismatches: u32 = 0;
    var jump_four_mismatches: u32 = 0;
    var jump_three_mismatches: u32 = 0;

    for (test_boards) |tb| {
        var cells = [_]Cell{.empty} ** 225;
        for (tb.setup) |s| {
            cells[@as(usize, s.row) * 15 + s.col] = s.color;
        }
        bitboard.initFromCells(&cells);

        for (0..15) |row_u| {
            for (0..15) |col_u| {
                const row: u8 = @intCast(row_u);
                const col: u8 = @intCast(col_u);
                const cell_idx = row_u * 15 + col_u;

                for ([_]Cell{ .black, .white }) |color| {
                    const current_cell = cells[cell_idx];

                    // For analyzeDirection: only test cells that already have the color
                    if (current_cell == color) {
                        for (0..4) |dir_idx| {
                            const dir = board_mod.DIRECTIONS[dir_idx];
                            const info = bitboard.CELL_LINES[cell_idx][dir_idx];
                            const ref = board_mod.analyzeDirectionOnCells(&cells, row, col, dir.dr, dir.dc, color);
                            const lut = queryPattern(info.line_index, info.bit_pos, color);

                            // Compare count
                            if (lut.count != ref.count) {
                                analyze_mismatches += 1;
                                std.debug.print("COUNT mismatch at ({},{}) dir={} color={} board={s}: ref={} lut={}\n", .{ row, col, dir_idx, @intFromEnum(color), tb.name, ref.count, lut.count });
                                continue;
                            }

                            // Compare ends: edge and opponent both map to blocked(1) in LUT
                            // Also skip overline correction: analyzeDirectionOnCells converts empty→opponent
                            // for black count==4 when there's a black stone beyond the gap. The LUT doesn't
                            // replicate this rule-specific correction, so we allow LUT=empty when ref=opponent
                            // in that specific case.
                            const ref_end1_blocked: u2 = if (ref.end1 == .empty) 0 else 1;
                            const ref_end2_blocked: u2 = if (ref.end2 == .empty) 0 else 1;

                            const is_overline_case = (color == .black and ref.count == 4);
                            var end1_ok = (lut.end1 == ref_end1_blocked);
                            var end2_ok = (lut.end2 == ref_end2_blocked);

                            // For overline correction: ref may have changed empty→opponent,
                            // but LUT still shows empty. Accept this.
                            if (is_overline_case) {
                                if (!end1_ok and ref_end1_blocked == 1 and lut.end1 == 0) end1_ok = true;
                                if (!end2_ok and ref_end2_blocked == 1 and lut.end2 == 0) end2_ok = true;
                            }

                            if (!end1_ok or !end2_ok) {
                                analyze_mismatches += 1;
                                std.debug.print("END mismatch at ({},{}) dir={} color={} board={s}: ref=({s},{s}) lut=({},{})\n", .{ row, col, dir_idx, @intFromEnum(color), tb.name, @tagName(ref.end1), @tagName(ref.end2), lut.end1, lut.end2 });
                            }
                        }
                    }

                    // For jump four/three: test ALL cells (place stone temporarily if needed)
                    // checkJumpFour/Three read from cells array, expecting the stone to be present
                    const need_temp = (current_cell == .empty);
                    if (need_temp) {
                        cells[cell_idx] = color;
                        bitboard.placeStone(row, col, color);
                    } else if (current_cell != color) {
                        continue; // cell has opponent's stone, skip
                    }

                    for (0..4) |dir_idx| {
                        const info = bitboard.CELL_LINES[cell_idx][dir_idx];
                        const lut = queryPattern(info.line_index, info.bit_pos, color);

                        const dir8_positive: u8 = switch (dir_idx) {
                            0 => 2,
                            1 => 4,
                            2 => 3,
                            3 => 5,
                            else => unreachable,
                        };
                        const dir8_negative: u8 = (dir8_positive + 4) % 8;

                        const ref_jf = jump_patterns.checkJumpFour(&cells, row, col, dir8_positive, color) or
                            jump_patterns.checkJumpFour(&cells, row, col, dir8_negative, color);

                        if (lut.has_jump_four != ref_jf) {
                            jump_four_mismatches += 1;
                            std.debug.print("JUMP4 mismatch at ({},{}) dir={} color={} board={s}: ref={} lut={}\n", .{ row, col, dir_idx, @intFromEnum(color), tb.name, ref_jf, lut.has_jump_four });
                        }

                        const ref_jt = jump_patterns.checkJumpThree(&cells, row, col, dir8_positive, color) or
                            jump_patterns.checkJumpThree(&cells, row, col, dir8_negative, color);

                        if (lut.has_jump_three != ref_jt) {
                            jump_three_mismatches += 1;
                            std.debug.print("JUMP3 mismatch at ({},{}) dir={} color={} board={s}: ref={} lut={}\n", .{ row, col, dir_idx, @intFromEnum(color), tb.name, ref_jt, lut.has_jump_three });
                        }
                    }

                    // Restore if temporarily placed
                    if (need_temp) {
                        cells[cell_idx] = .empty;
                        bitboard.removeStone(row, col);
                    }
                }
            }
        }
    }

    if (analyze_mismatches > 0) std.debug.print("Total analyze mismatches: {}\n", .{analyze_mismatches});
    if (jump_four_mismatches > 0) std.debug.print("Total jump4 mismatches: {}\n", .{jump_four_mismatches});
    if (jump_three_mismatches > 0) std.debug.print("Total jump3 mismatches: {}\n", .{jump_three_mismatches});

    try std.testing.expectEqual(@as(u32, 0), analyze_mismatches);
    try std.testing.expectEqual(@as(u32, 0), jump_four_mismatches);
    try std.testing.expectEqual(@as(u32, 0), jump_three_mismatches);
}

test "queryPatternFromCells matches queryPattern via bitboard" {
    init();
    const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Set up a position with some stones
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 8] = .white;

    bitboard.initFromCells(&cells);

    var mismatches: u32 = 0;
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            for (0..4) |dir_idx| {
                for ([_]Cell{ .black, .white }) |color| {
                    const cell_idx = @as(usize, row) * BOARD_SIZE + col;
                    const info = bitboard.CELL_LINES[cell_idx][dir_idx];
                    const bb_result = queryPattern(info.line_index, info.bit_pos, color);
                    const cells_result = queryPatternFromCells(&cells, row, col, dir_idx, color);

                    if (@as(u16, @bitCast(bb_result)) != @as(u16, @bitCast(cells_result))) {
                        mismatches += 1;
                    }
                }
            }
        }
    }
    try std.testing.expectEqual(@as(u32, 0), mismatches);
}
