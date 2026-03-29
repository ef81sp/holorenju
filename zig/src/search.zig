/// 反復深化探索 + 事前チェック
///
/// Iterative Deepening + Aspiration Windows + 事前チェック（VCF/脅威防御）
/// TS版 iterativeDeepening.ts + preSearch.ts に対応

const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const minimax = @import("minimax.zig");
const move_gen = @import("move_gen.zig");
const move_order = @import("move_order.zig");
const position_eval = @import("position_eval.zig");
const scores = @import("scores.zig");
const threats_mod = @import("threats.zig");
const tt_mod = @import("tt.zig");
const vcf = @import("vcf.zig");
const vct = @import("vct.zig");
const zobrist = @import("zobrist.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;

pub const Position = threats_mod.Position;

// =============================================================================
// 動的時間配分
// =============================================================================

const EARLY_GAME_TIME_FACTOR: u32 = 70; // 0.7 * 100
const FEW_CANDIDATES_TIME_FACTOR: u32 = 30; // 0.3 * 100

fn calculateDynamicTimeLimit(base_time_limit: u32, stone_count: u16, move_count: u16) u32 {
    if (move_count <= 1) return 0;
    if (stone_count <= 6) return base_time_limit * EARLY_GAME_TIME_FACTOR / 100;
    if (move_count <= 3) return base_time_limit * FEW_CANDIDATES_TIME_FACTOR / 100;
    return base_time_limit;
}

/// 石の数をカウント
fn countStones(cells: []const Cell) u16 {
    var count: u16 = 0;
    for (cells) |c| {
        if (c != .empty) count += 1;
    }
    return count;
}

// =============================================================================
// 事前チェック（Pre-Search）
// =============================================================================

/// 事前チェック結果
pub const PreSearchResult = struct {
    /// 即座に返すべき手
    immediate_move: ?Position = null,
    immediate_score: i32 = 0,
    /// 候補手の制限セット
    restricted_moves: ?move_gen.MoveList = null,
    /// 相手の脅威情報
    threats: ?threats_mod.ThreatInfo = null,
};

/// 即勝ち手を探す（五連を完成できる位置）
fn findWinningMove(cells: []Cell, color: Cell) ?Position {
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;

            // 仮配置してチェック
            cells[idx] = color;
            const is_five = forbidden.checkFive(cells, r, c, color);
            cells[idx] = .empty;

            if (is_five) {
                return .{ .row = r, .col = c };
            }
        }
    }
    return null;
}

/// 必須手の事前チェック
pub fn findPreSearchMove(
    cells: []Cell,
    color: Cell,
) PreSearchResult {
    // 即勝ち手
    const win_move = findWinningMove(cells, color);
    if (win_move) |wm| {
        return .{
            .immediate_move = wm,
            .immediate_score = scores.FIVE,
        };
    }

    // 相手の脅威を検出
    const opponent_color = color.opposite();
    const threat_info = threats_mod.detectOpponentThreats(cells, opponent_color);

    // 相手の活四があれば止める
    if (threat_info.open_fours.len > 0) {
        const defense_pos = threat_info.open_fours.items[0];
        // 黒番で防御位置が禁手の場合は通常探索に委ねる
        if (color == .black) {
            const forbidden_result = forbidden.checkForbiddenMove(cells, defense_pos.row, defense_pos.col);
            if (forbidden_result != .none) {
                return .{ .threats = threat_info };
            }
        }
        return .{
            .immediate_move = defense_pos,
            .immediate_score = -scores.FIVE,
        };
    }

    // 相手の止め四があれば止める
    if (threat_info.fours.len > 0) {
        const defense_pos = threat_info.fours.items[0];
        const four_defense_score: i32 = if (threat_info.open_threes.len > 0) -scores.FIVE else 0;
        if (color == .black) {
            const forbidden_result = forbidden.checkForbiddenMove(cells, defense_pos.row, defense_pos.col);
            if (forbidden_result != .none) {
                return .{ .threats = threat_info };
            }
        }
        return .{
            .immediate_move = defense_pos,
            .immediate_score = four_defense_score,
        };
    }

    // VCF勝ち手を探す
    const vcf_move = vcf.findVCFMove(cells, color, vcf.VCF_MAX_DEPTH, vcf.VCF_TIME_LIMIT);
    if (vcf_move) |vm| {
        return .{
            .immediate_move = vm,
            .immediate_score = scores.FIVE - 10,
        };
    }

    // VCT勝ち手を探す
    const vct_move = vct.findVCTMove(cells, color, vct.VCT_MAX_DEPTH, vct.VCT_TIME_LIMIT);
    if (vct_move) |vm| {
        return .{
            .immediate_move = vm,
            .immediate_score = scores.FIVE - 20,
        };
    }

    return .{ .threats = threat_info };
}

// =============================================================================
// 反復深化探索
// =============================================================================

/// Aspiration Windowの段階的拡大幅
const ASPIRATION_WIDTHS = minimax.ASPIRATION_WIDTHS;

/// Score Verification の閾値
const VERIFICATION_THRESHOLD: i32 = 1500;

/// 反復深化のフォールバック閾値
const WINNING_SCORE_THRESHOLD: i32 = 2500;
const TIME_PRESSURE_FALLBACK_THRESHOLD: i32 = 1500;

/// 深度別の最善手情報
pub const DepthHistoryEntry = struct {
    depth: u8,
    position: Position,
    score: i32,
};

/// Iterative Deepening結果
pub const IterativeDeepingResult = struct {
    position: Position,
    score: i32,
    completed_depth: u8,
    interrupted: bool,
    stats: minimax.SearchStats,
    forced_move: bool = false,
};

/// 反復深化探索パラメータ
pub const IterativeDeepeningParams = struct {
    max_depth: u8 = 6,
    time_limit: u32 = 0, // 0 = 無制限
    max_nodes: u32 = 0, // 0 = 無制限
    absolute_time_limit: u32 = 10000, // ms
    eval_options: position_eval.EvalOptions = position_eval.DEFAULT_EVAL_OPTIONS,
    board_eval_options: evaluate.EvalOptions = .{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    },
};

/// Iterative Deepeningで最善手を探索
pub fn findBestMoveIterative(
    cells: []Cell,
    color: Cell,
    params: IterativeDeepeningParams,
) IterativeDeepingResult {
    const start_time = getTimestampMs();

    // TT・ヒストリ等の初期化
    var history = move_order.HistoryTable.init();
    var killers = move_order.KillerMoves.init();
    var counter_moves = minimax.initCounterMoveTable();

    var ctx = minimax.SearchContext.init(
        &tt_mod.global_tt,
        &history,
        &killers,
        &counter_moves,
        params.eval_options,
        params.board_eval_options,
    );

    // 新しい探索開始
    tt_mod.global_tt.newGeneration();

    // =========================================================================
    // 事前チェック
    // =========================================================================

    const pre_search = findPreSearchMove(cells, color);
    if (pre_search.immediate_move) |im| {
        return .{
            .position = im,
            .score = pre_search.immediate_score,
            .completed_depth = 0,
            .interrupted = false,
            .stats = ctx.stats,
        };
    }

    // =========================================================================
    // 候補手生成
    // =========================================================================

    var eval_options = params.eval_options;
    if (pre_search.threats) |t| {
        eval_options.has_precomputed_threats = true;
        eval_options.precomputed_threats = t;
    }

    const sort_result = move_order.generateSortedMoves(
        cells,
        color,
        .{
            .tt_move = null,
            .killers = &killers,
            .depth = 1,
            .history = &history,
            .use_static_eval = true,
            .eval_options = eval_options,
        },
        false,
    );
    var moves = sort_result.moves;

    // 活三防御の候補手制限（TS版 iterativeDeepening.ts L233-252 に対応）
    if (pre_search.threats) |t| {
        if (t.open_threes.len > 0) {
            var filtered = move_gen.MoveList.init();
            for (0..moves.len) |i| {
                if (t.open_threes.contains(moves.items[i].row, moves.items[i].col)) {
                    filtered.push(moves.items[i]);
                }
            }
            if (filtered.len > 0) {
                moves = filtered;
            }
        }
    }

    // 唯一の候補手なら即座に返す
    if (moves.len <= 1) {
        const pos = if (moves.len == 1) moves.items[0] else Position{ .row = 7, .col = 7 };
        return .{
            .position = pos,
            .score = 0,
            .completed_depth = 0,
            .interrupted = false,
            .stats = ctx.stats,
            .forced_move = true,
        };
    }

    // =========================================================================
    // 時間制限設定
    // =========================================================================

    const no_time_limit = params.time_limit == 0;
    const stone_count = countStones(cells);
    const dynamic_time_limit = if (no_time_limit)
        @as(u32, 0)
    else
        calculateDynamicTimeLimit(params.time_limit, stone_count, moves.len);

    const search_deadline = if (no_time_limit) @as(u32, 0) else start_time + dynamic_time_limit;
    const absolute_deadline = if (no_time_limit) @as(u32, 0) else start_time + params.absolute_time_limit;
    const loop_deadline = if (no_time_limit) @as(u32, 0) else start_time + dynamic_time_limit * 80 / 100;

    ctx.deadline = search_deadline;
    ctx.timeout_flag = false;
    ctx.max_nodes = params.max_nodes;
    ctx.no_time_limit = no_time_limit;
    ctx.node_count_exceeded = false;
    ctx.absolute_deadline = absolute_deadline;
    ctx.absolute_deadline_exceeded = false;

    // =========================================================================
    // 反復深化ループ
    // =========================================================================

    var depth_history: [20]DepthHistoryEntry = undefined;
    var depth_history_len: u8 = 0;

    // 深さ1で初期結果
    var best_result = minimax.findBestMoveWithTT(
        cells,
        color,
        1,
        &ctx,
        null,
        ASPIRATION_WIDTHS[0],
        &moves,
    );
    var completed_depth: u8 = 1;
    var interrupted = false;

    depth_history[0] = .{
        .depth = 1,
        .position = best_result.position,
        .score = best_result.score,
    };
    depth_history_len = 1;

    // 深さ2からmaxDepthまで
    var depth: u8 = 2;
    while (depth <= params.max_depth) : (depth += 1) {
        // PVムーブを先頭に移動
        const pv_move = best_result.position;
        var pv_index: ?u16 = null;
        for (0..moves.len) |i| {
            if (moves.items[i].row == pv_move.row and moves.items[i].col == pv_move.col) {
                pv_index = @intCast(i);
                break;
            }
        }
        if (pv_index) |pi| {
            if (pi > 0) {
                const pv = moves.items[pi];
                var i: u16 = pi;
                while (i > 0) : (i -= 1) {
                    moves.items[i] = moves.items[i - 1];
                }
                moves.items[0] = pv;
            }
        }

        // 時間制限チェック
        if (!no_time_limit) {
            const now = getTimestampMs();
            if (now >= absolute_deadline) {
                ctx.absolute_deadline_exceeded = true;
                interrupted = true;
                break;
            }
            if (now >= loop_deadline or ctx.timeout_flag or ctx.node_count_exceeded) {
                interrupted = true;
                break;
            }
        }

        // Aspiration Windowsで探索
        var result = best_result;
        var search_complete = false;
        for (ASPIRATION_WIDTHS) |width| {
            result = minimax.findBestMoveWithTT(
                cells,
                color,
                depth,
                &ctx,
                best_result.score,
                width,
                &moves,
            );

            if (ctx.timeout_flag or ctx.node_count_exceeded or ctx.absolute_deadline_exceeded) {
                break;
            }

            // ウィンドウ内に収まれば探索完了
            const lower_bound = best_result.score - width;
            const upper_bound = best_result.score + width;
            if (result.score > lower_bound and result.score < upper_bound) {
                search_complete = true;
                break;
            }
        }

        // 全段階でウィンドウ外 → フルウィンドウで再探索
        if (!search_complete and !ctx.timeout_flag and !ctx.node_count_exceeded and !ctx.absolute_deadline_exceeded) {
            result = minimax.findBestMoveWithTT(
                cells,
                color,
                depth,
                &ctx,
                null,
                ASPIRATION_WIDTHS[0],
                &moves,
            );
        }

        // タイムアウトチェック
        if (ctx.timeout_flag or ctx.node_count_exceeded or ctx.absolute_deadline_exceeded) {
            interrupted = true;
            break;
        }

        // 深度履歴に記録
        if (depth_history_len < 20) {
            depth_history[depth_history_len] = .{
                .depth = depth,
                .position = result.position,
                .score = result.score,
            };
            depth_history_len += 1;
        }

        // ループ末尾のdeadlineチェック
        if (!no_time_limit and getTimestampMs() >= search_deadline) {
            best_result = result;
            completed_depth = depth;
            interrupted = true;
            break;
        }

        best_result = result;
        completed_depth = depth;
    }

    // Score Verification Extension
    if (depth_history_len >= 2 and
        completed_depth < params.max_depth and
        !ctx.absolute_deadline_exceeded and
        !ctx.node_count_exceeded and
        (no_time_limit or getTimestampMs() < loop_deadline))
    {
        const last = depth_history[depth_history_len - 1];
        const prev = depth_history[depth_history_len - 2];
        const score_diff = if (last.score > prev.score) last.score - prev.score else prev.score - last.score;
        if (score_diff >= VERIFICATION_THRESHOLD) {
            const verify_result = minimax.findBestMoveWithTT(
                cells,
                color,
                completed_depth + 1,
                &ctx,
                last.score,
                ASPIRATION_WIDTHS[0],
                &moves,
            );
            if (!ctx.timeout_flag and !ctx.node_count_exceeded and !ctx.absolute_deadline_exceeded) {
                best_result = verify_result;
                completed_depth += 1;
            }
        }
    }

    // Time Pressure Fallback
    if (interrupted and depth_history_len > 0) {
        var i: u8 = depth_history_len;
        while (i > 0) {
            i -= 1;
            const entry = depth_history[i];
            if (entry.score >= WINNING_SCORE_THRESHOLD and
                best_result.score < entry.score - TIME_PRESSURE_FALLBACK_THRESHOLD)
            {
                best_result.position = entry.position;
                best_result.score = entry.score;
                break;
            }
        }
    }

    return .{
        .position = best_result.position,
        .score = best_result.score,
        .completed_depth = completed_depth,
        .interrupted = interrupted,
        .stats = ctx.stats,
    };
}

// =============================================================================
// タイムスタンプ取得
// =============================================================================

extern fn getTimestampMsExternal() u32;

fn getTimestampMs() u32 {
    if (@import("builtin").cpu.arch == .wasm32) {
        return getTimestampMsExternal();
    }
    return 0;
}

// === Tests ===

const testing = std.testing;

test "findPreSearchMove: immediate win" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 横に4石 → 五連完成可能
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    const result = findPreSearchMove(&cells, .black);
    try testing.expect(result.immediate_move != null);
    try testing.expectEqual(result.immediate_score, scores.FIVE);
}

test "findPreSearchMove: must defend four" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白が横に4石（止め四）
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 8] = .white;
    // 片端を黒で塞ぐ → 止め四
    cells[7 * BOARD_SIZE + 4] = .black;

    const result = findPreSearchMove(&cells, .black);
    // 相手の四に対する防御が検出される
    try testing.expect(result.immediate_move != null or result.threats != null);
}

test "findBestMoveIterative basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;

    tt_mod.global_tt.clear();

    const result = findBestMoveIterative(&cells, .black, .{
        .max_depth = 2,
        .max_nodes = 10000,
    });

    try testing.expect(result.position.row < BOARD_SIZE);
    try testing.expect(result.position.col < BOARD_SIZE);
    try testing.expect(result.completed_depth >= 1);
    try testing.expect(result.stats.nodes > 0);
}

test "findBestMoveIterative finds winning move" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒が4連 → 五連完成を見つけるべき
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    tt_mod.global_tt.clear();

    const result = findBestMoveIterative(&cells, .black, .{
        .max_depth = 1,
    });

    // 五連完成手を見つけるべき（事前チェックで即座に返る）
    try testing.expectEqual(result.score, scores.FIVE);
}

test "countStones" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[0] = .black;
    cells[1] = .white;
    cells[2] = .black;
    try testing.expectEqual(countStones(&cells), 3);
}

test "findPreSearchMove: white open four at J9" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 G9 G8 F8 H10 F9 H9 H11 G10 I10 I8 F11 J8 K8 F12
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[7 * BOARD_SIZE + 5] = .white; // F8
    cells[5 * BOARD_SIZE + 7] = .black; // H10
    cells[6 * BOARD_SIZE + 5] = .white; // F9
    cells[6 * BOARD_SIZE + 7] = .black; // H9
    cells[4 * BOARD_SIZE + 7] = .white; // H11
    cells[5 * BOARD_SIZE + 6] = .black; // G10
    cells[5 * BOARD_SIZE + 8] = .white; // I10
    cells[7 * BOARD_SIZE + 8] = .black; // I8
    cells[4 * BOARD_SIZE + 5] = .white; // F11
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[7 * BOARD_SIZE + 10] = .white; // K8
    cells[3 * BOARD_SIZE + 5] = .black; // F12

    // Step 1: findWinningMove should NOT find a five
    const win_move = findWinningMove(&cells, .white);
    try testing.expect(win_move == null);

    // Step 2: Opponent threats
    const opponent_color = Cell.white.opposite();
    const threat_info = threats_mod.detectOpponentThreats(&cells, opponent_color);
    // Black's row 7 four (cols 6-9) is dead (white on both ends)
    try testing.expectEqual(threat_info.open_fours.len, 0);
    try testing.expectEqual(threat_info.fours.len, 0);

    // Step 3: VCF should find J9
    // First test that J9 (6,9) with white creates a four
    const idx_j9 = @as(u16, 6) * BOARD_SIZE + 9;
    cells[idx_j9] = .white;
    const j9_creates_four = @import("quiescence.zig").createsFour(&cells, 6, 9, .white);
    const j9_defense = @import("quiescence.zig").getFourDefensePosition(&cells, 6, 9, .white);
    cells[idx_j9] = .empty;
    try testing.expect(j9_creates_four); // J9 creates a four
    try testing.expect(j9_defense == null); // open four = unblockable

    // VCF should find J9 (open four on diagonal)
    const vcf_move = vcf.findVCFMove(&cells, .white, vcf.VCF_MAX_DEPTH, 0);
    try testing.expect(vcf_move != null);
    const vm = vcf_move.?;
    try testing.expectEqual(@as(u8, 6), vm.row);
    try testing.expectEqual(@as(u8, 9), vm.col);
}

test "findBestMoveIterative: white selects J9 at move 16" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 5] = .white;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[4 * BOARD_SIZE + 7] = .white;
    cells[5 * BOARD_SIZE + 6] = .black;
    cells[5 * BOARD_SIZE + 8] = .white;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[4 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 9] = .black;
    cells[7 * BOARD_SIZE + 10] = .white;
    cells[3 * BOARD_SIZE + 5] = .black;

    tt_mod.global_tt.clear();

    const result = findBestMoveIterative(&cells, .white, .{
        .max_depth = 4,
        .max_nodes = 600000,
    });

    try testing.expectEqual(result.position.row, 6);
    try testing.expectEqual(result.position.col, 9);
}
