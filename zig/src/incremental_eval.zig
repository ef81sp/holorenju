const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const line_potential = @import("line_potential.zig");
const ll = @import("line_lookup.zig");
const patterns = @import("patterns.zig");
const scores = @import("scores.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;

const VERIFY_INCREMENTAL = @import("builtin").mode == .Debug;

/// 石ごとのキャッシュエントリ
const StoneEntry = struct {
    score: i32 = 0, // adjusted_score (pattern + connectivity bonus)
    four_score: i32 = 0,
    open_three_score: i32 = 0,
    pending_four_penalty: i32 = 0,
    color: Cell = .empty,
};

/// 色ごとの集計値
const ColorAggregates = struct {
    total_score: i32 = 0,
    four_score: i32 = 0,
    open_three_score: i32 = 0,
    stone_count: u16 = 0,
    pending_four_penalty: i32 = 0,
};

/// インクリメンタル評価の状態
pub const IncrementalEvalState = struct {
    cache: [CELL_COUNT]StoneEntry = [_]StoneEntry{.{}} ** CELL_COUNT,
    black: ColorAggregates = .{},
    white: ColorAggregates = .{},
    connectivity_bonus: i32 = 0,
    single_four_penalty_multiplier: i32 = 100,
    /// Phase B: ラインポテンシャル評価（各色の全ライン集計値）
    /// `computeLinePotential` の総和で、`placeStone`/`removeStone` で影響 4 ラインを差分更新。
    line_potential_black: i32 = 0,
    line_potential_white: i32 = 0,

    fn aggregatesFor(self: *IncrementalEvalState, color: Cell) *ColorAggregates {
        return switch (color) {
            .black => &self.black,
            .white => &self.white,
            .empty => unreachable,
        };
    }

    fn subtractFromAggregates(self: *IncrementalEvalState, idx: u16) void {
        const entry = &self.cache[idx];
        if (entry.color == .empty) return;
        const agg = self.aggregatesFor(entry.color);
        agg.total_score -= entry.score;
        agg.four_score -= entry.four_score;
        agg.open_three_score -= entry.open_three_score;
        agg.pending_four_penalty -= entry.pending_four_penalty;
        agg.stone_count -= 1;
    }

    fn addToAggregates(self: *IncrementalEvalState, idx: u16) void {
        const entry = &self.cache[idx];
        if (entry.color == .empty) return;
        const agg = self.aggregatesFor(entry.color);
        agg.total_score += entry.score;
        agg.four_score += entry.four_score;
        agg.open_three_score += entry.open_three_score;
        agg.pending_four_penalty += entry.pending_four_penalty;
        agg.stone_count += 1;
    }

    fn reEvaluateStone(self: *IncrementalEvalState, idx: u16, cells: []Cell) void {
        const row: u8 = @intCast(idx / BOARD_SIZE);
        const col: u8 = @intCast(idx % BOARD_SIZE);
        const color = cells[idx];

        if (color == .empty) {
            self.cache[idx] = .{};
            return;
        }

        const result = patterns.evaluateStonePatternsLightOnCells(cells, row, col, color);
        var adjusted_score = result.score;

        if (result.active_direction_count >= 2 and self.connectivity_bonus > 0) {
            adjusted_score += self.connectivity_bonus * (@as(i32, result.active_direction_count) - 1);
        }

        const multiplier = self.single_four_penalty_multiplier;
        var pending_four_penalty: i32 = 0;
        if (multiplier < 100 and result.four_score > 0 and result.open_three_score == 0) {
            pending_four_penalty = @divTrunc(result.four_score * (100 - multiplier), 100);
        }

        self.cache[idx] = .{
            .score = adjusted_score,
            .four_score = result.four_score,
            .open_three_score = result.open_three_score,
            .pending_four_penalty = pending_four_penalty,
            .color = color,
        };
    }
};

pub var eval_state: IncrementalEvalState = .{};

/// initFromBoard のオプション（旧: 位置引数2つ）。
pub const InitOptions = struct {
    connectivity_bonus: i32,
    single_four_penalty_multiplier: i32 = 100,
};

/// 全石を走査してキャッシュと集計値を構築
pub fn initFromBoard(cells: []Cell, opts: InitOptions) void {
    eval_state = .{
        .connectivity_bonus = opts.connectivity_bonus,
        .single_four_penalty_multiplier = opts.single_four_penalty_multiplier,
    };

    // LUT版 evaluateStonePatternsLightOnCells が bitboard を使うため同期
    ll.init();
    bitboard.initFromCells(cells);

    for (0..CELL_COUNT) |i| {
        const idx: u16 = @intCast(i);
        if (cells[idx] == .empty) continue;

        eval_state.reEvaluateStone(idx, cells);
        eval_state.addToAggregates(idx);
    }

    // Phase B: ラインポテンシャル初期化（全ライン一括集計）
    eval_state.line_potential_black = line_potential.computeTotalGlobal(.black);
    eval_state.line_potential_white = line_potential.computeTotalGlobal(.white);
}

/// 4方向 × 距離5以内の非空マスを収集（自身も含む）
pub fn collectAffectedPositions(cells: []const Cell, row: u8, col: u8, buf: *[41]u16) u8 {
    var count: u8 = 0;
    // 重複防止用ビットセット
    var seen = std.StaticBitSet(CELL_COUNT).initEmpty();

    const self_idx = @as(u16, row) * BOARD_SIZE + col;
    if (cells[self_idx] != .empty) {
        buf[count] = self_idx;
        count += 1;
        seen.set(self_idx);
    }

    for (DIRECTIONS) |dir| {
        // 正方向と負方向
        inline for (.{ @as(i8, 1), @as(i8, -1) }) |sign| {
            const dr: i8 = dir.dr * sign;
            const dc: i8 = dir.dc * sign;
            var r: i16 = @as(i16, row) + dr;
            var c: i16 = @as(i16, col) + dc;
            var dist: u8 = 0;
            while (dist < 5 and board_mod.isValid(r, c)) : (dist += 1) {
                const idx: u16 = @intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)));
                if (cells[idx] != .empty and !seen.isSet(idx)) {
                    buf[count] = idx;
                    count += 1;
                    seen.set(idx);
                }
                r += dr;
                c += dc;
            }
        }
    }

    return count;
}

/// 石を配置し、影響範囲の石を差分更新
pub fn placeStone(cells: []Cell, row: u8, col: u8, color: Cell) void {
    const self_idx = @as(u16, row) * BOARD_SIZE + col;
    if (VERIFY_INCREMENTAL) {
        std.debug.assert(cells[self_idx] == .empty);
    }

    var buf: [41]u16 = undefined;

    // 配置前: 既存石リストを取得（配置先は空なので含まれない）
    const affected_count = collectAffectedPositions(cells, row, col, &buf);

    // 既存石の old scores を subtract
    for (buf[0..affected_count]) |idx| {
        eval_state.subtractFromAggregates(idx);
    }

    // Phase B: 影響を受ける 4 ラインの変更前ポテンシャルを差し引く
    const lines_info = bitboard.CELL_LINES[self_idx];
    subtractLinePotential(lines_info);

    // 盤面更新
    cells[self_idx] = color;
    bitboard.placeStone(row, col, color);

    // Phase B: 変更後ポテンシャルを加える
    addLinePotential(lines_info);

    // 新石自身を affected リストに追加
    buf[affected_count] = self_idx;
    const total_count = affected_count + 1;

    // 全 affected 石を re-eval & add
    for (buf[0..total_count]) |idx| {
        eval_state.reEvaluateStone(idx, cells);
        eval_state.addToAggregates(idx);
    }
}

/// 石を除去し、影響範囲の石を差分更新
pub fn removeStone(cells: []Cell, row: u8, col: u8) void {
    var buf: [41]u16 = undefined;

    // 除去前: 影響石リストを取得（除去石含む）
    const affected_count = collectAffectedPositions(cells, row, col, &buf);

    // old scores を subtract
    for (buf[0..affected_count]) |idx| {
        eval_state.subtractFromAggregates(idx);
    }

    // 盤面更新
    const self_idx = @as(u16, row) * BOARD_SIZE + col;

    // Phase B: 影響を受ける 4 ラインの変更前ポテンシャルを差し引く
    const lines_info = bitboard.CELL_LINES[self_idx];
    subtractLinePotential(lines_info);

    cells[self_idx] = .empty;
    bitboard.removeStone(row, col);

    // Phase B: 変更後ポテンシャルを加える
    addLinePotential(lines_info);

    // 除去石のキャッシュをクリア
    eval_state.cache[self_idx] = .{};

    // 残存石を re-eval & add（除去石は skip）
    for (buf[0..affected_count]) |idx| {
        if (idx == self_idx) continue;
        eval_state.reEvaluateStone(idx, cells);
        eval_state.addToAggregates(idx);
    }
}

/// 指定された 4 ラインの現在のポテンシャル値を eval_state から差し引く
fn subtractLinePotential(lines: [4]bitboard.CellLineInfo) void {
    for (lines) |info| {
        const len = bitboard.LINE_LENGTHS[info.line_index];
        const black_line = bitboard.global_bb.black[info.line_index];
        const white_line = bitboard.global_bb.white[info.line_index];
        eval_state.line_potential_black -= line_potential.computeLinePotential(black_line, white_line, len);
        eval_state.line_potential_white -= line_potential.computeLinePotential(white_line, black_line, len);
    }
}

/// 指定された 4 ラインの現在のポテンシャル値を eval_state に加える
fn addLinePotential(lines: [4]bitboard.CellLineInfo) void {
    for (lines) |info| {
        const len = bitboard.LINE_LENGTHS[info.line_index];
        const black_line = bitboard.global_bb.black[info.line_index];
        const white_line = bitboard.global_bb.white[info.line_index];
        eval_state.line_potential_black += line_potential.computeLinePotential(black_line, white_line, len);
        eval_state.line_potential_white += line_potential.computeLinePotential(white_line, black_line, len);
    }
}

/// 集計値から評価値を計算（evaluateBoardOnCells と同等のロジック）
pub fn getEvaluation(cells: []Cell, perspective: Cell, options: evaluate.EvalOptions) i32 {
    return getEvaluationLegacy(cells, perspective, options);
}

/// legacy（石ベース）基底での評価値計算。旧 getEvaluation 本体。
fn getEvaluationLegacy(cells: []Cell, perspective: Cell, options: evaluate.EvalOptions) i32 {
    const my_agg = switch (perspective) {
        .black => eval_state.black,
        .white => eval_state.white,
        .empty => unreachable,
    };
    const opp_agg = switch (perspective) {
        .black => eval_state.white,
        .white => eval_state.black,
        .empty => unreachable,
    };

    var my_score = my_agg.total_score;
    var opp_score = opp_agg.total_score;

    // テンポ補正
    if (options.last_mover_is_perspective == .yes) {
        my_score -= @divTrunc(my_agg.open_three_score * scores.TEMPO_OPEN_THREE_DISCOUNT_NUM, scores.TEMPO_OPEN_THREE_DISCOUNT_DEN);
    } else if (options.last_mover_is_perspective == .no) {
        opp_score -= @divTrunc(opp_agg.open_three_score * scores.TEMPO_OPEN_THREE_DISCOUNT_NUM, scores.TEMPO_OPEN_THREE_DISCOUNT_DEN);
    }

    // 四三脅威スキャン
    const opponent = perspective.opposite();
    const my_has_four_three = evaluate.scanFourThreeThreat(cells, perspective, my_agg.stone_count);
    const opp_has_four_three = evaluate.scanFourThreeThreat(cells, opponent, opp_agg.stone_count);

    if (scores.LEAF_FOUR_THREE_THREAT > 0) {
        if (my_has_four_three) my_score += scores.LEAF_FOUR_THREE_THREAT;
        if (opp_has_four_three) opp_score += scores.LEAF_FOUR_THREE_THREAT;
    }

    // ミセ手脅威推定
    if (options.enable_leaf_mise and scores.LEAF_MISE_THREAT > 0) {
        if (!my_has_four_three and evaluate.estimateMiseOpportunity(my_agg.four_score, my_agg.open_three_score)) {
            my_score += scores.LEAF_MISE_THREAT;
        }
        if (!opp_has_four_three and evaluate.estimateMiseOpportunity(opp_agg.four_score, opp_agg.open_three_score)) {
            opp_score += scores.LEAF_MISE_THREAT;
        }
    }

    // 四三脅威がなければ単発四ペナルティ適用
    if (!my_has_four_three) my_score -= my_agg.pending_four_penalty;
    if (!opp_has_four_three) opp_score -= opp_agg.pending_four_penalty;

    // Phase B: ラインポテンシャル加算（テンポ補正・ペナルティの対象外、純粋加算）
    const my_potential = switch (perspective) {
        .black => eval_state.line_potential_black,
        .white => eval_state.line_potential_white,
        .empty => unreachable,
    };
    const opp_potential = switch (perspective) {
        .black => eval_state.line_potential_white,
        .white => eval_state.line_potential_black,
        .empty => unreachable,
    };
    my_score += my_potential;
    opp_score += opp_potential;

    const result = my_score - opp_score;

    if (VERIFY_INCREMENTAL) {
        const full_result = evaluate.evaluateBoardOnCells(cells, perspective, options);
        if (result != full_result) {
            std.debug.print("INCREMENTAL MISMATCH: incremental={d}, full={d}\n", .{ result, full_result });
            std.debug.assert(result == full_result);
        }
    }

    return result;
}

// === Zig unit tests ===

test "initFromBoard matches evaluateBoardOnCells on empty board" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });
    const inc_result = getEvaluation(&cells, .black, options);
    const full_result = evaluate.evaluateBoardOnCells(&cells, .black, options);
    try std.testing.expectEqual(inc_result, full_result);
}

test "initFromBoard matches evaluateBoardOnCells with stones" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Black horizontal 3
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    // White horizontal 3
    cells[3 * BOARD_SIZE + 6] = .white;
    cells[3 * BOARD_SIZE + 7] = .white;
    cells[3 * BOARD_SIZE + 8] = .white;

    const options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });

    const inc_black = getEvaluation(&cells, .black, options);
    const full_black = evaluate.evaluateBoardOnCells(&cells, .black, options);
    try std.testing.expectEqual(inc_black, full_black);

    const inc_white = getEvaluation(&cells, .white, options);
    const full_white = evaluate.evaluateBoardOnCells(&cells, .white, options);
    try std.testing.expectEqual(inc_white, full_white);
}

test "placeStone then getEvaluation matches full evaluation" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Initial position: two black stones
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[6 * BOARD_SIZE + 7] = .white;

    const options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });

    // Place a new black stone
    placeStone(&cells, 7, 9, .black);

    const inc_result = getEvaluation(&cells, .black, options);
    const full_result = evaluate.evaluateBoardOnCells(&cells, .black, options);
    try std.testing.expectEqual(inc_result, full_result);
}

test "removeStone restores evaluation" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[7 * BOARD_SIZE + 9] = .black;
    cells[6 * BOARD_SIZE + 7] = .white;

    const options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });
    const before = getEvaluation(&cells, .black, options);

    // Place then remove
    placeStone(&cells, 7, 10, .black);
    removeStone(&cells, 7, 10);

    const after = getEvaluation(&cells, .black, options);
    try std.testing.expectEqual(before, after);
}

test "placeStone with tempo correction matches" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[3 * BOARD_SIZE + 6] = .white;
    cells[3 * BOARD_SIZE + 7] = .white;

    const options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .yes,
        .single_four_penalty_multiplier = 80,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });

    placeStone(&cells, 3, 8, .white);

    const inc_result = getEvaluation(&cells, .black, options);
    const full_result = evaluate.evaluateBoardOnCells(&cells, .black, options);
    try std.testing.expectEqual(inc_result, full_result);
}

test "placeStone with leaf mise threat matches" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Black: four candidate + open three candidate
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    // vertical open three setup
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[6 * BOARD_SIZE + 5] = .black;

    cells[3 * BOARD_SIZE + 3] = .white;
    cells[3 * BOARD_SIZE + 4] = .white;

    const options = evaluate.EvalOptions{
        .enable_leaf_mise = true,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });

    const inc_result = getEvaluation(&cells, .black, options);
    const full_result = evaluate.evaluateBoardOnCells(&cells, .black, options);
    try std.testing.expectEqual(inc_result, full_result);
}

test "multiple place and remove sequence" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const options = evaluate.EvalOptions{
        .enable_leaf_mise = true,
        .last_mover_is_perspective = .no,
        .single_four_penalty_multiplier = 70,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };
    initFromBoard(&cells, .{ .connectivity_bonus = options.connectivity_bonus, .single_four_penalty_multiplier = options.single_four_penalty_multiplier });

    // Simulate a game sequence
    const moves = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 7, .c = 7, .color = .black },
        .{ .r = 7, .c = 8, .color = .white },
        .{ .r = 8, .c = 7, .color = .black },
        .{ .r = 6, .c = 8, .color = .white },
        .{ .r = 9, .c = 7, .color = .black },
        .{ .r = 5, .c = 8, .color = .white },
        .{ .r = 6, .c = 6, .color = .black },
        .{ .r = 4, .c = 8, .color = .white },
    };

    for (moves) |m| {
        placeStone(&cells, m.r, m.c, m.color);

        const inc_b = getEvaluation(&cells, .black, options);
        const full_b = evaluate.evaluateBoardOnCells(&cells, .black, options);
        try std.testing.expectEqual(inc_b, full_b);

        const inc_w = getEvaluation(&cells, .white, options);
        const full_w = evaluate.evaluateBoardOnCells(&cells, .white, options);
        try std.testing.expectEqual(inc_w, full_w);
    }

    // Undo all moves in reverse
    var i: usize = moves.len;
    while (i > 0) {
        i -= 1;
        removeStone(&cells, moves[i].r, moves[i].c);

        const inc_b = getEvaluation(&cells, .black, options);
        const full_b = evaluate.evaluateBoardOnCells(&cells, .black, options);
        try std.testing.expectEqual(inc_b, full_b);
    }
}

test "collectAffectedPositions basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[7 * BOARD_SIZE + 10] = .white;

    var buf: [41]u16 = undefined;
    const count = collectAffectedPositions(&cells, 7, 9, &buf);

    // Should find: (7,7), (7,8), (7,10) — all within distance 5 on horizontal
    try std.testing.expect(count >= 3);
}
