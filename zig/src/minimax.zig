/// Minimax探索コア（TT/Move Ordering統合版）
///
/// Alpha-Beta + NMP/LMR/Futility/PVS/Threat Extension
/// TS版 minimaxCore.ts に対応
const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const incremental_eval = @import("incremental_eval.zig");
const move_gen = @import("move_gen.zig");
const move_order = @import("move_order.zig");
const position_eval = @import("position_eval.zig");
const quiescence = @import("quiescence.zig");
const scores = @import("scores.zig");
const tt_mod = @import("tt.zig");
const vcf_mod = @import("vcf.zig");
const vct_mod = @import("vct.zig");
const zobrist = @import("zobrist.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const DIRECTIONS = board_mod.DIRECTIONS;

pub const Position = @import("threats.zig").Position;

// =============================================================================
// 探索テクニック定数（TS版 techniques.ts に対応）
// =============================================================================

/// LMRを適用する候補手のインデックス閾値
const LMR_MOVE_THRESHOLD: u16 = 3;

/// LMRを適用する最小探索深度
const LMR_MIN_DEPTH: u8 = 3;

/// LMR フォールバック削減量
const LMR_REDUCTION: u8 = 1;

/// 非生産的四に対するLMR追加リダクション量
const LMR_PLAIN_FOUR_EXTRA_REDUCTION: u8 = 1;

/// NMP を適用する最小探索深度
const NMP_MIN_DEPTH: u8 = 3;

/// NMP による探索深度の削減量（動的: 深いほど積極的に刈る、R=3上限）
fn calcNmpReduction(depth: u8) u8 {
    // depth 3-5: R=2, depth 6+: R=3
    return @min(3, 2 + (depth -| 3) / 3);
}

/// 最大延長回数
const MAX_EXTENSIONS: u8 = 1;

/// Futility マージン（自分の手番）
const FUTILITY_MARGINS_SELF = [4]i32{ 0, 1000, 200, 1000 };

/// Futility マージン（相手の手番）
const FUTILITY_MARGINS_OPPONENT = [4]i32{ 0, 4100, 1300, 3000 };

/// LMR 対数テーブル（comptime生成）
const LMR_TABLE = blk: {
    const max_depth = 16;
    const max_moves = 32;
    var table: [max_depth][max_moves]u8 = undefined;
    for (0..max_depth) |d| {
        for (0..max_moves) |m| {
            if (d < 3 or m < 3) {
                table[d][m] = 0;
            } else {
                const log_d = @log(@as(f64, @floatFromInt(d)));
                const log_m = @log(@as(f64, @floatFromInt(m)));
                const val: i32 = @intFromFloat(@max(1.0, @floor(0.5 * log_d * log_m)));
                table[d][m] = @intCast(@max(1, val));
            }
        }
    }
    break :blk table;
};

fn getLMRReduction(depth: u8, move_index: u16) u8 {
    const d = @min(depth, 15);
    const m: u8 = @intCast(@min(move_index, 31));
    return LMR_TABLE[d][m];
}

// =============================================================================
// 探索コンテキスト
// =============================================================================

/// Counter-move テーブル: [row][col] => ?Position
pub const CounterMoveTable = [BOARD_SIZE][BOARD_SIZE]?Position;

pub fn initCounterMoveTable() CounterMoveTable {
    return [_][BOARD_SIZE]?Position{[_]?Position{null} ** BOARD_SIZE} ** BOARD_SIZE;
}

/// 探索統計
pub const SearchStats = struct {
    nodes: u32 = 0,
    tt_hits: u32 = 0,
    tt_cutoffs: u32 = 0,
    beta_cutoffs: u32 = 0,
    null_move_trials: u32 = 0,
    null_move_cutoffs: u32 = 0,
    futility_prunes: u32 = 0,
    threat_extensions: u32 = 0,
    lmr_trials: u32 = 0,
    lmr_researches: u32 = 0,
    q_search_nodes: u32 = 0,
    threat_probe_cutoffs: u32 = 0,
};

/// 探索コンテキスト
pub const SearchContext = struct {
    tt: *tt_mod.TranspositionTable,
    history: *move_order.HistoryTable,
    killers: *move_order.KillerMoves,
    counter_moves: *CounterMoveTable,
    stats: SearchStats,
    eval_options: position_eval.EvalOptions,
    board_eval_options: evaluate.EvalOptions,

    /// 探索停止タイムスタンプ（deadline ベース）
    deadline: u32 = 0,
    timeout_flag: bool = false,
    /// ノード数上限
    max_nodes: u32 = 0, // 0 = 無制限
    node_count_exceeded: bool = false,
    /// 絶対時間制限
    absolute_deadline: u32 = 0,
    absolute_deadline_exceeded: bool = false,

    /// 時間制限なしモード
    no_time_limit: bool = false,

    /// 探索打ち切り（時間切れ/ノード上限/絶対時間制限）が発生しているか
    pub inline fn isAborted(self: *const SearchContext) bool {
        return self.timeout_flag or self.node_count_exceeded or self.absolute_deadline_exceeded;
    }

    pub fn init(
        tt: *tt_mod.TranspositionTable,
        history: *move_order.HistoryTable,
        killers: *move_order.KillerMoves,
        counter_moves: *CounterMoveTable,
        eval_options: position_eval.EvalOptions,
        board_eval_options: evaluate.EvalOptions,
    ) SearchContext {
        return .{
            .tt = tt,
            .history = history,
            .killers = killers,
            .counter_moves = counter_moves,
            .stats = .{},
            .eval_options = eval_options,
            .board_eval_options = board_eval_options,
        };
    }
};

// =============================================================================
// 軽量脅威チェック（NMP用）
// =============================================================================

/// 相手に即座の脅威（四: 連続4個で片端以上開き）があるかを軽量にチェック
fn hasImmediateThreat(cells: []const Cell, opponent_color: Cell) bool {
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            if (cells[@as(u16, row) * BOARD_SIZE + col] != opponent_color) continue;

            for (DIRECTIONS) |dir| {
                if (hasFourInDirection(cells, row, col, dir.dr, dir.dc, opponent_color)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/// 指定位置から指定方向に四以上の連があるかチェック
fn hasFourInDirection(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) bool {
    // 重複カウント防止: 正方向の起点のみチェック
    const prev_r = @as(i16, row) - dr;
    const prev_c = @as(i16, col) - dc;
    if (board_mod.isValid(prev_r, prev_c) and
        cells[@intCast(@as(u16, @intCast(prev_r)) * BOARD_SIZE + @as(u16, @intCast(prev_c)))] == color)
    {
        return false;
    }

    // 正方向に連続する石の数をカウント
    var count: u8 = 1;
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;
    while (board_mod.isValid(r, c) and
        cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == color)
    {
        count += 1;
        r += dr;
        c += dc;
    }

    if (count < 4) return false;

    // 片端以上が空いていれば四
    const end1_open = board_mod.isValid(r, c) and
        cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .empty;
    const end2_open = board_mod.isValid(prev_r, prev_c) and
        cells[@intCast(@as(u16, @intCast(prev_r)) * BOARD_SIZE + @as(u16, @intCast(prev_c)))] == .empty;
    return end1_open or end2_open;
}

// =============================================================================
// Threat Extension: 四三判定
// =============================================================================

/// analyzeFourAndThree: 四と活三の有無を分析（石配置済み前提）
///
/// ⚠️ `has_five` の判定が色盲（`count >= 5`）で、黒の長連（6 連以上＝禁手で五ではない）も
/// 五として返す。#125 では「勝敗に効く五判定」（`forbidden.checkFive`）のみを
/// `forbidden.isFiveLength` に揃え、ここは**意図的に未変更**とした
/// （評価・move ordering 系の色盲な五扱いはまとめて別 issue #132 で扱う）。
pub fn analyzeFourAndThree(cells: []const Cell, row: u8, col: u8, color: Cell) struct { has_five: bool, has_four: bool, has_open_three: bool } {
    const jp = @import("jump_patterns.zig");
    var has_four = false;
    var has_open_three = false;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

        if (result.count >= 5) {
            return .{ .has_five = true, .has_four = false, .has_open_three = false };
        }

        // 四チェック
        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            has_four = true;
        }

        // 跳び四チェック
        const dir_index = jp.DIRECTION_INDICES[i];
        if (!has_four and result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, color)) {
            has_four = true;
        }

        // 活三チェック
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            has_open_three = true;
        }
    }

    return .{ .has_five = false, .has_four = has_four, .has_open_three = has_open_three };
}

/// Threat Extension の候補かどうか判定（自分の四三）
fn isThreatExtensionCandidate(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    const r = analyzeFourAndThree(cells, row, col, color);
    return !r.has_five and r.has_four and r.has_open_three;
}

// =============================================================================
// Threat Probe（脅威プローブ）
// =============================================================================

/// threatProbe の実行時トグル（Gate 0 計測用）。
/// probe 込み NPS は eval 退行を隠すため、probe 無効構成で NPS/time-to-depth を
/// 測る必要がある（docs/plans/eval-basis-prospect-2026-07-13.md §5 Gate 0）。
/// 既定 true なので既存の探索挙動・commit-bench 互換は不変。
pub var threat_probe_enabled: bool = true;

/// 深度適応型バジェット（TS版 threatProbe.ts の getThreatBudget に対応）
const ThreatBudget = struct {
    vcf_depth: u8,
    vcf_nodes: u32,
    vct_depth: u8,
    vct_nodes: u32,
};

fn getThreatBudget(minimax_depth: u8) ThreatBudget {
    if (minimax_depth >= 4) {
        return .{ .vcf_depth = 8, .vcf_nodes = 200, .vct_depth = 4, .vct_nodes = 500 };
    }
    // depth 3
    return .{ .vcf_depth = 6, .vcf_nodes = 100, .vct_depth = 0, .vct_nodes = 0 };
}

/// 脅威プローブ: 手番側のVCF/VCTをチェック
/// VCF/VCTが見つかれば初手を返す
fn threatProbe(
    cells: []Cell,
    color: Cell,
    minimax_depth: u8,
    no_time_limit: bool,
    // 防御ノード（相手の被詰み判定）では strict 耐性検証で偽の追い詰め
    // （幻の被詰み）を棄却する。攻めノードは lenient で真正VCTを取りこぼさない。
    defensive: bool,
) ?Position {
    const budget = getThreatBudget(minimax_depth);

    // VCF探索（軽量・常にチェック）。VCFは受け一意で偽陽性が出にくいため常に lenient。
    const vcf_time: u32 = if (no_time_limit) 0 else 20;
    const vcf_move = vcf_mod.findVCFMoveWithBudget(
        cells,
        color,
        budget.vcf_depth,
        vcf_time,
        budget.vcf_nodes,
    );
    if (vcf_move) |m| return m;

    // VCT探索（予算が許す場合のみ）
    if (budget.vct_depth > 0) {
        const vct_time: u32 = if (no_time_limit) 0 else 50;
        const vct_move = if (defensive)
            vct_mod.findVCTMoveWithBudgetStrict(
                cells,
                color,
                budget.vct_depth,
                vct_time,
                budget.vct_nodes,
            )
        else
            vct_mod.findVCTMoveWithBudget(
                cells,
                color,
                budget.vct_depth,
                vct_time,
                budget.vct_nodes,
            );
        if (vct_move) |m| return m;
    }

    return null;
}

// =============================================================================
// Minimax探索本体
// =============================================================================

/// 打ち切り時の静的評価に使う EvalOptions を返す。
///
/// eval_basis==.prospect のときのみ、その場の手番（is_maximizing）から
/// last_mover_is_perspective を上書きする（prospect は stm 供給が仕様のため）。
/// legacy のときは ctx.board_eval_options を無変更で返す — legacy パスの
/// 挙動・Elo を一切変えないため（TEMPO 割引が新たに発火してはならない）。
///
/// **stm 供給ルールの非対称性（quiescence.zig と対比）**: quiescence.zig の
/// quiescenceSearch は legacy/prospect どちらでも常時 is_maximizing から
/// last_mover_is_perspective を導出する（既存挙動・変更なし）。一方この
/// abortEvalOptions は **prospect のみ** stm を供給し、legacy は常に
/// ctx.board_eval_options（既定 .unset）のまま――legacy の TEMPO 割引を
/// minimax の abort 経路で新規発火させないための P1 実装決定。同じ「静的評価」
/// でも呼び出し元（minimax の abort 分岐 / quiescence の stand-pat）で stm 供給
/// ルールが異なる点に注意。
fn abortEvalOptions(ctx: *SearchContext, is_maximizing: bool) evaluate.EvalOptions {
    if (ctx.board_eval_options.eval_basis != .prospect) return ctx.board_eval_options;
    var opts = ctx.board_eval_options;
    // is_maximizing=true  → 現在手番は perspective → 最後の着手は相手 → .no
    // is_maximizing=false → 現在手番は相手         → 最後の着手は perspective → .yes
    opts.last_mover_is_perspective = if (is_maximizing) .no else .yes;
    return opts;
}

/// SearchContext から quiescence の打ち切り制御を構築する。
/// 制限のセマンティクス（deadline/ノード予算の意味）の SSoT は SearchContext 側にあり、
/// フィールド転記をここに一本化して呼び出し側とのドリフトを防ぐ。
fn qLimitsFrom(ctx: *SearchContext) quiescence.QLimits {
    return .{
        .node_counter = &ctx.stats.nodes,
        .max_nodes = ctx.max_nodes,
        .deadline = ctx.deadline,
        .absolute_deadline = ctx.absolute_deadline,
        .no_time_limit = ctx.no_time_limit,
        .timeout_flag = &ctx.timeout_flag,
    };
}

/// Minimax探索（TT/Move Ordering統合版）
pub fn minimaxWithTT(
    cells: []Cell,
    hash: u64,
    depth: u8,
    is_maximizing: bool,
    perspective: Cell,
    alpha_init: i32,
    beta_init: i32,
    last_move: ?Position,
    ctx: *SearchContext,
    allow_null_move: bool,
    extensions: u8,
) i32 {
    ctx.stats.nodes += 1;

    // ノード数上限チェック
    if (!ctx.node_count_exceeded and ctx.max_nodes > 0 and ctx.stats.nodes >= ctx.max_nodes) {
        ctx.node_count_exceeded = true;
    }

    // 時間制限チェック（一定ノード数ごと）
    if (!ctx.no_time_limit and ctx.stats.nodes % 4 == 0) {
        if (!ctx.timeout_flag and ctx.deadline > 0) {
            const now = getTimestampMs();
            if (now >= ctx.deadline) {
                ctx.timeout_flag = true;
            }
            if (!ctx.absolute_deadline_exceeded and ctx.absolute_deadline > 0 and now >= ctx.absolute_deadline) {
                ctx.absolute_deadline_exceeded = true;
            }
        }
    }

    // タイムアウト/ノード上限時は静的評価を返す（インクリメンタル評価を使用）
    if (ctx.isAborted()) {
        return incremental_eval.getEvaluation(cells, perspective, abortEvalOptions(ctx, is_maximizing));
    }

    // 現在の手番を決定
    const current_color = if (is_maximizing) perspective else perspective.opposite();
    const last_move_color = current_color.opposite();

    var alpha = alpha_init;
    var beta = beta_init;

    // 終端条件チェック（最後の手で五連完成）
    if (last_move) |lm| {
        if (forbidden.checkFive(cells, lm.row, lm.col, last_move_color)) {
            if (last_move_color == perspective) {
                return scores.FIVE;
            }
            return -scores.FIVE;
        }
    }

    // TTプローブ
    const tt_entry = ctx.tt.probe(hash);
    var tt_move: ?Position = null;

    if (tt_entry) |entry| {
        if (entry.depth >= @as(i8, @intCast(depth))) {
            ctx.stats.tt_hits += 1;

            switch (entry.score_type) {
                .exact => {
                    ctx.stats.tt_cutoffs += 1;
                    return entry.score;
                },
                .lower_bound => {
                    alpha = @max(alpha, entry.score);
                },
                .upper_bound => {
                    beta = @min(beta, entry.score);
                },
            }

            if (alpha >= beta) {
                ctx.stats.tt_cutoffs += 1;
                return entry.score;
            }

            tt_move = entry.getBestMove();
        } else {
            tt_move = entry.getBestMove();
        }
    }

    // =========================================================================
    // Threat Probe: 手番側のVCFをチェック
    // VCFがあれば勝ちスコア(FIVE-1)でカットオフ
    // =========================================================================
    if (threat_probe_enabled and depth >= 3) {
        // !is_maximizing = 相手手番ノード = 自分の被詰み判定 → strict で幻を棄却。
        const threat_result = threatProbe(
            cells,
            current_color,
            depth,
            ctx.no_time_limit,
            !is_maximizing,
        );
        if (threat_result) |threat_move| {
            ctx.stats.threat_probe_cutoffs += 1;
            // FIVE - 1: threatProbe による追詰検出マーカー
            const threat_score = scores.FIVE - 1;
            const score = if (is_maximizing) threat_score else -threat_score;
            ctx.tt.store(hash, score, @intCast(depth), .exact, threat_move);
            return score;
        }
    }

    // 探索深度が0になった場合はQuiescence Search
    if (depth == 0) {
        var q_stats = quiescence.QSearchStats{};
        const score = quiescence.quiescenceSearch(
            cells,
            hash,
            is_maximizing,
            perspective,
            alpha,
            beta,
            last_move,
            ctx.board_eval_options,
            quiescence.MAX_QUIESCENCE_DEPTH,
            &q_stats,
            qLimitsFrom(ctx),
            ctx.tt,
        );
        ctx.stats.q_search_nodes += q_stats.q_search_nodes;
        return score;
    }

    // Null Move Pruning (NMP)
    if (ctx.eval_options.enable_counter_four and // NMP有効化フラグとして再利用
        allow_null_move and
        depth >= NMP_MIN_DEPTH and
        !hasImmediateThreat(cells, current_color.opposite()))
    {
        ctx.stats.null_move_trials += 1;
        const nmp_r = calcNmpReduction(depth);
        const nmp_depth = if (depth > 1 + nmp_r) depth - 1 - nmp_r else 0;
        const nmp_score = minimaxWithTT(
            cells,
            hash,
            nmp_depth,
            !is_maximizing,
            perspective,
            alpha,
            beta,
            null, // NMPでは手を打たない
            ctx,
            false, // 連続NMP防止
            extensions,
        );
        // NMP子探索中の打ち切り検出: nmp_score には static eval が混入している可能性があり、
        // 偽の beta-cutoff で汚染値を返さないよう、冒頭の早期 latch と同じ形で静的評価に落とす。
        if (ctx.isAborted()) {
            return incremental_eval.getEvaluation(cells, perspective, abortEvalOptions(ctx, is_maximizing));
        }
        if (if (is_maximizing) nmp_score >= beta else nmp_score <= alpha) {
            ctx.stats.null_move_cutoffs += 1;
            return nmp_score;
        }
    }

    // ソート済み候補手生成
    const use_static_eval = depth > 1 or ctx.eval_options.enable_mandatory_defense;
    const max_static_eval_count: ?u16 = if (depth >= 4) 3 else if (depth >= 3) 5 else 8;
    const is_black_turn = current_color == .black;

    // Counter-move取得
    const counter_move = if (last_move) |lm| ctx.counter_moves[lm.row][lm.col] else null;

    const sort_result = move_order.generateSortedMoves(
        cells,
        current_color,
        .{
            .tt_move = tt_move,
            .killers = ctx.killers,
            .depth = depth,
            .history = ctx.history,
            .counter_move = counter_move,
            .use_static_eval = use_static_eval,
            .eval_options = ctx.eval_options,
            .max_static_eval_count = max_static_eval_count,
        },
        is_black_turn, // 黒番は禁手判定を遅延
    );
    const moves = &sort_result.moves;

    if (moves.len == 0) {
        return 0;
    }

    var best_move: ?Position = null;
    var best_score: i32 = if (is_maximizing) -scores.INFINITY else scores.INFINITY;
    var score_type: tt_mod.ScoreType = if (is_maximizing) .upper_bound else .lower_bound;
    // 打ち切りフラグ: abort 後に不完全スコアを TT に書かないために使う
    var aborted = false;

    var move_index: u16 = 0;
    while (move_index < moves.len) : (move_index += 1) {
        const move = moves.items[move_index];

        // 遅延禁手判定（黒番の場合）
        if (is_black_turn) {
            if (!forbidden.checkFive(cells, move.row, move.col, .black)) {
                const forbidden_result = forbidden.checkForbiddenMove(cells, move.row, move.col);
                if (forbidden_result != .none) {
                    continue;
                }
            }
        }

        // Futility Pruning（depth 1-3 の非戦術手をスキップ）
        if (ctx.eval_options.enable_single_four_penalty and // Futility有効化フラグとして再利用
            depth >= 1 and depth <= 3 and
            move_index > 0 and
            best_score > -scores.FIVE + 5000 and
            best_score < scores.FIVE - 5000)
        {
            const futility_margins = if (is_maximizing) FUTILITY_MARGINS_SELF else FUTILITY_MARGINS_OPPONENT;
            const futility_margin = futility_margins[depth];
            const static_eval = position_eval.evaluatePosition(
                cells,
                move.row,
                move.col,
                current_color,
                ctx.eval_options,
            );
            if (if (is_maximizing) static_eval + futility_margin <= alpha else static_eval - futility_margin >= beta) {
                ctx.stats.futility_prunes += 1;
                continue;
            }
        }

        const can_apply_lmr = move_index >= LMR_MOVE_THRESHOLD and
            depth >= LMR_MIN_DEPTH and
            best_score > -scores.FIVE + 1000;

        // 石を配置（cells, bitboard, incremental eval_state を同期更新）
        incremental_eval.placeStone(cells, move.row, move.col, current_color);
        const new_hash = zobrist.updateHash(hash, move.row, move.col, current_color);

        // Threat Extension: 四三成立時に探索を1手延長
        var extension: u8 = 0;
        if (extensions < MAX_EXTENSIONS and isThreatExtensionCandidate(cells, move.row, move.col, current_color)) {
            extension = 1;
            ctx.stats.threat_extensions += 1;
        }

        const new_extensions = extensions + extension;
        const effective_depth = depth - 1 + extension;

        // 戦術パターン判定（LMR調整用）
        var is_plain_four = false;
        var is_open_three_move = false;
        if (move_index >= 1 and depth >= LMR_MIN_DEPTH) {
            const ft = analyzeFourAndThree(cells, move.row, move.col, current_color);
            is_plain_four = !ft.has_five and ft.has_four and !ft.has_open_three;
            is_open_three_move = !ft.has_five and ft.has_open_three;
        }

        var score: i32 = 0;

        // PVS + LMR
        if (move_index == 0) {
            // PV手: フルウィンドウ
            score = minimaxWithTT(
                cells,
                new_hash,
                effective_depth,
                !is_maximizing,
                perspective,
                alpha,
                beta,
                move,
                ctx,
                true,
                new_extensions,
            );
        } else if ((can_apply_lmr and !is_open_three_move) or is_plain_four) {
            // LMR + PVS
            const base_reduction = getLMRReduction(effective_depth, move_index);
            const reduction = if (is_plain_four) base_reduction + LMR_PLAIN_FOUR_EXTRA_REDUCTION else base_reduction;

            ctx.stats.lmr_trials += 1;

            if (is_maximizing) {
                score = lmrPvsMaximizing(cells, new_hash, effective_depth, reduction, perspective, alpha, beta, move, ctx, new_extensions);
            } else {
                score = lmrPvsMinimizing(cells, new_hash, effective_depth, reduction, perspective, alpha, beta, move, ctx, new_extensions);
            }
        } else {
            // 非LMR手: Null Window
            if (is_maximizing) {
                score = minimaxWithTT(cells, new_hash, effective_depth, false, perspective, alpha, alpha + 1, move, ctx, true, new_extensions);
                if (score > alpha and score < beta) {
                    score = minimaxWithTT(cells, new_hash, effective_depth, false, perspective, alpha, beta, move, ctx, true, new_extensions);
                }
            } else {
                score = minimaxWithTT(cells, new_hash, effective_depth, true, perspective, beta - 1, beta, move, ctx, true, new_extensions);
                if (score < beta and score > alpha) {
                    score = minimaxWithTT(cells, new_hash, effective_depth, true, perspective, alpha, beta, move, ctx, true, new_extensions);
                }
            }
        }

        // 石を元に戻す
        incremental_eval.removeStone(cells, move.row, move.col);

        // 打ち切り検出: 子の再帰中に abort が発生した場合、子の子孫が static eval を
        // 返しているため子スコアが汚染されている（間接汚染）。そのスコアを best_score に
        // 取り込む前に脱出し、上位への汚染伝播を防ぐ。
        // quiescence.zig の同等箇所（"打ち切り（ノード予算/時間切れ）が起きたら…"）と同じ意味論。
        if (ctx.isAborted()) {
            aborted = true;
            break;
        }

        // スコア更新
        if (is_maximizing) {
            if (score > best_score) {
                best_score = score;
                best_move = move;
            }
            alpha = @max(alpha, score);
        } else {
            if (score < best_score) {
                best_score = score;
                best_move = move;
            }
            beta = @min(beta, score);
        }

        // 剪定チェック
        if (beta <= alpha) {
            ctx.stats.beta_cutoffs += 1;
            ctx.killers.record(depth, move);
            ctx.history.update(move, depth);
            // Counter-move記録
            if (last_move) |lm| {
                ctx.counter_moves[lm.row][lm.col] = move;
            }
            score_type = if (is_maximizing) .lower_bound else .upper_bound;
            break;
        }
    }

    // 打ち切り時は不完全な best_score を TT に書かない（TT汚染防止）。
    // static eval が混入したスコアをフル depth クレジット付きで保存すると、
    // 後続探索で exact cutoff として誤用される。quiescence.zig の同等処理と揃える。
    if (aborted) {
        // 1手も完了せず best_score が初期値のままなら static eval にフォールバック
        if (best_score == scores.INFINITY or best_score == -scores.INFINITY) {
            return incremental_eval.getEvaluation(cells, perspective, abortEvalOptions(ctx, is_maximizing));
        }
        return best_score;
    }

    // スコアタイプを決定
    if (beta > alpha) {
        if (is_maximizing and best_score > alpha_init) {
            score_type = .exact;
        } else if (!is_maximizing and best_score < beta_init) {
            score_type = .exact;
        }
    }

    // TTに保存
    ctx.tt.store(hash, best_score, @intCast(depth), score_type, best_move);

    return best_score;
}

// =============================================================================
// LMR + PVS ヘルパー
// =============================================================================

fn lmrPvsMaximizing(
    cells: []Cell,
    new_hash: u64,
    effective_depth: u8,
    reduction: u8,
    perspective: Cell,
    alpha: i32,
    beta: i32,
    move: Position,
    ctx: *SearchContext,
    new_extensions: u8,
) i32 {
    const reduced_depth = if (effective_depth > reduction) effective_depth - reduction else 0;
    // LMR + Null Window
    var score = minimaxWithTT(cells, new_hash, reduced_depth, false, perspective, alpha, alpha + 1, move, ctx, true, new_extensions);
    if (score > alpha) {
        ctx.stats.lmr_researches += 1;
        // Null Window 再探索（フル深度）
        score = minimaxWithTT(cells, new_hash, effective_depth, false, perspective, alpha, alpha + 1, move, ctx, true, new_extensions);
        if (score > alpha and score < beta) {
            // フル再探索（PVノード）
            score = minimaxWithTT(cells, new_hash, effective_depth, false, perspective, alpha, beta, move, ctx, true, new_extensions);
        }
    }
    return score;
}

fn lmrPvsMinimizing(
    cells: []Cell,
    new_hash: u64,
    effective_depth: u8,
    reduction: u8,
    perspective: Cell,
    alpha: i32,
    beta: i32,
    move: Position,
    ctx: *SearchContext,
    new_extensions: u8,
) i32 {
    const reduced_depth = if (effective_depth > reduction) effective_depth - reduction else 0;
    // LMR + Null Window
    var score = minimaxWithTT(cells, new_hash, reduced_depth, true, perspective, beta - 1, beta, move, ctx, true, new_extensions);
    if (score < beta) {
        ctx.stats.lmr_researches += 1;
        // Null Window 再探索（フル深度）
        score = minimaxWithTT(cells, new_hash, effective_depth, true, perspective, beta - 1, beta, move, ctx, true, new_extensions);
        if (score < beta and score > alpha) {
            // フル再探索（PVノード）
            score = minimaxWithTT(cells, new_hash, effective_depth, true, perspective, alpha, beta, move, ctx, true, new_extensions);
        }
    }
    return score;
}

// =============================================================================
// findBestMoveWithTT（ルート探索）
// =============================================================================

/// 候補手のスコア情報
pub const MoveScoreEntry = struct {
    move: Position,
    score: i32,
};

/// ルート探索結果
pub const MinimaxResult = struct {
    position: Position,
    score: i32,
    candidates: [move_gen.MAX_MOVES]MoveScoreEntry = undefined,
    candidate_count: u16 = 0,
};

/// Aspiration Windowsの段階的拡大幅
pub const ASPIRATION_WIDTHS = [3]i32{ 75, 200, 500 };

/// 最善手を探索（TT統合版）
pub fn findBestMoveWithTT(
    cells: []Cell,
    color: Cell,
    depth: u8,
    ctx: *SearchContext,
    aspiration_prev_score: ?i32,
    aspiration_window_size: i32,
    restricted_moves: ?*const move_gen.MoveList,
) MinimaxResult {
    const hash = zobrist.computeBoardHash(cells);

    // TTからの前回の最善手を取得
    const tt_entry = ctx.tt.probe(hash);
    const tt_move = if (tt_entry) |e| e.getBestMove() else null;

    // 候補手生成
    var moves: move_gen.MoveList = undefined;
    if (restricted_moves) |rm| {
        moves = rm.*;
    } else {
        const sort_result = move_order.generateSortedMoves(
            cells,
            color,
            .{
                .tt_move = tt_move,
                .killers = ctx.killers,
                .depth = depth,
                .history = ctx.history,
                .use_static_eval = true,
                .eval_options = ctx.eval_options,
            },
            false,
        );
        moves = sort_result.moves;
    }

    if (moves.len == 0) {
        return .{
            .position = .{ .row = 7, .col = 7 },
            .score = 0,
        };
    }

    if (moves.len == 1) {
        const m = moves.items[0];
        const score = position_eval.evaluatePosition(cells, m.row, m.col, color, ctx.eval_options);
        var result = MinimaxResult{
            .position = m,
            .score = score,
        };
        result.candidates[0] = .{ .move = m, .score = score };
        result.candidate_count = 1;
        return result;
    }

    var move_scores: [move_gen.MAX_MOVES]MoveScoreEntry = undefined;
    var move_score_count: u16 = 0;

    // Aspiration Windows
    const window_size = aspiration_window_size;
    var alpha: i32 = if (aspiration_prev_score) |prev| prev - window_size else -scores.INFINITY;
    const beta: i32 = if (aspiration_prev_score) |prev| prev + window_size else scores.INFINITY;

    for (0..moves.len) |mi| {
        // タイムアウトチェック
        if (ctx.isAborted()) {
            break;
        }

        const move = moves.items[mi];

        // 石を配置（cells, bitboard, incremental eval_state を同期更新）
        incremental_eval.placeStone(cells, move.row, move.col, color);
        const new_hash = zobrist.updateHash(hash, move.row, move.col, color);

        const score = minimaxWithTT(
            cells,
            new_hash,
            depth - 1,
            false,
            color,
            alpha,
            beta,
            move,
            ctx,
            true,
            0,
        );

        // 石を除去
        incremental_eval.removeStone(cells, move.row, move.col);

        move_scores[move_score_count] = .{ .move = move, .score = score };
        move_score_count += 1;
        alpha = @max(alpha, score);
    }

    // スコア降順ソート
    sortMoveScores(move_scores[0..move_score_count]);

    if (move_score_count == 0) {
        return .{
            .position = .{ .row = 7, .col = 7 },
            .score = 0,
        };
    }

    var result = MinimaxResult{
        .position = move_scores[0].move,
        .score = move_scores[0].score,
        .candidate_count = move_score_count,
    };
    @memcpy(result.candidates[0..move_score_count], move_scores[0..move_score_count]);
    return result;
}

/// MoveScoreEntryをスコア降順でソート
fn sortMoveScores(entries: []MoveScoreEntry) void {
    if (entries.len <= 1) return;

    // Insertion sort
    var i: usize = 1;
    while (i < entries.len) : (i += 1) {
        const key = entries[i];
        var j: usize = i;
        while (j > 0 and entries[j - 1].score < key.score) : (j -= 1) {
            entries[j] = entries[j - 1];
        }
        entries[j] = key;
    }
}

// =============================================================================
// タイムスタンプ取得（WASM用）
// =============================================================================

/// WASM外部関数: タイムスタンプ（ミリ秒）を取得
/// WASM環境ではJSから注入
extern fn getTimestampMsExternal() u32;

/// ネイティブテスト時は0を返す（タイムアウトなし）
fn getTimestampMs() u32 {
    if (@import("builtin").cpu.arch == .wasm32) {
        return getTimestampMsExternal();
    }
    // ネイティブテストでは時間制限なし
    return 0;
}

// === Tests ===

const testing = std.testing;

test "threat_probe_enabled=false: threatProbeによるcutoffが発生しない（深さ3以上、VCFがある局面）" {
    defer threat_probe_enabled = true;

    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    // 黒の活四: (7,4)(7,5)(7,6)(7,7)。threatProbeのVCF検出が確実に発火する局面
    // （findVCFMove: immediate five と同一フィクスチャ）。
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });

    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };

    const board_eval_options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };

    threat_probe_enabled = true;
    {
        tt.clear();
        var history = move_order.HistoryTable.init();
        var killers = move_order.KillerMoves.init();
        var counter_moves = initCounterMoveTable();
        var ctx = SearchContext.init(&tt, &history, &killers, &counter_moves, position_eval.DEFAULT_EVAL_OPTIONS, board_eval_options);
        ctx.no_time_limit = true;
        _ = minimaxWithTT(&cells, 0, 3, true, .black, -scores.INFINITY, scores.INFINITY, null, &ctx, true, 0);
        try testing.expect(ctx.stats.threat_probe_cutoffs > 0);
    }

    threat_probe_enabled = false;
    {
        tt.clear();
        var history = move_order.HistoryTable.init();
        var killers = move_order.KillerMoves.init();
        var counter_moves = initCounterMoveTable();
        var ctx = SearchContext.init(&tt, &history, &killers, &counter_moves, position_eval.DEFAULT_EVAL_OPTIONS, board_eval_options);
        ctx.no_time_limit = true;
        _ = minimaxWithTT(&cells, 0, 3, true, .black, -scores.INFINITY, scores.INFINITY, null, &ctx, true, 0);
        try testing.expectEqual(@as(u32, 0), ctx.stats.threat_probe_cutoffs);
    }
}

test "minimaxWithTT basic: empty board" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 天元に黒石
    cells[7 * BOARD_SIZE + 7] = .black;

    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });

    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    var history = move_order.HistoryTable.init();
    var killers = move_order.KillerMoves.init();
    var counter_moves = initCounterMoveTable();

    var ctx = SearchContext.init(
        &tt,
        &history,
        &killers,
        &counter_moves,
        position_eval.DEFAULT_EVAL_OPTIONS,
        .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        },
    );
    ctx.no_time_limit = true;

    const score = minimaxWithTT(
        &cells,
        0,
        1,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        Position{ .row = 7, .col = 7 },
        &ctx,
        true,
        0,
    );
    // 深さ1の探索は何らかのスコアを返す
    _ = score;
    try testing.expect(ctx.stats.nodes > 0);
}

test "findBestMoveWithTT basic" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;

    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    var history = move_order.HistoryTable.init();
    var killers = move_order.KillerMoves.init();
    var counter_moves = initCounterMoveTable();

    var ctx = SearchContext.init(
        &tt,
        &history,
        &killers,
        &counter_moves,
        position_eval.DEFAULT_EVAL_OPTIONS,
        .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        },
    );
    ctx.no_time_limit = true;

    const result = findBestMoveWithTT(&cells, .black, 2, &ctx, null, ASPIRATION_WIDTHS[0], null);
    // 何らかの有効な位置を返すこと
    try testing.expect(result.position.row < BOARD_SIZE);
    try testing.expect(result.position.col < BOARD_SIZE);
    try testing.expect(result.candidate_count > 0);
}

test "LMR table values" {
    // depth=3, moveIndex=3 → 最低1
    try testing.expect(getLMRReduction(3, 3) >= 1);
    // depth=0 → 0
    try testing.expectEqual(getLMRReduction(0, 5), 0);
    // moveIndex=0 → 0
    try testing.expectEqual(getLMRReduction(5, 0), 0);
}

/// 序盤の均衡局面（minimax テスト用）。
/// 黒白が互い違いに散在し VCF/VCT がすぐには成立しない構造にする。
/// threat probe が早期に切らないため depth 3 探索で多数のノードが展開される。
fn setupMinimaxTacticalPosition(cells: *[board_mod.CELL_COUNT]Cell) void {
    @memset(cells, .empty);
    // 黒白が交互に配置された序盤局面 (天元周辺)。
    // initFromBoard 呼び出し元が bitboard/ll の初期化も行うため、ここでは cells の値設定のみ。
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 7] = .white;
    cells[8 * BOARD_SIZE + 8] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 6] = .white;
}

test "minimaxWithTT: ノード上限到達後は不完全スコアをTTに保存しない" {
    const ll = @import("line_lookup.zig");
    ll.init();

    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells: [CELL_COUNT]Cell = undefined;
    setupMinimaxTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });

    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };

    // 共通のコンテキスト設定
    const eval_opts = position_eval.DEFAULT_EVAL_OPTIONS;
    const board_eval_opts = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };

    // --- (a) 無制限で depth 3 探索: 総ノード数を測定 ---
    tt.clear();
    var history_full = move_order.HistoryTable.init();
    var killers_full = move_order.KillerMoves.init();
    var counter_moves_full = initCounterMoveTable();
    var ctx_full = SearchContext.init(&tt, &history_full, &killers_full, &counter_moves_full, eval_opts, board_eval_opts);
    ctx_full.no_time_limit = true;

    const root_hash = zobrist.computeBoardHash(&cells);
    _ = minimaxWithTT(
        &cells,
        root_hash,
        3,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        &ctx_full,
        true,
        0,
    );
    const full_nodes = ctx_full.stats.nodes;
    // 前提: 戦術局面で十分なノードを展開している（少なすぎると打ち切り経路を踏まない）
    try testing.expect(full_nodes > 50);

    // --- (b) ノード上限 = 全体の 1/4 で再探索: abort が確実に起きる ---
    tt.clear();
    var history_cap = move_order.HistoryTable.init();
    var killers_cap = move_order.KillerMoves.init();
    var counter_moves_cap = initCounterMoveTable();
    var ctx_cap = SearchContext.init(&tt, &history_cap, &killers_cap, &counter_moves_cap, eval_opts, board_eval_opts);
    ctx_cap.no_time_limit = true;
    ctx_cap.max_nodes = full_nodes / 4;

    _ = minimaxWithTT(
        &cells,
        root_hash,
        3,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        &ctx_cap,
        true,
        0,
    );

    // ノード上限に達したことを確認
    try testing.expect(ctx_cap.node_count_exceeded);

    // ルート局面の TT エントリが存在しないこと（不完全スコアが保存されていない）。
    // abort 後は store をスキップするため、クリア後のエントリは null のまま。
    const entry = tt.probe(root_hash);
    try testing.expect(entry == null);
}
