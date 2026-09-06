/// 反復深化探索 + 事前チェック
///
/// Iterative Deepening + Aspiration Windows + 事前チェック（VCF/脅威防御）
/// TS版 iterativeDeepening.ts + preSearch.ts に対応
const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const budget_mod = @import("budget.zig");
const deadline_mod = @import("deadline.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const incremental_eval = @import("incremental_eval.zig");
const ll = @import("line_lookup.zig");
const mise_vcf = @import("mise_vcf.zig");
const minimax = @import("minimax.zig");
const move_gen = @import("move_gen.zig");
const move_order = @import("move_order.zig");
const position_eval = @import("position_eval.zig");
const scores = @import("scores.zig");
const threats_mod = @import("threats.zig");
const tt_mod = @import("tt.zig");
const vcf_mod = @import("vcf.zig");
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
    /// 事前探索（VCF / 相手 VCF / ミセ VCF / VCT）が消費したノード数
    nodes: u32 = 0,
};

/// 即勝ち手を探す（五連を完成できる位置）
fn findWinningMove(cells: []Cell, color: Cell) ?Position {
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;

            // 仮配置してチェック（bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);
            const is_five = forbidden.checkFive(cells, r, c, color);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (is_five) {
                return .{ .row = r, .col = c };
            }
        }
    }
    return null;
}

/// pre-search 全体の壁時計上限（ms）
///
/// 内訳は自分の VCF 150 + 相手 VCF 150 + VCT 300。issue #147 B 以前は各段が
/// 独立した予算を持ち、しかも内部の VCF/VCT が予算を復活させていたため
/// 名目 300ms の VCT が実測 494ms まで伸びていた。ここを親 limiter にして
/// 各段を `child()` で作ることで「前段が食った分だけ後段が短くなる」ようにする。
pub const PRE_SEARCH_TIME_LIMIT: u32 = vcf_mod.VCF_TIME_LIMIT * 2 + vct.VCT_TIME_LIMIT;

/// pre-search 全体のノード予算（決定的モード。設計メモ bench-fixed-nodes §2.2）
///
/// 時間モードの 600ms（`PRE_SEARCH_TIME_LIMIT`）に対応する親予算。各段は
/// 自前のノード予算（`VCF_PRE_NODES_DETERMINISTIC` など）で回り、段の境目と
/// ミセ VCF の候補ループ先頭でこの親予算を見る。**未較正**の初期値（較正は §4 手順 1）。
pub const PRE_SEARCH_NODE_BUDGET_DETERMINISTIC: u32 = 40_000;

/// 必須手の事前チェック
///
/// `policy.deterministic` なら壁時計を見ず、親 limiter と各段をノード予算で縛る。
/// 時間モードでは従来どおり 600ms の親 limiter（各段の子は時間のみ、相手 VCF は 3000 ノード）。
/// 消費ノードの合計は `PreSearchResult.nodes`（= 親 limiter への charge 合計）で返す。
pub fn findPreSearchMove(
    cells: []Cell,
    color: Cell,
    policy: budget_mod.BudgetPolicy,
) PreSearchResult {
    // pre-search 全体の予算（issue #147 B）。各段はこの残りを継承した子で回る。
    var pre_limiter = vcf_mod.TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = if (policy.deterministic) 0 else PRE_SEARCH_TIME_LIMIT,
        .nodes = 0,
        .max_nodes = policy.pre_search_nodes,
    };

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

    // 各段の壁時計予算（決定的モードでは 0 ＝ ノード予算のみ）
    const stage_vcf_time: u32 = if (policy.deterministic) 0 else vcf_mod.VCF_TIME_LIMIT;
    const stage_vct_time: u32 = if (policy.deterministic) 0 else vct.VCT_TIME_LIMIT;

    // VCF勝ち手を探す（親の残り予算を継承し、消費を親へ計上する。設計メモ bench-fixed-nodes §2.2）
    const vcf_move = vcf_mod.findVCFMoveWithParent(cells, color, vcf_mod.VCF_MAX_DEPTH, stage_vcf_time, policy.pre_vcf_nodes, &pre_limiter);
    if (vcf_move) |vm| {
        return .{
            .immediate_move = vm,
            .immediate_score = scores.FIVE - 10,
            .nodes = pre_limiter.nodes,
        };
    }

    // 相手VCFチェック（Mise-VCFスキップ判定用）
    const opponent_has_vcf = vcf_mod.hasVCFWithParent(cells, opponent_color, vcf_mod.VCF_MAX_DEPTH, stage_vcf_time, policy.pre_opp_vcf_nodes, &pre_limiter);

    // Mise-VCF（ミセ→強制応手→VCF勝ち）
    // 相手VCFがある場合は間に合わないのでスキップ
    if (!opponent_has_vcf) {
        const mise_move = mise_vcf.findMiseVCFMoveWithParent(cells, color, &pre_limiter);
        if (mise_move) |mm| {
            // 黒番の禁手チェック
            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, mm.row, mm.col);
                if (fr == .none) {
                    return .{
                        .immediate_move = mm,
                        .immediate_score = scores.FIVE - 15,
                        .nodes = pre_limiter.nodes,
                    };
                }
            } else {
                return .{
                    .immediate_move = mm,
                    .immediate_score = scores.FIVE - 15,
                    .nodes = pre_limiter.nodes,
                };
            }
        }
    }

    // VCT勝ち手を探す
    const vct_move = vct.findVCTMoveWithParent(cells, color, vct.VCT_MAX_DEPTH, stage_vct_time, policy.pre_vct_nodes, &pre_limiter, .lenient);
    if (vct_move) |vm| {
        return .{
            .immediate_move = vm,
            .immediate_score = scores.FIVE - 20,
            .nodes = pre_limiter.nodes,
        };
    }

    return .{ .threats = threat_info, .nodes = pre_limiter.nodes };
}

// =============================================================================
// 反復深化探索
// =============================================================================

/// Aspiration Windowの段階的拡大幅
const ASPIRATION_WIDTHS = minimax.ASPIRATION_WIDTHS;
/// 固定幅モード（mode 0）: 最初の1要素のみ使用
const ASPIRATION_WIDTHS_FIXED = [1]i32{ASPIRATION_WIDTHS[0]};

/// aspiration window fail による再探索回数（Gate 0 計測用）。
/// 1深度あたり最初の1回の探索は数えず、幅を広げた再試行・フルウィンドウ
/// フォールバックの追加探索回数のみを数える。findBestMoveIterative の開始時に
/// リセットする（main.zig の getAspirationResearchCount export で読み出す。
/// stats_buffer のレイアウトは commit-bench 互換のため変更しない＝独立 export）。
pub var aspiration_research_count: u32 = 0;

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

// =============================================================================
// 非生産的四の引き下げ
// =============================================================================

const PLAIN_FOUR_PREFERENCE_MARGIN: i32 = 200;
const PLAIN_FOUR_VCF_CHECK_TIME_LIMIT: u32 = 50;
/// 降格判定 VCF のノード予算（決定的モード。時間モードは `PLAIN_FOUR_VCF_CHECK_TIME_LIMIT` のみ）
/// **未較正**の初期値（VCF は安いので 2〜3k 程度。較正は設計メモ §4 手順 1）。
pub const PLAIN_FOUR_VCF_CHECK_NODES_DETERMINISTIC: u32 = 3000;

/// 非生産的四の優先度引き下げ
///
/// 最善手が非生産的四（四を作るが活三を伴わない）で、非四手との
/// スコア差がマージン内なら非四手を優先する。
/// 四+ブロックの水平線効果でスコアが膨らんでいる疑いを補正する。
///
/// VCFがある場合はdemoteしない。
fn demotePlainFourIfNeeded(
    result: *IterativeDeepingResult,
    cells: []Cell,
    color: Cell,
    policy: budget_mod.BudgetPolicy,
) void {
    // 候補が2つ未満なら何もしない
    if (result.top_candidate_count < 2) return;

    // 最善手を仮配置して非生産的四か判定（bitboard も同期）
    const best = result.position;
    const idx = @as(u16, best.row) * BOARD_SIZE + best.col;
    cells[idx] = color;
    bitboard.placeStone(best.row, best.col, color);
    const ft = minimax.analyzeFourAndThree(cells, best.row, best.col, color);
    cells[idx] = .empty;
    bitboard.removeStone(best.row, best.col);

    const is_plain_four = !ft.has_five and ft.has_four and !ft.has_open_three;
    if (!is_plain_four) return;

    // VCF安全チェック（決定的モードではノード予算。設計メモ bench-fixed-nodes §2.2。
    // この消費は stats に計上しない）
    const vcf_move = if (policy.deterministic)
        vcf_mod.findVCFMoveWithBudget(cells, color, vcf_mod.VCF_MAX_DEPTH, 0, policy.demote_vcf_nodes)
    else
        vcf_mod.findVCFMove(cells, color, vcf_mod.VCF_MAX_DEPTH, PLAIN_FOUR_VCF_CHECK_TIME_LIMIT);
    if (vcf_move != null) return;

    // 候補手から最初の非・非生産的四手を探す
    for (0..result.top_candidate_count) |i| {
        const entry = result.top_candidates[i];
        const eidx = @as(u16, entry.move.row) * BOARD_SIZE + entry.move.col;
        cells[eidx] = color;
        bitboard.placeStone(entry.move.row, entry.move.col, color);
        const eft = minimax.analyzeFourAndThree(cells, entry.move.row, entry.move.col, color);
        cells[eidx] = .empty;
        bitboard.removeStone(entry.move.row, entry.move.col);

        const entry_is_plain_four = !eft.has_five and eft.has_four and !eft.has_open_three;
        if (!entry_is_plain_four) {
            if (result.score - entry.score < PLAIN_FOUR_PREFERENCE_MARGIN) {
                result.position = entry.move;
                result.score = entry.score;
            }
            return;
        }
    }
}

/// 返す上位候補手の最大数: 従来の 5 件 + 強制候補 1 件（設計メモ review-multipv-2026-09-06 §2.4）
pub const TOP_CANDIDATES: u8 = 6;
/// 候補リストの基本件数（従来どおり 5 件。`demotePlainFourIfNeeded` が見る範囲もここまで）
const TOP_CANDIDATES_BASE: u8 = 5;

/// Iterative Deepening結果
pub const IterativeDeepingResult = struct {
    position: Position,
    score: i32,
    completed_depth: u8,
    interrupted: bool,
    stats: minimax.SearchStats,
    forced_move: bool = false,
    /// 上位候補手（最大 `TOP_CANDIDATES` 手。6 件目は `forced_move` の強制候補のみ）
    top_candidates: [TOP_CANDIDATES]minimax.MoveScoreEntry = undefined,
    top_candidate_count: u8 = 0,
    /// bit i = `top_candidates[i]` が真値（root の窓内 or `refineTopCandidates` の再探索）。
    /// `exact_top_k == 0` なら常に 0。
    exact_mask: u8 = 0,
};

/// 反復深化探索パラメータ
pub const IterativeDeepeningParams = struct {
    max_depth: u8 = 6,
    time_limit: u32 = 0, // 0 = 無制限
    max_nodes: u32 = 0, // 0 = 無制限
    absolute_time_limit: u32 = 10000, // ms
    aspiration_mode: u8 = 0, // 0 = 固定[75], 1 = [75,200,500]
    /// root の上位 K 手を真値にする（0 = 従来どおり境界値のまま。設計メモ review-multipv §2.1）
    exact_top_k: u8 = 0,
    /// 必ず真値で返す手（振り返りの実手）。`exact_top_k == 0` のときは無視される（§2.6）
    forced_move: ?Position = null,
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
    aspiration_research_count = 0;

    // =========================================================================
    // 絶対デッドライン（issue #147）
    // =========================================================================
    //
    // ここが「値の SSoT」。同じ `absolute_deadline` を
    //   - `ctx.absolute_deadline`（メイン探索 / quiescence が参照）
    //   - `deadline.g_absolute_deadline_ms`（全 `TimeLimiter` が参照）
    // の両方へ配る。二重に計算しないので divergence は起きない。
    //
    // 事前探索（`findPreSearchMove` → VCF / ミセVCF / VCT）より **前** に立てるのが要点。
    // 事前探索は独自 limiter で回り、`mise_vcf.zig` には壁時計無制限（`time_limit = 0`）の
    // limiter も残っているので、ここより後ろで立てると事前探索が天井の外に出てしまう。
    //
    // `no_time_limit`（計測モード・解析）の場合は 0＝無効のまま。
    //
    // 決定的モード（設計メモ bench-fixed-nodes §2.1）: 予算ポリシーをここで一度だけ導出し、
    // `time_limit` は 0 として扱う（`no_time_limit`）。安全弁（§2.6）として
    // `absolute_time_limit > 0` なら絶対デッドラインだけは立てる（ベンチは 0 を渡す＝無効）。
    const policy = budget_mod.BudgetPolicy.derive();
    const no_time_limit = params.time_limit == 0 or policy.deterministic;
    const absolute_deadline = if (policy.deterministic)
        (if (params.absolute_time_limit == 0) @as(u32, 0) else start_time + params.absolute_time_limit)
    else if (no_time_limit)
        @as(u32, 0)
    else
        start_time + params.absolute_time_limit;
    deadline_mod.set(absolute_deadline);
    deadline_mod.resetHit();
    // 早期 return（即決手・唯一手）を含め、抜けるときは必ず解除する。
    // 解除し忘れると、以降の振り返り経路（`findVCTSequence` 直接呼び出し）まで
    // 過去のデッドラインで打ち切られてしまう。
    defer deadline_mod.clear();

    // Aspiration Windowsの幅を選択
    const effective_widths: []const i32 = if (params.aspiration_mode == 1)
        &ASPIRATION_WIDTHS
    else
        &ASPIRATION_WIDTHS_FIXED;

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

    ctx.budget = policy;

    // 新しい探索開始
    tt_mod.global_tt.newGeneration();

    // ビットボード・LUT・インクリメンタル評価状態の初期化
    // initFromBoard は内部で ll.init() / bitboard.initFromCells を呼ぶ
    ll.init();
    incremental_eval.initFromBoard(cells, .{
        .connectivity_bonus = params.board_eval_options.connectivity_bonus,
        .single_four_penalty_multiplier = params.board_eval_options.single_four_penalty_multiplier,
        .eval_basis = params.board_eval_options.eval_basis,
    });

    // =========================================================================
    // 事前チェック
    // =========================================================================

    const pre_search = findPreSearchMove(cells, color, policy);
    // 事前探索の消費ノードを記録（両モード）。`nodes` への加算は決定的モードのみ
    // （設計メモ bench-fixed-nodes §2.4）。
    ctx.stats.pre_search_nodes = pre_search.nodes;
    if (policy.deterministic) ctx.stats.nodes +|= pre_search.nodes;

    // レビューモード(aspiration_mode != 0)ではPV蓄積のためpreSearch即決をスキップ
    if (pre_search.immediate_move) |im| {
        if (params.aspiration_mode == 0) {
            var candidates: [TOP_CANDIDATES]minimax.MoveScoreEntry = undefined;
            candidates[0] = .{ .move = im, .score = pre_search.immediate_score };
            return .{
                .position = im,
                .score = pre_search.immediate_score,
                .completed_depth = 0,
                .interrupted = false,
                .stats = finalizeStats(&ctx),
                .top_candidates = candidates,
                .top_candidate_count = 1,
            };
        }
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

    // 唯一の候補手なら即座に返す（レビューモードではPV蓄積のため続行）
    if (moves.len <= 1 and params.aspiration_mode == 0) {
        const pos = if (moves.len == 1) moves.items[0] else Position{ .row = 7, .col = 7 };
        var candidates: [TOP_CANDIDATES]minimax.MoveScoreEntry = undefined;
        candidates[0] = .{ .move = pos, .score = 0 };
        return .{
            .position = pos,
            .score = 0,
            .completed_depth = 0,
            .interrupted = false,
            .stats = finalizeStats(&ctx),
            .forced_move = true,
            .top_candidates = candidates,
            .top_candidate_count = 1,
        };
    }

    // =========================================================================
    // 時間制限設定
    // =========================================================================

    const stone_count = countStones(cells);
    const dynamic_time_limit = if (no_time_limit)
        @as(u32, 0)
    else
        calculateDynamicTimeLimit(params.time_limit, stone_count, moves.len);

    const search_deadline = if (no_time_limit) @as(u32, 0) else start_time + dynamic_time_limit;
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
        for (effective_widths, 0..) |width, width_index| {
            // 1深度目の最初の探索（width_index==0）はaspiration failによる再探索ではない。
            if (width_index > 0) aspiration_research_count += 1;

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
            aspiration_research_count += 1;
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

    // root 上位 K 手の真値化（設計メモ review-multipv-2026-09-06 §2.2）。
    // 打ち切り済みなら走らない（Time Pressure Fallback で差し替えた position を上書きしない）。
    // `exact_top_k == 0` を先頭に置き、従来経路では時計を読まない（ゴールデン B は時計読み回数に敏感）。
    const refined = params.exact_top_k > 0 and
        !interrupted and
        !ctx.isAborted() and
        (no_time_limit or getTimestampMs() < loop_deadline);
    if (refined) {
        refineTopCandidates(&best_result, cells, color, completed_depth, params.exact_top_k, params.forced_move, &ctx);
    }

    // 上位候補手を収集（基本 5 手 + 真値化された強制候補 1 手）
    var top_candidates: [TOP_CANDIDATES]minimax.MoveScoreEntry = undefined;
    var count: u16 = @min(best_result.candidate_count, TOP_CANDIDATES_BASE);
    for (0..count) |i| {
        top_candidates[i] = best_result.candidates[i];
    }
    if (refined) {
        if (params.forced_move) |fm| {
            if (findCandidateIndex(top_candidates[0..count], fm) == null) {
                if (findCandidateIndex(best_result.candidates[0..best_result.candidate_count], fm)) |fi| {
                    const entry = best_result.candidates[fi];
                    if (entry.exact) {
                        top_candidates[count] = entry;
                        count += 1;
                    }
                }
            }
        }
    }
    var exact_mask: u8 = 0;
    if (params.exact_top_k > 0) {
        for (0..count) |i| {
            if (top_candidates[i].exact) exact_mask |= @as(u8, 1) << @intCast(i);
        }
    }

    var final_result = IterativeDeepingResult{
        .position = best_result.position,
        .score = best_result.score,
        .completed_depth = completed_depth,
        .interrupted = interrupted,
        .stats = finalizeStats(&ctx),
        .top_candidates = top_candidates,
        .top_candidate_count = @intCast(count),
        .exact_mask = exact_mask,
    };

    // 非生産的四の引き下げ
    demotePlainFourIfNeeded(&final_result, cells, color, policy);

    return final_result;
}

fn samePosition(a: Position, b: Position) bool {
    return a.row == b.row and a.col == b.col;
}

fn findCandidateIndex(entries: []const minimax.MoveScoreEntry, move: Position) ?usize {
    for (entries, 0..) |e, i| {
        if (samePosition(e.move, move)) return i;
    }
    return null;
}

/// スコア降順を保って挿入する（同点は後ろ＝安定）
fn insertDescending(list: []minimax.MoveScoreEntry, len: *u16, entry: minimax.MoveScoreEntry) void {
    var i: u16 = len.*;
    while (i > 0 and list[i - 1].score < entry.score) : (i -= 1) {
        list[i] = list[i - 1];
    }
    list[i] = entry;
    len.* += 1;
}

// =============================================================================
// root 上位 K 手の真値化（設計メモ docs/plans/review-multipv-2026-09-06.md §2.1）
// =============================================================================

/// `alpha = −INF` で 1 手を探索し真値を返す。`beta` は境界値 + 1（境界値が無ければ +INF）。
/// fail-high（`s >= beta`）なら上限が破れているので `beta = +INF` でもう一度探索する。
/// 打ち切り時の値は呼び出し側が `ctx.isAborted()` を見て捨てる。
fn searchFullWindow(
    cells: []Cell,
    hash: u64,
    move: Position,
    color: Cell,
    depth: u8,
    beta: i32,
    ctx: *minimax.SearchContext,
) i32 {
    const s = minimax.searchRootMove(cells, hash, move, color, depth, -scores.INFINITY, beta, ctx);
    if (ctx.isAborted() or beta >= scores.INFINITY or s < beta) return s;
    return minimax.searchRootMove(cells, hash, move, color, depth, -scores.INFINITY, scores.INFINITY, ctx);
}

/// root の候補のうち上位 K 手を真値（全窓の探索値）にする
///
/// root の alpha-beta は最善手以外を fail-low の境界値（上限）で返す。振り返りの候補手グリッドが
/// その境界値を並べると「2 位以下が同じ値」になるので、上位 K 手だけ再探索して真値にする。
///
/// - root で窓内に収まった手（`exact = true`）は再探索しない。
/// - K 件揃うまでは全窓（`alpha = −INF`, `beta = b_i + 1`）。`b_i` は境界値（上限）なので
///   `s == b_i` は真値扱い（子局面の TT に `upper_bound = b_i` が残っており、ちょうど `b_i` が返る）。
///   `s >= b_i + 1`（fail-high）は上限が破れている（Futility/LMR/プローブ由来）ので `beta = +INF` で
///   もう一度だけ探索する。fail-high の値を真値として採用しない。
/// - K 件揃ったら null window `(e_K, e_K + 1)` で「K 位の真値 `e_K` を超えるか」だけ確認し、
///   fail-high のときだけ全窓で真値を取る。null window の値が `b_i` を超えていたら上限が
///   破れているので全窓の `beta` は `+INF` にする。
/// - 再探索回数は 2K で打ち止め。再探索後に `ctx.isAborted()` なら値を捨てて以降は再探索しない。
/// - `forced_move`（振り返りの実手）は候補に無ければ追加し、回数上限に関係なく必ず全窓で真値にする。
/// - 結果の候補順は「真値（降順）＋ 境界値のまま（降順）」。先頭を `position/score` にする
///   （再探索で最善を超える手が出れば差し替わる）。
pub fn refineTopCandidates(
    result: *minimax.MinimaxResult,
    cells: []Cell,
    color: Cell,
    depth: u8,
    k: u8,
    forced_move: ?Position,
    ctx: *minimax.SearchContext,
) void {
    const hash = zobrist.computeBoardHash(cells);
    const max_researches: u32 = @as(u32, k) * 2;
    var researches: u32 = 0;
    var aborted = ctx.isAborted();

    // 強制候補（§2.6）: 候補に無ければ追加し、境界値のままなら全窓で真値にする
    if (forced_move) |fm| {
        const existing = findCandidateIndex(result.candidates[0..result.candidate_count], fm);
        const needs_search = if (existing) |i| !result.candidates[i].exact else true;
        if (needs_search and !aborted) {
            const beta: i32 = if (existing) |i| result.candidates[i].score + 1 else scores.INFINITY;
            const s = searchFullWindow(cells, hash, fm, color, depth, beta, ctx);
            if (ctx.isAborted()) {
                aborted = true;
            } else {
                const entry = minimax.MoveScoreEntry{ .move = fm, .score = s, .exact = true };
                if (existing) |i| {
                    result.candidates[i] = entry;
                } else if (result.candidate_count < move_gen.MAX_MOVES) {
                    result.candidates[result.candidate_count] = entry;
                    result.candidate_count += 1;
                }
            }
        }
    }

    var exact_list: [move_gen.MAX_MOVES]minimax.MoveScoreEntry = undefined;
    var exact_len: u16 = 0;
    var rest_list: [move_gen.MAX_MOVES]minimax.MoveScoreEntry = undefined;
    var rest_len: u16 = 0;

    for (0..result.candidate_count) |i| {
        const cand = result.candidates[i];
        if (cand.exact) {
            insertDescending(&exact_list, &exact_len, cand);
            continue;
        }
        if (aborted or researches >= max_researches) {
            rest_list[rest_len] = cand;
            rest_len += 1;
            continue;
        }

        var full_beta: i32 = cand.score + 1;
        if (exact_len >= k) {
            // K 件確定済み: K 位の真値を超えるかだけ null window で確認
            const e_k = exact_list[k - 1].score;
            const s = minimax.searchRootMove(cells, hash, cand.move, color, depth, e_k, e_k + 1, ctx);
            researches += 1;
            if (ctx.isAborted()) aborted = true;
            if (aborted or s <= e_k) {
                rest_list[rest_len] = cand;
                rest_len += 1;
                continue;
            }
            if (s > cand.score) full_beta = scores.INFINITY;
        }

        const s = searchFullWindow(cells, hash, cand.move, color, depth, full_beta, ctx);
        researches += 1;
        if (ctx.isAborted()) {
            aborted = true;
            rest_list[rest_len] = cand;
            rest_len += 1;
            continue;
        }
        insertDescending(&exact_list, &exact_len, .{ .move = cand.move, .score = s, .exact = true });
    }

    // 候補 = 真値（降順）＋ 境界値（降順）
    var out: u16 = 0;
    for (0..exact_len) |i| {
        result.candidates[out] = exact_list[i];
        out += 1;
    }
    for (0..rest_len) |i| {
        result.candidates[out] = rest_list[i];
        out += 1;
    }
    result.candidate_count = out;
    if (out > 0) {
        result.position = result.candidates[0].move;
        result.score = result.candidates[0].score;
    }
}

/// 探索終了時の統計を確定する（安全弁の発火フラグを畳み込む。設計メモ bench-fixed-nodes §2.6）
///
/// メイン探索（`ctx.absolute_deadline_exceeded`）と VCF/VCT の `TimeLimiter`
/// （`deadline.hitSinceReset()`）のどちらで発火しても 1 になる。
fn finalizeStats(ctx: *minimax.SearchContext) minimax.SearchStats {
    var stats = ctx.stats;
    // 決定的モードでは時間で timeout_flag を立てる経路は quiescence の安全弁だけなので、
    // timeout_flag も発火の証拠になる。
    const q_valve_hit = ctx.budget.deterministic and ctx.timeout_flag;
    stats.absolute_deadline_hit = if (ctx.absolute_deadline_exceeded or q_valve_hit or deadline_mod.hitSinceReset()) 1 else 0;
    return stats;
}

// =============================================================================
// タイムスタンプ取得
// =============================================================================

/// 壁時計（ms）。時計の SSoT は `deadline.nowMs`（ネイティブテストでは擬似時計）。
fn getTimestampMs() u32 {
    return deadline_mod.nowMs();
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

    const result = findPreSearchMove(&cells, .black, budget_mod.BudgetPolicy.TIME_MODE);
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

    const result = findPreSearchMove(&cells, .black, budget_mod.BudgetPolicy.TIME_MODE);
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

// --- issue #147: グローバル絶対デッドライン ---

test "findBestMoveIterative: 出口でグローバル絶対デッドラインが 0 に戻る（#147）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;

    tt_mod.global_tt.clear();
    // 前の呼び出しの残骸があっても、抜けたら必ず 0。
    deadline_mod.set(12345);
    _ = findBestMoveIterative(&cells, .black, .{
        .max_depth = 2,
        .time_limit = 1000,
        .max_nodes = 10000,
    });
    try testing.expectEqual(@as(u32, 0), deadline_mod.g_absolute_deadline_ms);
}

test "findBestMoveIterative: 事前探索の即決で早期 return してもデッドラインが残らない（#147）" {
    // 黒の4連 → 事前探索が五連完成手を即決して返す（反復深化に入らない経路）。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    tt_mod.global_tt.clear();
    deadline_mod.set(12345);
    const result = findBestMoveIterative(&cells, .black, .{
        .max_depth = 2,
        .time_limit = 1000,
    });
    try testing.expectEqual(@as(u8, 0), result.completed_depth); // 即決経路
    try testing.expectEqual(@as(u32, 0), deadline_mod.g_absolute_deadline_ms);
}

test "findBestMoveIterative: no_time_limit ではデッドラインを立てない（#147）" {
    // 振り返り・計測モード（time_limit = 0）では絶対デッドラインは無効のまま。
    // 擬似時計を進めても VCF/VCT が打ち切られないことで確認する。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    deadline_mod.test_now_ms = 5000;
    defer deadline_mod.test_now_ms = 0;

    tt_mod.global_tt.clear();
    const result = findBestMoveIterative(&cells, .black, .{
        .max_depth = 2,
        .time_limit = 0,
    });
    try testing.expectEqual(@as(u32, 0), deadline_mod.g_absolute_deadline_ms);
    // 五連完成手（(7,3) or (7,8)）が返る＝事前探索が打ち切られていない
    try testing.expectEqual(@as(u8, 7), result.position.row);
    try testing.expect(result.position.col == 3 or result.position.col == 8);
}

test "aspiration_research_count: findBestMoveIterativeの呼び出しごとにリセットされる（累積しない）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 8] = .white;

    tt_mod.global_tt.clear();
    _ = findBestMoveIterative(&cells, .black, .{ .max_depth = 3, .aspiration_mode = 1 });
    const first = aspiration_research_count;

    tt_mod.global_tt.clear();
    _ = findBestMoveIterative(&cells, .black, .{ .max_depth = 3, .aspiration_mode = 1 });
    const second = aspiration_research_count;

    // リセットされていれば同一局面・同一パラメータで毎回同じ値になる
    // （リセットされず累積するなら2回目は1回目の約2倍になり不一致となる）。
    try testing.expectEqual(first, second);
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

    ll.init();
    bitboard.initFromCells(&cells);

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
    bitboard.initFromCells(&cells);
    const j9_creates_four = @import("quiescence.zig").createsFour(&cells, 6, 9, .white);
    const j9_defense = @import("quiescence.zig").getFourDefensePosition(&cells, 6, 9, .white);
    cells[idx_j9] = .empty;
    bitboard.initFromCells(&cells);
    try testing.expect(j9_creates_four); // J9 creates a four
    try testing.expect(j9_defense == .unstoppable); // open four = unblockable

    // VCF should find J9 (open four on diagonal)
    const vcf_move = vcf_mod.findVCFMove(&cells, .white, vcf_mod.VCF_MAX_DEPTH, 0);
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

// --- 設計メモ review-multipv-2026-09-06: root 上位 K 手の真値化（軽量テスト。重いものは search_exact_topk_test.zig） ---

test "exact_top_k = 0: exact_mask は 0 で候補は従来どおり最大 5 件（§3-1）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 8] = .white;

    tt_mod.global_tt.clear();
    const result = findBestMoveIterative(&cells, .black, .{ .max_depth = 2, .aspiration_mode = 1 });
    try testing.expectEqual(@as(u8, 0), result.exact_mask);
    try testing.expect(result.top_candidate_count <= 5);
}

test "exact_top_k > 0: 上位候補に exact ビットが立ち、強制手は候補に含まれる（§3-3/§3-5 軽量版）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 8] = .white;

    // 盤端の空点（通常は候補の上位に入らない）を強制候補にする
    const forced = Position{ .row = 0, .col = 0 };

    tt_mod.global_tt.clear();
    const result = findBestMoveIterative(&cells, .black, .{
        .max_depth = 2,
        .aspiration_mode = 1,
        .exact_top_k = 2,
        .forced_move = forced,
    });
    // 上位 2 件は真値
    try testing.expect(result.top_candidate_count >= 3);
    try testing.expectEqual(@as(u8, 0b11), result.exact_mask & 0b11);
    try testing.expect(result.top_candidates[0].score >= result.top_candidates[1].score);
    // 強制手は末尾に真値で入る
    var found: ?usize = null;
    for (0..result.top_candidate_count) |i| {
        const m = result.top_candidates[i].move;
        if (m.row == forced.row and m.col == forced.col) found = i;
    }
    try testing.expect(found != null);
    try testing.expect((result.exact_mask >> @intCast(found.?)) & 1 == 1);
    try testing.expect(result.top_candidate_count <= TOP_CANDIDATES);
}

test "refineTopCandidates: root で exact が立った候補は再探索されない（nodes 不変）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;

    var history = move_order.HistoryTable.init();
    var killers = move_order.KillerMoves.init();
    var counter_moves = minimax.initCounterMoveTable();
    var ctx = minimax.SearchContext.init(
        &tt_mod.global_tt,
        &history,
        &killers,
        &counter_moves,
        position_eval.DEFAULT_EVAL_OPTIONS,
        (IterativeDeepeningParams{}).board_eval_options,
    );
    ctx.no_time_limit = true;
    ll.init();
    incremental_eval.initFromBoard(&cells, .{
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        .single_four_penalty_multiplier = 100,
        .eval_basis = .legacy,
    });

    var result = minimax.MinimaxResult{ .position = .{ .row = 6, .col = 6 }, .score = 30 };
    result.candidates[0] = .{ .move = .{ .row = 6, .col = 6 }, .score = 30, .exact = true };
    result.candidates[1] = .{ .move = .{ .row = 8, .col = 8 }, .score = 20, .exact = true };
    result.candidates[2] = .{ .move = .{ .row = 6, .col = 8 }, .score = 10, .exact = true };
    result.candidate_count = 3;

    refineTopCandidates(&result, &cells, .black, 2, 3, null, &ctx);
    try testing.expectEqual(@as(u32, 0), ctx.stats.nodes);
    try testing.expectEqual(@as(u16, 3), result.candidate_count);
    try testing.expectEqual(@as(i32, 30), result.score);
    try testing.expectEqual(@as(i32, 10), result.candidates[2].score);

    // 境界値の候補を足すと、その手だけ再探索される
    result.candidates[3] = .{ .move = .{ .row = 8, .col = 6 }, .score = 25, .exact = false };
    result.candidate_count = 4;
    refineTopCandidates(&result, &cells, .black, 2, 4, null, &ctx);
    try testing.expect(ctx.stats.nodes > 0);
    for (0..result.candidate_count) |i| try testing.expect(result.candidates[i].exact);
}

test "exact_top_k = 0: forced_move は無視される" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;

    tt_mod.global_tt.clear();
    const result = findBestMoveIterative(&cells, .black, .{
        .max_depth = 2,
        .aspiration_mode = 1,
        .exact_top_k = 0,
        .forced_move = Position{ .row = 0, .col = 0 },
    });
    try testing.expectEqual(@as(u8, 0), result.exact_mask);
    for (0..result.top_candidate_count) |i| {
        const m = result.top_candidates[i].move;
        try testing.expect(!(m.row == 0 and m.col == 0));
    }
}
