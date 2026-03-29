const board_mod = @import("board.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const scores = @import("scores.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const EndState = board_mod.EndState;
const DIRECTIONS = board_mod.DIRECTIONS;

/// パターンからスコアを計算（getPatternScore 相当）
pub fn getPatternScore(count: u8, end1: EndState, end2: EndState) i32 {
    const both_open = end1 == .empty and end2 == .empty;
    const one_open = end1 == .empty or end2 == .empty;

    return switch (count) {
        5 => scores.FIVE,
        4 => if (both_open) scores.OPEN_FOUR else if (one_open) scores.FOUR else 0,
        3 => if (both_open) scores.OPEN_THREE else if (one_open) scores.THREE else 0,
        2 => if (both_open) scores.OPEN_TWO else if (one_open) scores.TWO else 0,
        else => if (count >= 6) scores.FIVE else 0,
    };
}

/// パターンタイプ
/// 0=none, 1=five, 2=openFour, 3=four, 4=openThree, 5=three, 6=openTwo, 7=two
pub const PatternType = enum(u8) {
    none = 0,
    five = 1,
    open_four = 2,
    four = 3,
    open_three = 4,
    three = 5,
    open_two = 6,
    two = 7,
};

pub fn getPatternType(count: u8, end1: EndState, end2: EndState) PatternType {
    const both_open = end1 == .empty and end2 == .empty;
    const one_open = end1 == .empty or end2 == .empty;

    return switch (count) {
        5 => .five,
        4 => if (both_open) .open_four else if (one_open) .four else .none,
        3 => if (both_open) .open_three else if (one_open) .three else .none,
        2 => if (both_open) .open_two else if (one_open) .two else .none,
        else => if (count >= 6) .five else .none,
    };
}

/// 全4方向のパターンスコアを合算（跳びパターンは含まない）
pub fn evaluateDirectionScoresOnCells(cells: []const Cell, row: u8, col: u8, color: Cell) i32 {
    var total: i32 = 0;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

        var dir_score = getPatternScore(result.count, result.end1, result.end2);

        // 斜め方向（index 2, 3）に 1.05 倍ボーナス
        if ((i == 2 or i == 3) and dir_score > 0) {
            dir_score = @divTrunc(dir_score * 105 + 50, 100);
        }

        total += dir_score;
    }

    return total;
}

/// evaluateStonePatternsLight の結果
pub const StonePatternsResult = struct {
    score: i32,
    four_score: i32,
    open_three_score: i32,
    active_direction_count: u8,
};

/// evaluateStonePatternsLight 相当（跳びパターン込み）
/// 各方向の連続パターンスコア + 斜めボーナス + 跳びパターンを計算し、
/// fourScore, openThreeScore, activeDirectionCount を追跡
pub fn evaluateStonePatternsLightOnCells(cells: []Cell, row: u8, col: u8, color: Cell) StonePatternsResult {
    var score: i32 = 0;
    var four_score: i32 = 0;
    var open_three_score: i32 = 0;
    var active_direction_count: u8 = 0;

    // 各方向の連続パターンとそのタイプを記録
    var dir_counts: [4]u8 = undefined;
    var dir_end1s: [4]EndState = undefined;
    var dir_end2s: [4]EndState = undefined;

    // 跳び四がある方向を記録
    var jump_four_dirs: [4]bool = [_]bool{false} ** 4;
    var jump_four_count: i32 = 0;
    var has_jump_three = false;
    var has_valid_open_three = false;

    // 1st pass: 連続パターン + 跳び四検出
    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        dir_counts[i] = result.count;
        dir_end1s[i] = result.end1;
        dir_end2s[i] = result.end2;

        const base_score = getPatternScore(result.count, result.end1, result.end2);
        const pattern_type = getPatternType(result.count, result.end1, result.end2);

        if (base_score > 0) {
            active_direction_count += 1;
        }

        var final_score = base_score;
        if ((i == 2 or i == 3) and base_score > 0) {
            final_score = @divTrunc(base_score * scores.DIAGONAL_BONUS_NUM + 50, scores.DIAGONAL_BONUS_DEN);
        }

        score += final_score;

        if (pattern_type == .four) {
            four_score += final_score;
        } else if (pattern_type == .open_three) {
            open_three_score += final_score;
        }

        // 跳び四チェック: 連続四がなく跳び四がある場合
        const dir_index = jp.DIRECTION_INDICES[i];
        if (result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, color)) {
            jump_four_dirs[i] = true;
        }
    }

    // 2nd pass: 連続三の有効性、跳び四スコア、跳び三
    for (DIRECTIONS, 0..) |_, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const count = dir_counts[i];
        const end1 = dir_end1s[i];
        const end2 = dir_end2s[i];

        // 連続四チェック
        if (count == 4 and (end1 == .empty or end2 == .empty)) {
            // hasFour は analyzeJumpPatterns 内の判定
        }

        // 連続三の有効性チェック（跳び四方向でなければ）
        if (count == 3 and !jump_four_dirs[i]) {
            if (end1 == .empty and end2 == .empty) {
                if (isValidConsecutiveThree(cells, row, col, dir_index, color)) {
                    has_valid_open_three = true;
                }
            }
        }

        // 跳び四スコア
        if (jump_four_dirs[i]) {
            jump_four_count += 1;
        }

        // 跳び三チェック（連続三がない場合のみ）
        if (count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color)) {
            has_jump_three = true;
            if (isValidJumpThree(cells, row, col, dir_index, color)) {
                has_valid_open_three = true;
            }
        }
    }

    // 跳び四のスコア加算
    score += jump_four_count * scores.FOUR;
    if (jump_four_count > 0) {
        four_score += jump_four_count * scores.FOUR;
    }

    // 跳び三のスコア加算
    if (has_jump_three and has_valid_open_three) {
        score += scores.OPEN_THREE;
    }

    // hasValidOpenThree → openThreeScore に加算
    if (has_valid_open_three) {
        open_three_score += scores.OPEN_THREE;
    }

    return .{
        .score = score,
        .four_score = four_score,
        .open_three_score = open_three_score,
        .active_direction_count = active_direction_count,
    };
}

/// 連続三が有効（ウソの三でない）かをチェック
pub fn isValidConsecutiveThree(cells: []Cell, row: u8, col: u8, dir_index: u8, color: Cell) bool {
    const sfp = jp.getConsecutiveThreeStraightFourPoints(cells, row, col, dir_index, color);
    if (sfp.count == 0) return false;

    // 元の位置に石を仮置き
    const orig_idx = @as(u16, row) * board_mod.BOARD_SIZE + col;
    const original = cells[orig_idx];
    cells[orig_idx] = color;

    var valid = false;
    var i: u8 = 0;
    while (i < sfp.count) : (i += 1) {
        const p = sfp.points[i];
        // 黒のみ禁手チェック
        if (color == .black) {
            const fb = forbidden.checkForbiddenMove(cells, p.row, p.col);
            if (fb != .none) continue;
        }
        if (jp.checkStraightFour(cells, p.row, p.col, dir_index, color)) {
            valid = true;
            break;
        }
    }

    cells[orig_idx] = original;
    return valid;
}

/// 跳び三が有効（ウソの三でない）かをチェック
pub fn isValidJumpThree(cells: []Cell, row: u8, col: u8, dir_index: u8, color: Cell) bool {
    const sfp = jp.getJumpThreeStraightFourPoints(cells, row, col, dir_index, color);
    if (!sfp.found) return false;

    // 元の位置に石を仮置き
    const orig_idx = @as(u16, row) * board_mod.BOARD_SIZE + col;
    const original = cells[orig_idx];
    cells[orig_idx] = color;

    const p = sfp.point;
    var valid = false;
    if (color == .black) {
        const fb = forbidden.checkForbiddenMove(cells, p.row, p.col);
        if (fb == .none) {
            valid = jp.checkStraightFour(cells, p.row, p.col, dir_index, color);
        }
    } else {
        valid = jp.checkStraightFour(cells, p.row, p.col, dir_index, color);
    }

    cells[orig_idx] = original;
    return valid;
}

// === WASM exports ===

pub fn evaluateDirectionScores(row: u8, col: u8, color: u8) i32 {
    return evaluateDirectionScoresOnCells(&board_mod.board_cells, row, col, @enumFromInt(color));
}

pub fn wasmGetPatternScore(count: u8, end1: u8, end2: u8) i32 {
    return getPatternScore(count, @enumFromInt(end1), @enumFromInt(end2));
}

pub fn wasmGetPatternType(count: u8, end1: u8, end2: u8) u8 {
    return @intFromEnum(getPatternType(count, @enumFromInt(end1), @enumFromInt(end2)));
}

// Zig unit tests
test "getPatternScore basics" {
    try std.testing.expectEqual(getPatternScore(5, .empty, .empty), scores.FIVE);
    try std.testing.expectEqual(getPatternScore(4, .empty, .empty), scores.OPEN_FOUR);
    try std.testing.expectEqual(getPatternScore(4, .empty, .opponent), scores.FOUR);
    try std.testing.expectEqual(getPatternScore(4, .opponent, .opponent), 0);
    try std.testing.expectEqual(getPatternScore(3, .empty, .empty), scores.OPEN_THREE);
    try std.testing.expectEqual(getPatternScore(3, .empty, .edge), scores.THREE);
    try std.testing.expectEqual(getPatternScore(2, .empty, .empty), scores.OPEN_TWO);
    try std.testing.expectEqual(getPatternScore(2, .empty, .opponent), scores.TWO);
    try std.testing.expectEqual(getPatternScore(6, .empty, .empty), scores.FIVE);
    try std.testing.expectEqual(getPatternScore(1, .empty, .empty), 0);
}

test "getPatternType basics" {
    try std.testing.expectEqual(getPatternType(5, .empty, .empty), .five);
    try std.testing.expectEqual(getPatternType(4, .empty, .empty), .open_four);
    try std.testing.expectEqual(getPatternType(4, .empty, .opponent), .four);
    try std.testing.expectEqual(getPatternType(4, .opponent, .opponent), .none);
    try std.testing.expectEqual(getPatternType(3, .empty, .empty), .open_three);
    try std.testing.expectEqual(getPatternType(1, .empty, .empty), .none);
}

test "evaluateDirectionScores basic" {
    const BOARD_SIZE = board_mod.BOARD_SIZE;
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;

    // Place 3 horizontal black stones: (7,6), (7,7), (7,8)
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    // Center stone (7,7) should have open three horizontally
    const score = evaluateDirectionScoresOnCells(&cells, 7, 7, .black);
    // Should include OPEN_THREE (1000) for horizontal direction
    try std.testing.expect(score >= scores.OPEN_THREE);
}
