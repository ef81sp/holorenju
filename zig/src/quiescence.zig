/// Quiescence Search（静止探索）
///
/// 末端ノード（depth=0）で脅威手（四・ブロック）が未解決の場合、
/// これらを追加探索して「静止した状態」で評価する。
/// 水平線効果を軽減する。
/// TS版 quiescence.ts に対応

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const incremental_eval = @import("incremental_eval.zig");
const ll = @import("line_lookup.zig");
const scores = @import("scores.zig");
const threats = @import("threats.zig");
const tt_mod = @import("tt.zig");
const zobrist = @import("zobrist.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;

pub const Position = @import("threats.zig").Position;

/// Quiescence Search の最大深度（四+ブロック 2往復分）
pub const MAX_QUIESCENCE_DEPTH: u8 = 4;

/// 四を作るかチェック（石配置済み前提、bitboard も同期済み前提）
/// TS版 threatMoves.ts の createsFour に対応
pub fn createsFour(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    for (DIRECTIONS, 0..) |dir, i| {
        const result = ll.queryPatternByCell(row, col, i, color);

        // 連続四をチェック（黒はオーバーライン補正）
        if (result.count == 4) {
            var end1_open = result.end1 == 0;
            var end2_open = result.end2 == 0;
            if (color == .black) {
                if (end1_open) end1_open = !isOverlineEnd(cells, row, col, i, true);
                if (end2_open) end2_open = !isOverlineEnd(cells, row, col, i, false);
            }
            if (end1_open or end2_open) {
                return true;
            }
        }

        // 跳び四をチェック
        if (result.count != 4 and result.has_jump_four) {
            // 黒の長連チェック: 跳び四のギャップを埋めると長連になる場合はスキップ
            if (color == .black) {
                if (isJumpFourOverline(cells, row, col, dir.dr, dir.dc)) continue;
            }
            return true;
        }
    }
    return false;
}

/// 黒のオーバーライン補正: count==4 の空き端の先に黒石があるかチェック
fn isOverlineEnd(cells: []const Cell, row: u8, col: u8, dir_idx: usize, is_positive: bool) bool {
    const dir = DIRECTIONS[dir_idx];
    const dr: i8 = if (is_positive) dir.dr else -dir.dr;
    const dc: i8 = if (is_positive) dir.dc else -dir.dc;

    var consecutive: i16 = 0;
    var r: i16 = @as(i16, row) + @as(i16, dr);
    var c: i16 = @as(i16, col) + @as(i16, dc);
    while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .black) {
        consecutive += 1;
        r += @as(i16, dr);
        c += @as(i16, dc);
    }

    const check_r = @as(i16, row) + @as(i16, dr) * (consecutive + 2);
    const check_c = @as(i16, col) + @as(i16, dc) * (consecutive + 2);
    if (board_mod.isValid(check_r, check_c)) {
        const check_idx = @as(u16, @intCast(check_r)) * BOARD_SIZE + @as(u16, @intCast(check_c));
        if (cells[check_idx] == .black) {
            return true;
        }
    }
    return false;
}

/// 跳び四が長連になるかチェック
fn isJumpFourOverline(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8) bool {
    // ギャップ位置を探す
    const gap = findJumpFourGap(cells, row, col, dr, dc) orelse
        findJumpFourGap(cells, row, col, -dr, -dc) orelse
        return false;

    // ギャップを埋めた場合の連続数をチェック
    // cells は const なので仮置きできない。代わりに方向カウントで確認
    const pos_result = board_mod.countInDirectionOnCells(cells, gap.row, gap.col, dr, dc, .black);
    const neg_result = board_mod.countInDirectionOnCells(cells, gap.row, gap.col, -dr, -dc, .black);
    const total = @as(u16, pos_result.count) + neg_result.count + 1; // +1 for the gap cell itself
    return total >= 6;
}

/// 跳び四のギャップ位置を検出
fn findJumpFourGap(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8) ?Position {
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;

    // 正方向に連続する石をスキップ
    while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .black) {
        r += dr;
        c += dc;
    }

    // 空きマスがあるか
    if (!board_mod.isValid(r, c)) return null;
    if (cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] != .empty) return null;

    const gap_r: u8 = @intCast(r);
    const gap_c: u8 = @intCast(c);

    // 空きの先に黒石が続くか
    r += dr;
    c += dc;
    if (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .black) {
        return .{ .row = gap_r, .col = gap_c };
    }
    return null;
}

/// 四に対する防御位置を取得
/// 四は1点でしか止められないのでその位置を返す
/// 石配置済み前提、bitboard も同期済み前提。
/// TS版 threatPatterns.ts の getFourDefensePosition に対応
pub fn getFourDefensePosition(cells: []const Cell, last_row: u8, last_col: u8, color: Cell) ?Position {
    var first_defense: ?Position = null;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = ll.queryPatternByCell(last_row, last_col, i, color);

        // 連続四をチェック
        if (result.count == 4) {
            const ends = getLineEnds(cells, last_row, last_col, dir.dr, dir.dc, color);
            if (ends.count == 2) {
                // 活四（両端空き）= 防御不可能
                return null;
            }
            if (ends.count == 1 and first_defense == null) {
                first_defense = ends.items[0];
            }
            continue;
        }

        // 跳び四をチェック
        if (result.has_jump_four) {
            const gap = @import("threats.zig").findJumpGapPosition(cells, last_row, last_col, dir.dr, dir.dc, color);
            if (gap != null and first_defense == null) {
                first_defense = gap;
            }
        }
    }

    return first_defense;
}

/// ラインの端（空きマス）を返す
const LineEnds = struct {
    items: [2]Position,
    count: u8,
};

fn getLineEnds(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) LineEnds {
    var ends = LineEnds{ .items = undefined, .count = 0 };

    // 正方向の端
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;
    while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == color) {
        r += dr;
        c += dc;
    }
    if (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .empty) {
        // 黒のoverline補正: 空き端の先に黒石があれば打つと長連になるため除外
        var include = true;
        if (color == .black) {
            const br = r + dr;
            const bc = c + dc;
            if (board_mod.isValid(br, bc) and cells[@intCast(@as(u16, @intCast(br)) * BOARD_SIZE + @as(u16, @intCast(bc)))] == .black) {
                include = false;
            }
        }
        if (include) {
            ends.items[ends.count] = .{ .row = @intCast(r), .col = @intCast(c) };
            ends.count += 1;
        }
    }

    // 負方向の端
    r = @as(i16, row) - dr;
    c = @as(i16, col) - dc;
    while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == color) {
        r -= dr;
        c -= dc;
    }
    if (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .empty) {
        // 黒のoverline補正: 空き端の先に黒石があれば打つと長連になるため除外
        var include = true;
        if (color == .black) {
            const br = r - dr;
            const bc = c - dc;
            if (board_mod.isValid(br, bc) and cells[@intCast(@as(u16, @intCast(br)) * BOARD_SIZE + @as(u16, @intCast(bc)))] == .black) {
                include = false;
            }
        }
        if (include) {
            ends.items[ends.count] = .{ .row = @intCast(r), .col = @intCast(c) };
            ends.count += 1;
        }
    }

    return ends;
}

/// 脅威手（四を作る手 + 相手の四へのブロック）を生成
/// TS版 quiescence.ts の generateTacticalMoves に対応
pub fn generateTacticalMoves(
    cells: []Cell,
    color: Cell,
    last_move: ?Position,
    result_buf: *[225]Position,
) u16 {
    const opponent_color = color.opposite();
    var count: u16 = 0;

    // 1. 相手の直前手が四を作っていれば → ブロック手のみ
    if (last_move) |lm| {
        const defense_pos = getFourDefensePosition(cells, lm.row, lm.col, opponent_color);
        if (defense_pos) |dp| {
            result_buf[0] = dp;
            return 1;
        }
    }

    // 2. 自分が四を作れる手を列挙
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 1);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // 仮配置してチェック（bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);
            const is_four = createsFour(cells, r, c, color);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (is_four) {
                result_buf[count] = .{ .row = r, .col = c };
                count += 1;
            }
        }
    }
    return count;
}

/// 探索統計（quiescence用の軽量版）
pub const QSearchStats = struct {
    nodes: u32 = 0,
    q_search_nodes: u32 = 0,
};

/// Quiescence Search（静止探索）
///
/// depth=0 の末端ノードで、脅威手（四・ブロック）を追加探索し、
/// 「静止した状態」で evaluateBoard を呼ぶ。
pub fn quiescenceSearch(
    cells: []Cell,
    hash: u64,
    is_maximizing: bool,
    perspective: Cell,
    alpha_init: i32,
    beta_init: i32,
    last_move: ?Position,
    eval_options: evaluate.EvalOptions,
    q_depth: u8,
    stats: *QSearchStats,
    timeout_flag: *const bool,
    tt: *tt_mod.TranspositionTable,
) i32 {
    stats.nodes += 1;
    stats.q_search_nodes += 1;

    // TTプローブ
    const tt_entry = tt.probe(hash);
    if (tt_entry) |entry| {
        const current_tt_depth: i8 = -(@as(i8, @intCast(MAX_QUIESCENCE_DEPTH)) - @as(i8, @intCast(q_depth)) + 1);
        if (entry.depth >= current_tt_depth) {
            switch (entry.score_type) {
                .exact => return entry.score,
                .lower_bound => {
                    if (entry.score >= beta_init) return entry.score;
                },
                .upper_bound => {
                    if (entry.score <= alpha_init) return entry.score;
                },
            }
        }
    }

    const eval_opts = evaluate.EvalOptions{
        .enable_leaf_mise = eval_options.enable_leaf_mise,
        .last_mover_is_perspective = if (!is_maximizing) .yes else .no,
        .single_four_penalty_multiplier = eval_options.single_four_penalty_multiplier,
        .connectivity_bonus = eval_options.connectivity_bonus,
    };

    // 時間/ノード制限チェック
    if (timeout_flag.*) {
        return incremental_eval.getEvaluation(cells, perspective, eval_opts, false);
    }

    // Stand-pat: 何もしない場合の評価（インクリメンタル評価を使用）
    const stand_pat = incremental_eval.getEvaluation(cells, perspective, eval_opts, false);

    var alpha = alpha_init;
    var beta = beta_init;

    // Alpha-beta cutoff（stand-pat）
    if (is_maximizing) {
        if (stand_pat >= beta) return beta;
        if (stand_pat > alpha) alpha = stand_pat;
    } else {
        if (stand_pat <= alpha) return alpha;
        if (stand_pat < beta) beta = stand_pat;
    }

    // 深度制限
    if (q_depth == 0) {
        return stand_pat;
    }

    // 脅威手生成
    const current_color = if (is_maximizing) perspective else perspective.opposite();
    var move_buf: [225]Position = undefined;
    const move_count = generateTacticalMoves(cells, current_color, last_move, &move_buf);

    if (move_count == 0) {
        return stand_pat;
    }

    var best_score = stand_pat;

    for (0..move_count) |mi| {
        const move = move_buf[mi];

        // 石を配置（cells, bitboard, incremental eval_state を同期更新）
        incremental_eval.placeStone(cells, move.row, move.col, current_color);
        const new_hash = zobrist.updateHash(hash, move.row, move.col, current_color);

        const score = quiescenceSearch(
            cells,
            new_hash,
            !is_maximizing,
            perspective,
            alpha,
            beta,
            move,
            eval_options,
            q_depth - 1,
            stats,
            timeout_flag,
            tt,
        );

        // 石を除去
        incremental_eval.removeStone(cells, move.row, move.col);

        // Alpha-beta更新
        if (is_maximizing) {
            if (score > best_score) best_score = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
        } else {
            if (score < best_score) best_score = score;
            if (score < beta) beta = score;
            if (alpha >= beta) break;
        }
    }

    // TT保存: 負の可変depthで本探索と分離
    const tt_depth: i8 = -(@as(i8, @intCast(MAX_QUIESCENCE_DEPTH)) - @as(i8, @intCast(q_depth)) + 1);
    const score_type: tt_mod.ScoreType = if (best_score <= alpha_init) .upper_bound else if (best_score >= beta_init) .lower_bound else .exact;
    tt.store(hash, best_score, tt_depth, score_type, null);

    return best_score;
}

// === Tests ===

test "createsFour detects consecutive four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 横に3石: (7,5),(7,6),(7,7) + (7,8) に置くと四
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み
    bitboard.initFromCells(&cells);

    try std.testing.expect(createsFour(&cells, 7, 8, .black));
}

test "getFourDefensePosition finds defense for consecutive four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 止め四: (7,5),(7,6),(7,7),(7,8) で片端を白で塞ぐ
    cells[7 * BOARD_SIZE + 4] = .white; // 左端を塞ぐ
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getFourDefensePosition(&cells, 7, 8, .black);
    try std.testing.expect(defense != null);
    // 防御位置は (7,9) のみ
    const dp = defense.?;
    try std.testing.expectEqual(dp.row, 7);
    try std.testing.expectEqual(dp.col, 9);
}

test "getFourDefensePosition returns null for open four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 活四: 両端空き → 防御不可能
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getFourDefensePosition(&cells, 7, 8, .black);
    try std.testing.expect(defense == null);
}

test "generateTacticalMoves finds four moves" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 横に3石
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var buf: [225]Position = undefined;
    const count = generateTacticalMoves(&cells, .black, null, &buf);
    // (7,4) と (7,8) が四を作る
    try std.testing.expect(count >= 2);
}

test "quiescenceSearch stand-pat on empty" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    incremental_eval.initFromBoard(&cells, scores.CONNECTIVITY_BONUS, 100);
    var stats = QSearchStats{};
    var timeout_flag = false;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    const score = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        },
        MAX_QUIESCENCE_DEPTH,
        &stats,
        &timeout_flag,
        &tt,
    );
    try std.testing.expectEqual(score, 0);
}

test "getFourDefensePosition: black four with overline should not be open four" {
    ll.init();
    // C8-D8-E8-F8-(空G8)-H8(黒) の配置
    // row=7 (0-indexed), C=2, D=3, E=4, F=5, G=6(empty), H=7
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .black; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    // G8 (7*15+6) = empty
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    bitboard.initFromCells(&cells);

    // E8を基準に四判定: C8-D8-E8-F8 は四だが、G8方向はoverlineで塞がり
    // → 活四ではなく止め四（B8で防御可能）→ null ではなく B8 を返すべき
    const defense = getFourDefensePosition(&cells, 7, 4, .black);
    try std.testing.expect(defense != null);
    const dp = defense.?;
    try std.testing.expectEqual(dp.row, 7);
    try std.testing.expectEqual(dp.col, 1); // B8
}
