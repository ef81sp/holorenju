const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const ll = @import("line_lookup.zig");
const scores = @import("scores.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const EndState = board_mod.EndState;
const DIRECTIONS = board_mod.DIRECTIONS;

/// パターンからスコアを計算（getPatternScore 相当）
///
/// 五の判定は `forbidden.isFiveLength` に委ねる（SSoT・#125）。黒はちょうど 5 連、
/// 白は 5 連以上が五。**黒の 6 連以上は長連＝禁手なので五でも四でもなく 0 点**（#132）。
pub fn getPatternScore(count: u8, end1: EndState, end2: EndState, color: Cell) i32 {
    if (forbidden.isFiveLength(count, color)) return scores.FIVE;
    // ここに来る count >= 5 は黒の長連のみ（count == 5 は黒白とも五）
    if (count >= 5) return 0;

    const both_open = end1 == .empty and end2 == .empty;
    const one_open = end1 == .empty or end2 == .empty;

    return switch (count) {
        4 => if (both_open) scores.OPEN_FOUR else if (one_open) scores.FOUR else 0,
        3 => if (both_open) scores.OPEN_THREE else if (one_open) scores.THREE else 0,
        2 => if (both_open) scores.OPEN_TWO else if (one_open) scores.TWO else 0,
        else => 0,
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

/// 五の判定は `getPatternScore` と同じく `forbidden.isFiveLength`（#125）。
/// 黒の 6 連以上（長連＝禁手）は `.none`（#132）。
pub fn getPatternType(count: u8, end1: EndState, end2: EndState, color: Cell) PatternType {
    if (forbidden.isFiveLength(count, color)) return .five;
    if (count >= 5) return .none;

    const both_open = end1 == .empty and end2 == .empty;
    const one_open = end1 == .empty or end2 == .empty;

    return switch (count) {
        4 => if (both_open) .open_four else if (one_open) .four else .none,
        3 => if (both_open) .open_three else if (one_open) .three else .none,
        2 => if (both_open) .open_two else if (one_open) .two else .none,
        else => .none,
    };
}

/// 全4方向のパターンスコアを合算（跳びパターンは含まない）
pub fn evaluateDirectionScoresOnCells(cells: []const Cell, row: u8, col: u8, color: Cell) i32 {
    var total: i32 = 0;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

        var dir_score = getPatternScore(result.count, result.end1, result.end2, color);

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

/// evaluateStonePatternsLight 相当（跳びパターン込み）— LUT版
/// ビットボード + ll.queryPattern で4方向のパターンを高速取得し、
/// fourScore, openThreeScore, activeDirectionCount を追跡
pub fn evaluateStonePatternsLightOnCells(cells: []Cell, row: u8, col: u8, color: Cell) StonePatternsResult {
    var score: i32 = 0;
    var four_score: i32 = 0;
    var open_three_score: i32 = 0;
    var active_direction_count: u8 = 0;

    const cell_idx = @as(usize, row) * board_mod.BOARD_SIZE + col;

    // 各方向のLUT結果を記録
    var lut_results: [4]ll.PatternResult = undefined;
    var dir_end1s: [4]EndState = undefined;
    var dir_end2s: [4]EndState = undefined;

    // 跳び四がある方向を記録
    var jump_four_dirs: [4]bool = [_]bool{false} ** 4;
    var jump_four_count: i32 = 0;
    var has_jump_three = false;
    var has_valid_open_three = false;

    // 1st pass: LUT queryPattern + 跳び四検出
    for (0..4) |i| {
        const info = bitboard.CELL_LINES[cell_idx][i];
        const result = ll.queryPattern(info.line_index, info.bit_pos, color);
        lut_results[i] = result;

        // LUT の end 値を EndState に変換
        const end1 = lutEndToEndState(result.end1);
        const end2 = lutEndToEndState(result.end2);

        // 黒のオーバーライン補正: count==4 かつ空き端の先に黒石があれば blocked 扱い
        var adj_end1 = end1;
        var adj_end2 = end2;
        if (color == .black and result.count == 4) {
            if (adj_end1 == .empty) {
                adj_end1 = checkOverlineEnd(cells, row, col, i, true);
            }
            if (adj_end2 == .empty) {
                adj_end2 = checkOverlineEnd(cells, row, col, i, false);
            }
        }

        dir_end1s[i] = adj_end1;
        dir_end2s[i] = adj_end2;

        const base_score = getPatternScore(result.count, adj_end1, adj_end2, color);
        const pattern_type = getPatternType(result.count, adj_end1, adj_end2, color);

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

        // 跳び四チェック: 連続四がなく LUT が跳び四を検出
        if (result.count != 4 and result.has_jump_four) {
            jump_four_dirs[i] = true;
        }
    }

    // 2nd pass: 連続三の有効性、跳び四スコア、跳び三
    for (0..4) |i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const count = lut_results[i].count;
        const end1 = dir_end1s[i];
        const end2 = dir_end2s[i];

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

        // 跳び三チェック: LUT の has_jump_three で事前フィルタ（連続三がない場合のみ）
        if (count != 3 and lut_results[i].has_jump_three) {
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

/// LUT の end (0=empty, 1=blocked) を EndState に変換
/// blocked のうち edge か opponent かを判定
fn lutEndToEndState(lut_end: u2) EndState {
    if (lut_end == 0) return .empty;
    // LUT では edge と opponent を区別しない（both = blocked）
    // getPatternScore は edge も opponent も同じスコアを返すため、
    // opponent として扱っても結果は同じ
    return .opponent;
}

/// 黒のオーバーライン補正: count==4 の空き端の先に黒石があるかチェック
fn checkOverlineEnd(cells: []const Cell, row: u8, col: u8, dir_idx: usize, is_positive: bool) EndState {
    const dir = DIRECTIONS[dir_idx];
    const dr: i8 = if (is_positive) dir.dr else -dir.dr;
    const dc: i8 = if (is_positive) dir.dc else -dir.dc;

    // Count consecutive own stones from center in this direction
    var consecutive: i16 = 0;
    var r: i16 = @as(i16, row) + @as(i16, dr);
    var c: i16 = @as(i16, col) + @as(i16, dc);
    while (r >= 0 and r < board_mod.BOARD_SIZE and c >= 0 and c < board_mod.BOARD_SIZE) {
        const idx = @as(u16, @intCast(r)) * board_mod.BOARD_SIZE + @as(u16, @intCast(c));
        if (cells[idx] != .black) break;
        consecutive += 1;
        r += @as(i16, dr);
        c += @as(i16, dc);
    }

    // The end is at the empty cell. Check 1 further past it for a black stone (overline).
    const check_r = @as(i16, row) + @as(i16, dr) * (consecutive + 2);
    const check_c = @as(i16, col) + @as(i16, dc) * (consecutive + 2);
    if (board_mod.isValid(check_r, check_c)) {
        const check_idx = @as(u16, @intCast(check_r)) * board_mod.BOARD_SIZE + @as(u16, @intCast(check_c));
        if (cells[check_idx] == .black) {
            return .opponent; // Treat as blocked for overline
        }
    }
    return .empty;
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

pub fn wasmGetPatternScore(count: u8, end1: u8, end2: u8, color: u8) i32 {
    return getPatternScore(count, @enumFromInt(end1), @enumFromInt(end2), @enumFromInt(color));
}

pub fn wasmGetPatternType(count: u8, end1: u8, end2: u8, color: u8) u8 {
    return @intFromEnum(getPatternType(count, @enumFromInt(end1), @enumFromInt(end2), @enumFromInt(color)));
}

// Zig unit tests
test "getPatternScore basics" {
    try std.testing.expectEqual(getPatternScore(5, .empty, .empty, .black), scores.FIVE);
    try std.testing.expectEqual(getPatternScore(5, .empty, .empty, .white), scores.FIVE);
    try std.testing.expectEqual(getPatternScore(4, .empty, .empty, .black), scores.OPEN_FOUR);
    try std.testing.expectEqual(getPatternScore(4, .empty, .opponent, .black), scores.FOUR);
    try std.testing.expectEqual(getPatternScore(4, .opponent, .opponent, .black), 0);
    try std.testing.expectEqual(getPatternScore(3, .empty, .empty, .black), scores.OPEN_THREE);
    try std.testing.expectEqual(getPatternScore(3, .empty, .edge, .black), scores.THREE);
    try std.testing.expectEqual(getPatternScore(2, .empty, .empty, .black), scores.OPEN_TWO);
    try std.testing.expectEqual(getPatternScore(2, .empty, .opponent, .black), scores.TWO);
    try std.testing.expectEqual(getPatternScore(1, .empty, .empty, .black), 0);
}

// #132: 黒の長連（6 連以上）は禁手なので五でも四でもない。白は五のまま。
test "getPatternScore: 黒の長連は 0 点・白の長連は五" {
    var count: u8 = 6;
    while (count <= 10) : (count += 1) {
        try std.testing.expectEqual(getPatternScore(count, .empty, .empty, .black), 0);
        try std.testing.expectEqual(getPatternScore(count, .opponent, .opponent, .black), 0);
        try std.testing.expectEqual(getPatternScore(count, .empty, .empty, .white), scores.FIVE);
    }
}

test "getPatternType basics" {
    try std.testing.expectEqual(getPatternType(5, .empty, .empty, .black), .five);
    try std.testing.expectEqual(getPatternType(5, .empty, .empty, .white), .five);
    try std.testing.expectEqual(getPatternType(4, .empty, .empty, .black), .open_four);
    try std.testing.expectEqual(getPatternType(4, .empty, .opponent, .black), .four);
    try std.testing.expectEqual(getPatternType(4, .opponent, .opponent, .black), .none);
    try std.testing.expectEqual(getPatternType(3, .empty, .empty, .black), .open_three);
    try std.testing.expectEqual(getPatternType(1, .empty, .empty, .black), .none);
}

// #132: 黒の長連は .none（五でも四でもない）。白は .five。
test "getPatternType: 黒の長連は none・白の長連は five" {
    var count: u8 = 6;
    while (count <= 10) : (count += 1) {
        try std.testing.expectEqual(getPatternType(count, .empty, .empty, .black), .none);
        try std.testing.expectEqual(getPatternType(count, .empty, .empty, .white), .five);
    }
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
