//! 時間モードのゴールデン値と決定的モードの時計非依存テスト
//! （設計メモ docs/plans/bench-fixed-nodes-2026-09-06.md §3-1, §3-4）
//!
//! ## ゴールデン値（§3-4）
//!
//! 決定的モード導入前（development 5ca68dc）の実装で採取した、時間モード hard 相当
//! （max_depth 7 / time_limit > 0 / max_nodes 200,000 / eval flags 0x1FF / prospect 基底）
//! の着手・score・stats.nodes。以後の変更で時間モードの探索がビット単位で変わっていない
//! ことの検証器。**値を書き換える変更は、時間モードの挙動変更を意味する**ので、
//! 意図したものかを必ず確認すること。
//!
//! - セット A: 擬似時計 0（時計なし）、threatProbe 無効。時計なしではプローブの VCT が
//!   無制限になり局面によって数分かかるため、プローブを切って採取した。事前探索
//!   （VCF / 相手 VCF / ミセ VCF / VCT）・降格判定・主探索の構造的な不変を検証する。
//! - セット B: 擬似時計 step=1（時計読みごとに 1ms 進む）、threatProbe 有効、
//!   time_limit 1,000,000（主探索は時間で切れない）。プローブ・事前探索の時間予算が
//!   「時計読みの回数」で有界になる。時計読みの回数を変える変更（例: limiter の生成回数）
//!   で値が動きうるので、動いたときはその説明がつくかを確認する。
//!
//! 実探索を回すので ReleaseFast でビルドする（build.zig）。
const std = @import("std");
const board_mod = @import("board.zig");
const budget_mod = @import("budget.zig");
const deadline = @import("deadline.zig");
const minimax = @import("minimax.zig");
const position_eval = @import("position_eval.zig");
const scores = @import("scores.zig");
const search = @import("search.zig");
const tt_mod = @import("tt.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const testing = std.testing;

/// 棋譜（"H8 I9 ..." 黒から交互）を盤面に展開し、石数を返す。座標は左下原点（15A 形式ではなく列+行）。
pub fn parseKifu(kifu: []const u8, cells: []Cell) u16 {
    var it = std.mem.tokenizeScalar(u8, kifu, ' ');
    var n: u16 = 0;
    while (it.next()) |tok| {
        const col: u8 = tok[0] - 'A';
        const num = std.fmt.parseInt(u8, tok[1..], 10) catch unreachable;
        const row: u8 = 15 - num;
        cells[@as(u16, row) * BOARD_SIZE + col] = if (n % 2 == 0) .black else .white;
        n += 1;
    }
    return n;
}

/// hard 相当（src/types/cpu.ts DIFFICULTY_PARAMS.hard）。max_nodes だけテスト用に 200k。
pub const GOLDEN_MAX_NODES: u32 = 200_000;

pub fn hardParams(time_limit: u32, max_nodes: u32) search.IterativeDeepeningParams {
    return .{
        .max_depth = 7,
        .time_limit = time_limit,
        .max_nodes = max_nodes,
        .absolute_time_limit = time_limit,
        .aspiration_mode = 0,
        .eval_options = position_eval.decodeEvalOptions(0x1FF),
        .board_eval_options = .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
            .eval_basis = .prospect,
        },
    };
}

const Golden = struct {
    kifu: []const u8,
    /// 何を検証する局面か
    what: []const u8,
    row: u8,
    col: u8,
    score: i32,
    nodes: u32,
    depth: u8,
};

// セット A: 擬似時計 0 / threatProbe 無効 / time_limit 10000
const GOLDEN_A = [_]Golden{
    .{ .kifu = "H8 I9 I8 G8 F6 I7 G6", .what = "深さ7完了（白）", .row = 8, .col = 7, .score = 147, .nodes = 48373, .depth = 7 },
    .{ .kifu = "H8 I9 I8 G8 F6 I7 G6 H7 I6 H6 J8 K7", .what = "深さ7完了（黒）", .row = 8, .col = 9, .score = 551, .nodes = 64421, .depth = 7 },
    .{ .kifu = "H8 I9 F7 J9 G7 I8 H7 I7 I6 H9 K9 J7 K6 I10 I11", .what = "事前探索: ミセVCF即決 (FIVE-15)", .row = 5, .col = 9, .score = 99985, .nodes = 0, .depth = 0 },
    .{ .kifu = "H8 I9 F7 J9 G7 I8 H7 I7 I6 H9 K9 J7 K6 I10 I11 J10 J11", .what = "事前探索: VCF即決 (FIVE-10)", .row = 5, .col = 6, .score = 99990, .nodes = 0, .depth = 0 },
    .{ .kifu = "H8 I9 F7 J9 G7 I8 H7 I7 I6 H9 K9 J7 K6 I10 I11 J10 J11 G10", .what = "事前探索: 相手の四を止める (-FIVE)", .row = 4, .col = 5, .score = -100000, .nodes = 0, .depth = 0 },
    .{ .kifu = "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10", .what = "事前探索: ミセVCF即決 G7（mise_vcf.zig のテスト局面）", .row = 8, .col = 6, .score = 99985, .nodes = 0, .depth = 0 },
    .{ .kifu = "H8 G9 G8 F8 H10 F9 H9 H11 G10 I10 I8 F11 J8 K8 F12", .what = "事前探索: VCF即決 J9（search.zig のテスト局面）", .row = 6, .col = 9, .score = 99990, .nodes = 0, .depth = 0 },
    .{ .kifu = "I9 H9 H8 G8 I7 G7 I6 I10 J11 G10 G11 F10 H10 J8 J6 K5 L6 K6", .what = "demotePlainFourIfNeeded 発火（I8→I5、ノード上限で中断）", .row = 10, .col = 8, .score = -1327, .nodes = 200002, .depth = 5 },
    .{ .kifu = "H9 I8 I9 G7 H8 H7 F7 J9 G6 I10 H10", .what = "深さ7完了（白）", .row = 4, .col = 7, .score = -125, .nodes = 38676, .depth = 7 },
    .{ .kifu = "H8 H7 H6 I6 J6 H5 I5 G8 J5 J7 K8 G9 G7 J4 K7 H4", .what = "深さ7完了（黒・高スコア）", .row = 7, .col = 11, .score = 3082, .nodes = 52777, .depth = 7 },
};

// セット B: 擬似時計 step=1（開始 1ms）/ threatProbe 有効 / time_limit 1,000,000
const GOLDEN_B = [_]Golden{
    .{ .kifu = "H8 I9 I8 G8 F6 I7 G6", .what = "深さ7完了（白）", .row = 8, .col = 7, .score = 147, .nodes = 48141, .depth = 7 },
    .{ .kifu = "H8 I9 I8 G8 F6 I7 G6 H7 I6 H6 J8 K7", .what = "深さ7完了（黒）", .row = 8, .col = 9, .score = 551, .nodes = 71422, .depth = 7 },
    .{ .kifu = "I9 H9 H8 G8 I7 G7 I6 I10 J11 G10 G11 F10 H10 J8 J6 K5 L6 K6", .what = "demotePlainFourIfNeeded 発火（I8→I5）", .row = 10, .col = 8, .score = -1327, .nodes = 200001, .depth = 5 },
    .{ .kifu = "H9 I8 I9 G7 H8 H7 F7 J9 G6 I10 H10", .what = "深さ7完了（白）", .row = 4, .col = 7, .score = -125, .nodes = 38335, .depth = 7 },
    .{ .kifu = "H8 H7 H6 I6 J6 H5 I5 G8 J5 J7 K8 G9 G7 J4 K7 H4", .what = "深さ7完了（黒）", .row = 11, .col = 8, .score = 400, .nodes = 48026, .depth = 7 },
};

fn runGolden(g: Golden, time_limit: u32) search.IterativeDeepingResult {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = parseKifu(g.kifu, &cells);
    const color: Cell = if (n % 2 == 0) .black else .white;
    tt_mod.global_tt.clear();
    return search.findBestMoveIterative(&cells, color, hardParams(time_limit, GOLDEN_MAX_NODES));
}

fn expectGolden(g: Golden, r: search.IterativeDeepingResult) !void {
    errdefer std.debug.print(
        "golden mismatch: {s} [{s}]\n  expected (r{d},c{d}) score={d} nodes={d} depth={d}\n  actual   (r{d},c{d}) score={d} nodes={d} depth={d}\n",
        .{ g.what, g.kifu, g.row, g.col, g.score, g.nodes, g.depth, r.position.row, r.position.col, r.score, r.stats.nodes, r.completed_depth },
    );
    try testing.expectEqual(g.row, r.position.row);
    try testing.expectEqual(g.col, r.position.col);
    try testing.expectEqual(g.score, r.score);
    try testing.expectEqual(g.nodes, r.stats.nodes);
    try testing.expectEqual(g.depth, r.completed_depth);
}

fn resetClock() void {
    deadline.test_now_ms = 0;
    deadline.test_clock_step = 0;
}

test "ゴールデン A: 時間モード（時計なし・プローブ無効）の着手・score・nodes が不変" {
    try testing.expect(!budget_mod.deterministic_mode);
    minimax.threat_probe_enabled = false;
    defer minimax.threat_probe_enabled = true;
    resetClock();
    for (GOLDEN_A) |g| {
        try expectGolden(g, runGolden(g, 10000));
    }
}

test "ゴールデン B: 時間モード（擬似時計 step=1・プローブ有効）の着手・score・nodes が不変" {
    try testing.expect(!budget_mod.deterministic_mode);
    defer resetClock();
    for (GOLDEN_B) |g| {
        deadline.test_now_ms = 1;
        deadline.test_clock_step = 1;
        try expectGolden(g, runGolden(g, 1_000_000));
    }
}

// =============================================================================
// 決定的モード（設計メモ §3-1〜3, §3-6）
// =============================================================================

/// 決定的モードのベンチ相当パラメータ（time_limit 0 / absolute 0 / max_nodes N）
fn deterministicParams(max_nodes: u32, absolute_time_limit: u32) search.IterativeDeepeningParams {
    var p = hardParams(0, max_nodes);
    p.absolute_time_limit = absolute_time_limit;
    return p;
}

const DETERMINISTIC_MAX_NODES: u32 = 100_000;

/// 時計非依存テストの局面（事前探索で決まる局面と通常探索の局面の両方）
const DETERMINISTIC_KIFUS = [_][]const u8{
    // 通常探索（深さ 7 完了級）
    "H8 I9 I8 G8 F6 I7 G6",
    "H9 I8 I9 G7 H8 H7 F7 J9 G6 I10 H10",
    // 事前探索: 相手の四を止める
    "H8 I9 F7 J9 G7 I8 H7 I7 I6 H9 K9 J7 K6 I10 I11 J10 J11 G10",
    // 事前探索: 自分の VCF
    "H8 I9 F7 J9 G7 I8 H7 I7 I6 H9 K9 J7 K6 I10 I11 J10 J11",
    // 事前探索: ミセ VCF
    "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    // 降格判定が発火する局面
    "I9 H9 H8 G8 I7 G7 I6 I10 J11 G10 G11 F10 H10 J8 J6 K5 L6 K6",
};

const Snapshot = struct {
    row: u8,
    col: u8,
    score: i32,
    nodes: u32,
    pre_search_nodes: u32,
    probe_nodes: u32,
    completed_depth: u8,
    absolute_deadline_hit: u32,

    fn of(r: search.IterativeDeepingResult) Snapshot {
        return .{
            .row = r.position.row,
            .col = r.position.col,
            .score = r.score,
            .nodes = r.stats.nodes,
            .pre_search_nodes = r.stats.pre_search_nodes,
            .probe_nodes = r.stats.probe_nodes,
            .completed_depth = r.completed_depth,
            .absolute_deadline_hit = r.stats.absolute_deadline_hit,
        };
    }
};

fn runDeterministic(kifu: []const u8, params: search.IterativeDeepeningParams, now_ms: u32, step: u32) Snapshot {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = parseKifu(kifu, &cells);
    const color: Cell = if (n % 2 == 0) .black else .white;
    tt_mod.global_tt.clear();
    deadline.test_now_ms = now_ms;
    deadline.test_clock_step = step;
    const r = search.findBestMoveIterative(&cells, color, params);
    resetClock();
    return Snapshot.of(r);
}

test "決定的モード: 擬似時計 step=0 と step=1000 で着手・score・nodes・pre_search_nodes・probe_nodes が一致（§3-1）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    for (DETERMINISTIC_KIFUS) |kifu| {
        const a = runDeterministic(kifu, deterministicParams(DETERMINISTIC_MAX_NODES, 0), 0, 0);
        const b = runDeterministic(kifu, deterministicParams(DETERMINISTIC_MAX_NODES, 0), 1, 1000);
        errdefer std.debug.print("clock dependence: {s}\n  step0    {any}\n  step1000 {any}\n", .{ kifu, a, b });
        try testing.expectEqual(a, b);
        try testing.expectEqual(@as(u32, 0), a.absolute_deadline_hit);
    }
}

test "決定的モード: time_limit > 0 を渡しても 0 と同じ結果（時間を見ない）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    const kifu = DETERMINISTIC_KIFUS[0];
    const a = runDeterministic(kifu, deterministicParams(DETERMINISTIC_MAX_NODES, 0), 1, 1000);
    var timed = deterministicParams(DETERMINISTIC_MAX_NODES, 0);
    timed.time_limit = 10000;
    const b = runDeterministic(kifu, timed, 1, 1000);
    try testing.expectEqual(a, b);
}

test "決定的モード: 通常探索の局面で probe_nodes > 0 かつ nodes に含まれる（§3-3）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    const s = runDeterministic(DETERMINISTIC_KIFUS[0], deterministicParams(DETERMINISTIC_MAX_NODES, 0), 0, 0);
    try testing.expect(s.probe_nodes > 0);
    try testing.expect(s.nodes >= s.probe_nodes + s.pre_search_nodes);
    // 事前探索で即決する局面では pre_search_nodes がそのまま nodes になる
    const m = runDeterministic(DETERMINISTIC_KIFUS[3], deterministicParams(DETERMINISTIC_MAX_NODES, 0), 0, 0);
    try testing.expect(m.pre_search_nodes > 0);
    try testing.expectEqual(m.pre_search_nodes, m.nodes);
    try testing.expectEqual(@as(u8, 0), m.completed_depth);
}

test "時間モード: probe_nodes / pre_search_nodes は記録されるが nodes には加算されない（§3-3）" {
    try testing.expect(!budget_mod.deterministic_mode);
    // ゴールデン B（プローブ有効）の nodes は決定的モード導入前と一致している＝加算されていない。
    // ここでは記録だけを確認する。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = parseKifu(DETERMINISTIC_KIFUS[0], &cells);
    const color: Cell = if (n % 2 == 0) .black else .white;
    tt_mod.global_tt.clear();
    deadline.test_now_ms = 1;
    deadline.test_clock_step = 1;
    defer resetClock();
    const r = search.findBestMoveIterative(&cells, color, hardParams(1_000_000, GOLDEN_MAX_NODES));
    try testing.expect(r.stats.probe_nodes > 0);
    try testing.expectEqual(GOLDEN_B[0].nodes, r.stats.nodes);
    // 事前探索即決局面: 消費は記録されるが nodes は 0 のまま（ゴールデン A と同じ）
    var cells2 = [_]Cell{.empty} ** CELL_COUNT;
    const n2 = parseKifu(DETERMINISTIC_KIFUS[3], &cells2);
    const color2: Cell = if (n2 % 2 == 0) .black else .white;
    tt_mod.global_tt.clear();
    const r2 = search.findBestMoveIterative(&cells2, color2, hardParams(1_000_000, GOLDEN_MAX_NODES));
    try testing.expect(r2.stats.pre_search_nodes > 0);
    try testing.expectEqual(@as(u32, 0), r2.stats.nodes);
}

test "決定的モード: 事前探索の各段が予算内で打ち切られる（§3-2）" {
    // 即決しないが事前探索が重い局面（時計なしの時間モードで約 5.8 万ノード消費）。
    // 予算を極小にすると VCF → 相手 VCF で親予算が尽き、ミセ VCF は候補ループ先頭で、
    // VCT は exhausted な子で、それぞれ即座に打ち切られる。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = parseKifu(DETERMINISTIC_KIFUS[5], &cells);
    const color: Cell = if (n % 2 == 0) .black else .white;
    resetClock();

    const tiny = budget_mod.BudgetPolicy{
        .deterministic = true,
        .pre_search_nodes = 10,
        .pre_vcf_nodes = 5,
        .pre_opp_vcf_nodes = 5,
        .pre_vct_nodes = 5,
        .demote_vcf_nodes = 5,
        .probe_vct_nodes = 5,
    };
    const r_tiny = search.findPreSearchMove(&cells, color, tiny);
    errdefer std.debug.print("pre-search budget: tiny.nodes={d}\n", .{r_tiny.nodes});
    try testing.expect(r_tiny.immediate_move == null);
    // 各段は `hasVCF` の同一階層ループ内で bump が続くため、自前予算を数ノード超過しうる
    try testing.expect(r_tiny.nodes <= tiny.pre_search_nodes * 3);

    // 既定の決定的予算では親予算 + 各段の自前予算を超えない（段の境目で親を見る設計なので
    // 上限は「親 + 最後に走った段の自前予算」）。
    const det = budget_mod.BudgetPolicy.DETERMINISTIC;
    const r_det = search.findPreSearchMove(&cells, color, det);
    errdefer std.debug.print("pre-search budget: det.nodes={d}\n", .{r_det.nodes});
    try testing.expect(r_det.nodes > r_tiny.nodes);
    try testing.expect(r_det.nodes <= det.pre_search_nodes + det.pre_vct_nodes);

    // 時間モード（時計なし＝無制限）は予算に縛られず、より多く消費する
    const r_time = search.findPreSearchMove(&cells, color, budget_mod.BudgetPolicy.TIME_MODE);
    errdefer std.debug.print("pre-search budget: time.nodes={d}\n", .{r_time.nodes});
    try testing.expect(r_time.immediate_move == null);
    try testing.expect(r_time.nodes > r_det.nodes);
}

test "決定的モード: ミセ VCF 段は親予算超過で打ち切られ、既定予算では見つかる（§3-2）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = parseKifu(DETERMINISTIC_KIFUS[4], &cells);
    const color: Cell = if (n % 2 == 0) .black else .white;
    resetClock();

    // 既定予算: ミセ VCF G7（row 8, col 6）を即決する
    const r_det = search.findPreSearchMove(&cells, color, budget_mod.BudgetPolicy.DETERMINISTIC);
    try testing.expect(r_det.immediate_move != null);
    try testing.expectEqual(@as(u8, 8), r_det.immediate_move.?.row);
    try testing.expectEqual(@as(u8, 6), r_det.immediate_move.?.col);
    try testing.expectEqual(scores.FIVE - 15, r_det.immediate_score);

    // 親予算 1 ノード: VCF 段で親が尽き、ミセ段は候補ループ先頭で打ち切り → 即決なし
    var cut = budget_mod.BudgetPolicy.DETERMINISTIC;
    cut.pre_search_nodes = 1;
    const r_cut = search.findPreSearchMove(&cells, color, cut);
    try testing.expect(r_cut.immediate_move == null);
    try testing.expect(r_cut.nodes < r_det.nodes);
}

test "決定的モード: 安全弁 absolute_time_limit > 0 で擬似時計超過時に打ち切られ absolute_deadline_hit が立つ（§3-6）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    const kifu = DETERMINISTIC_KIFUS[0];

    // 安全弁なし（ベンチ既定）: 時計を進めても発火しない
    const off = runDeterministic(kifu, deterministicParams(DETERMINISTIC_MAX_NODES, 0), 1, 1);
    try testing.expectEqual(@as(u32, 0), off.absolute_deadline_hit);

    // 安全弁 50ms、時計は読みごとに 1ms 進む → 途中で打ち切られる
    const on = runDeterministic(kifu, deterministicParams(DETERMINISTIC_MAX_NODES, 50), 1, 1);
    try testing.expectEqual(@as(u32, 1), on.absolute_deadline_hit);
    try testing.expect(on.nodes < off.nodes);
    try testing.expect(on.completed_depth < off.completed_depth);
    // 出口でグローバルデッドラインは解除されている
    try testing.expectEqual(@as(u32, 0), deadline.g_absolute_deadline_ms);
}
