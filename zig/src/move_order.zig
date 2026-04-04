/// Move Ordering（候補手ソート）
///
/// Alpha-Beta剪定の効率向上のため、候補手を優先度順にソート。
/// Killer Moves、History Heuristic、静的評価を組み合わせ。
/// TS版 moveOrdering.ts に対応

const board_mod = @import("board.zig");
const move_gen = @import("move_gen.zig");
const position_eval = @import("position_eval.zig");
const threats_mod = @import("threats.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
pub const Position = move_gen.Position;

// =============================================================================
// Killer Moves
// =============================================================================

const MAX_KILLER_MOVES: u8 = 2;
const MAX_DEPTH: u8 = 10;

pub const KillerMoves = struct {
    moves: [MAX_DEPTH][MAX_KILLER_MOVES]?Position,

    pub fn init() KillerMoves {
        return .{
            .moves = [_][MAX_KILLER_MOVES]?Position{[_]?Position{null} ** MAX_KILLER_MOVES} ** MAX_DEPTH,
        };
    }

    pub fn record(self: *KillerMoves, depth: u8, move: Position) void {
        if (depth >= MAX_DEPTH) return;

        // 既に記録されている場合はスキップ
        for (self.moves[depth]) |km| {
            if (km) |k| {
                if (k.row == move.row and k.col == move.col) return;
            }
        }

        // 新しい手を先頭に追加
        var i: u8 = MAX_KILLER_MOVES - 1;
        while (i > 0) : (i -= 1) {
            self.moves[depth][i] = self.moves[depth][i - 1];
        }
        self.moves[depth][0] = move;
    }

    pub fn get(self: *const KillerMoves, depth: u8) [MAX_KILLER_MOVES]?Position {
        if (depth >= MAX_DEPTH) return [_]?Position{null} ** MAX_KILLER_MOVES;
        return self.moves[depth];
    }
};

// =============================================================================
// History Heuristic
// =============================================================================

pub const HistoryTable = struct {
    table: [BOARD_SIZE][BOARD_SIZE]i32,

    pub fn init() HistoryTable {
        return .{
            .table = [_][BOARD_SIZE]i32{[_]i32{0} ** BOARD_SIZE} ** BOARD_SIZE,
        };
    }

    pub fn update(self: *HistoryTable, move: Position, depth: u8) void {
        self.table[move.row][move.col] += @as(i32, depth) * @as(i32, depth);
    }

    pub fn getScore(self: *const HistoryTable, move: Position) i32 {
        return self.table[move.row][move.col];
    }

    /// 全エントリを半減（History Gravity）
    /// 反復深化の各深度開始時に呼び出し、古い情報の影響を減衰させる
    pub fn decay(self: *HistoryTable) void {
        for (0..BOARD_SIZE) |r| {
            for (0..BOARD_SIZE) |c| {
                self.table[r][c] >>= 1;
            }
        }
    }

    pub fn clear(self: *HistoryTable) void {
        self.table = [_][BOARD_SIZE]i32{[_]i32{0} ** BOARD_SIZE} ** BOARD_SIZE;
    }
};

// =============================================================================
// Move Ordering
// =============================================================================

pub const SortMovesResult = struct {
    moves: move_gen.MoveList,
    precomputed_threats: ?threats_mod.ThreatInfo,
};

pub const MoveOrderingOptions = struct {
    tt_move: ?Position = null,
    killers: ?*const KillerMoves = null,
    depth: ?u8 = null,
    history: ?*const HistoryTable = null,
    counter_move: ?Position = null,
    use_static_eval: bool = true,
    eval_options: position_eval.EvalOptions = position_eval.DEFAULT_EVAL_OPTIONS,
    max_static_eval_count: ?u16 = null,
};

/// 候補手をソート
pub fn sortMoves(
    moves: *const move_gen.MoveList,
    cells: []Cell,
    color: Cell,
    options: MoveOrderingOptions,
) SortMovesResult {
    const n = moves.len;
    if (n <= 1) {
        return .{ .moves = moves.*, .precomputed_threats = null };
    }

    var score_buf: [move_gen.MAX_MOVES]f64 = undefined;
    var static_eval_done: [move_gen.MAX_MOVES]bool = undefined;
    var indices: [move_gen.MAX_MOVES]u16 = undefined;
    for (0..n) |i| {
        indices[i] = @intCast(i);
        score_buf[i] = 0;
        static_eval_done[i] = false;
    }

    // Killer Movesを取得
    var killer_moves: [MAX_KILLER_MOVES]?Position = [_]?Position{null} ** MAX_KILLER_MOVES;
    if (options.killers) |killers| {
        if (options.depth) |depth| {
            killer_moves = killers.get(depth);
        }
    }

    // 必須防御用の脅威情報を事前計算
    var precomputed_threats: ?threats_mod.ThreatInfo = null;
    var effective_eval_options = options.eval_options;
    if (options.use_static_eval and options.eval_options.enable_mandatory_defense and
        !options.eval_options.has_precomputed_threats)
    {
        const opponent_color = color.opposite();
        precomputed_threats = threats_mod.detectOpponentThreats(cells, opponent_color);
        effective_eval_options.has_precomputed_threats = true;
        effective_eval_options.precomputed_threats = precomputed_threats;
    }

    // === 第1パス: TT最善手 + Killer Moves + History でスコア付け ===
    for (0..n) |idx| {
        const move = moves.items[idx];
        var score_val: f64 = 0;

        // TT最善手
        if (options.tt_move) |tt| {
            if (move.row == tt.row and move.col == tt.col) {
                score_val += 1000000;
            }
        }

        // Killer Moves
        for (killer_moves, 0..) |km_opt, i| {
            if (km_opt) |km| {
                if (move.row == km.row and move.col == km.col) {
                    score_val += @as(f64, @floatFromInt(@as(i32, 100000) - @as(i32, @intCast(i)) * 10000));
                    break;
                }
            }
        }

        // Counter-move
        if (options.counter_move) |cm| {
            if (move.row == cm.row and move.col == cm.col) {
                score_val += 50000;
            }
        }

        // History Heuristic
        if (options.history) |history| {
            score_val += @floatFromInt(history.getScore(move));
        }

        score_buf[idx] = score_val;
    }

    // === 静的評価 ===
    if (options.use_static_eval) {
        const eval_count = options.max_static_eval_count orelse n;

        if (eval_count < n) {
            // Lazy Evaluation: 事前ソートして上位N手のみ評価
            sortIndicesByScore(indices[0..n], &score_buf);

            for (0..@min(eval_count, n)) |i| {
                const idx = indices[i];
                const move = moves.items[idx];
                score_buf[idx] += @floatFromInt(position_eval.evaluatePosition(
                    cells,
                    move.row,
                    move.col,
                    color,
                    effective_eval_options,
                ));
                static_eval_done[idx] = true;
            }
        } else {
            for (0..n) |idx| {
                const move = moves.items[idx];
                score_buf[idx] += @floatFromInt(position_eval.evaluatePosition(
                    cells,
                    move.row,
                    move.col,
                    color,
                    effective_eval_options,
                ));
                static_eval_done[idx] = true;
            }
        }
    }

    // Lazy Evaluation時、未評価の手に対しても必須防御チェック
    if (options.use_static_eval and effective_eval_options.enable_mandatory_defense and
        options.max_static_eval_count != null and (options.max_static_eval_count orelse n) < n)
    {
        if (precomputed_threats orelse effective_eval_options.precomputed_threats) |t| {
            const has_threats = t.open_fours.len > 0 or t.fours.len > 0 or t.open_threes.len > 0;

            if (has_threats) {
                const has_fours = t.open_fours.len > 0 or t.fours.len > 0;

                // 防御位置ビットマップ
                var defense_bitmap: [225]bool = [_]bool{false} ** 225;
                if (has_fours) {
                    for (0..t.open_fours.len) |i| {
                        defense_bitmap[@as(u16, t.open_fours.items[i].row) * 15 + t.open_fours.items[i].col] = true;
                    }
                    for (0..t.fours.len) |i| {
                        defense_bitmap[@as(u16, t.fours.items[i].row) * 15 + t.fours.items[i].col] = true;
                    }
                } else {
                    for (0..t.open_threes.len) |i| {
                        defense_bitmap[@as(u16, t.open_threes.items[i].row) * 15 + t.open_threes.items[i].col] = true;
                    }
                }

                for (0..n) |idx| {
                    const move = moves.items[idx];
                    if (defense_bitmap[@as(u16, move.row) * 15 + move.col]) continue;
                    if (has_fours or !static_eval_done[idx]) {
                        score_buf[idx] = -std.math.inf(f64);
                    }
                }
            }
        }
    }

    // スコア降順でソート
    sortIndicesByScore(indices[0..n], &score_buf);

    // -Infinityの手を除外し、ソート済み配列を構築
    var result = move_gen.MoveList.init();
    var has_valid = false;
    for (0..n) |i| {
        const idx = indices[i];
        if (score_buf[idx] > -std.math.inf(f64)) {
            result.push(moves.items[idx]);
            has_valid = true;
        }
    }

    // 有効な手がなければ全ての手を返す
    if (!has_valid) {
        var all = move_gen.MoveList.init();
        for (0..n) |i| {
            all.push(moves.items[indices[i]]);
        }
        return .{ .moves = all, .precomputed_threats = precomputed_threats };
    }

    return .{ .moves = result, .precomputed_threats = precomputed_threats };
}

/// ソート済み候補手を生成
pub fn generateSortedMoves(
    cells: []Cell,
    color: Cell,
    options: MoveOrderingOptions,
    skip_forbidden_check: bool,
) SortMovesResult {
    const moves = move_gen.generateMoves(cells, color, .{ .skip_forbidden_check = skip_forbidden_check });
    if (moves.len <= 1) {
        return .{ .moves = moves, .precomputed_threats = null };
    }
    return sortMoves(&moves, cells, color, options);
}

/// インデックス配列をスコア降順でソート（insertion sort — 候補手数は通常 < 100）
fn sortIndicesByScore(indices_slice: []u16, score_buf: *const [move_gen.MAX_MOVES]f64) void {
    const n = indices_slice.len;
    if (n <= 1) return;

    // Insertion sort
    var i: usize = 1;
    while (i < n) : (i += 1) {
        const key = indices_slice[i];
        const key_score = score_buf[key];
        var j: usize = i;
        while (j > 0 and score_buf[indices_slice[j - 1]] < key_score) : (j -= 1) {
            indices_slice[j] = indices_slice[j - 1];
        }
        indices_slice[j] = key;
    }
}

// === Tests ===

test "KillerMoves basic" {
    var killers = KillerMoves.init();
    killers.record(0, .{ .row = 7, .col = 7 });
    killers.record(0, .{ .row = 3, .col = 3 });

    const km = killers.get(0);
    try std.testing.expect(km[0] != null);
    try std.testing.expectEqual(km[0].?.row, 3);
    try std.testing.expectEqual(km[0].?.col, 3);
    try std.testing.expect(km[1] != null);
    try std.testing.expectEqual(km[1].?.row, 7);
    try std.testing.expectEqual(km[1].?.col, 7);
}

test "HistoryTable basic" {
    var history = HistoryTable.init();
    history.update(.{ .row = 7, .col = 7 }, 3);
    try std.testing.expectEqual(history.getScore(.{ .row = 7, .col = 7 }), 9);
    history.clear();
    try std.testing.expectEqual(history.getScore(.{ .row = 7, .col = 7 }), 0);
}

test "sortMoves: TT move first" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    var moves_list = move_gen.MoveList.init();
    moves_list.push(.{ .row = 6, .col = 6 });
    moves_list.push(.{ .row = 8, .col = 8 });
    moves_list.push(.{ .row = 7, .col = 8 });

    const result = sortMoves(&moves_list, &cells, .white, .{
        .tt_move = .{ .row = 7, .col = 8 },
        .use_static_eval = false,
    });

    try std.testing.expectEqual(result.moves.items[0].row, 7);
    try std.testing.expectEqual(result.moves.items[0].col, 8);
}
