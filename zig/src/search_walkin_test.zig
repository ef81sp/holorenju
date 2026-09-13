//! 根の最善手の「自ら追い詰めに入る手」検証（`avoidWalkInIfNeeded`、V1c）のテスト
//! （設計メモ docs/plans/opp-vct-walkin-2026-09-12.md §5.6）
//!
//! 実探索（hard 相当）を回すので ReleaseFast でビルドし、`zig build test-golden` で実行する。
//! ネイティブテストは時計が 0（時間予算が無制限）なので、決定的モード
//! （`budget.deterministic_mode`）で回して壁時計に依存させない。時間モードは
//! 「予算切れで `walkin_skipped` が数える」分岐だけ擬似時計で確認する。
const std = @import("std");
const board_mod = @import("board.zig");
const budget_mod = @import("budget.zig");
const deadline = @import("deadline.zig");
const forbidden = @import("forbidden.zig");
const golden = @import("search_golden_test.zig");
const minimax = @import("minimax.zig");
const search = @import("search.zig");
const tt_mod = @import("tt.zig");
const vcf_mod = @import("vcf.zig");
const vct_mod = @import("vct.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const Position = search.Position;
const testing = std.testing;

/// hard 相当の決定的モード予算（`--fixed-nodes` 既定 1.2M と同じ）
const HARD_MAX_NODES: u32 = 1_200_000;

/// "H8" 形式（左下原点、H8 = row 7, col 7。`search_golden_test.parseKifu` と同じ規約）
fn pos(coord: []const u8) Position {
    return .{ .row = 15 - (std.fmt.parseInt(u8, coord[1..], 10) catch unreachable), .col = coord[0] - 'A' };
}

fn place(cells: []Cell, coords: []const u8, color: Cell) void {
    var it = std.mem.tokenizeScalar(u8, coords, ' ');
    while (it.next()) |tok| {
        const p = pos(tok);
        cells[@as(u16, p.row) * BOARD_SIZE + p.col] = color;
    }
}

fn samePos(a: Position, b: []const u8) bool {
    const p = pos(b);
    return a.row == p.row and a.col == p.col;
}

fn setup(cells: []Cell, black: []const u8, white: []const u8) void {
    place(cells, black, .black);
    place(cells, white, .white);
}

/// `move` を置いた後に相手（`opponent`）の lenient 追い詰め（VCT_MAX_DEPTH）があるか
fn walksIntoVCTAt(cells: []Cell, move: Position, color: Cell, opponent: Cell) bool {
    const idx = @as(u16, move.row) * BOARD_SIZE + move.col;
    cells[idx] = color;
    defer cells[idx] = .empty;
    var limiter = vcf_mod.TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 200_000 };
    return vct_mod.findVCTMoveWithLimiter(cells, opponent, vct_mod.VCT_MAX_DEPTH, &limiter, .lenient) != null;
}

fn walksIntoVCT(cells: []Cell, move: []const u8, color: Cell, opponent: Cell) bool {
    return walksIntoVCTAt(cells, pos(move), color, opponent);
}

fn resetClock() void {
    deadline.test_now_ms = 0;
    deadline.test_clock_step = 0;
}

fn runDeterministic(cells: []Cell, color: Cell, max_depth: u8, max_nodes: u32) search.IterativeDeepingResult {
    tt_mod.global_tt.clear();
    resetClock();
    var p = golden.hardParams(0, max_nodes);
    p.max_depth = max_depth;
    return search.findBestMoveIterative(cells, color, p);
}

fn runHard(cells: []Cell, color: Cell, max_nodes: u32) search.IterativeDeepingResult {
    return runDeterministic(cells, color, 7, max_nodes);
}

fn printResult(label: []const u8, r: search.IterativeDeepingResult) void {
    std.debug.print("{s}: best=({d},{d}) score={d} depth={d} nodes={d} walkin checks={d} fired={d} switches={d} skipped={d} vct_nodes={d} research_nodes={d}\n", .{
        label,                 r.position.row,       r.position.col,          r.score,                r.completed_depth,        r.stats.nodes,
        r.stats.walkin_checks, r.stats.walkin_fired, r.stats.walkin_switches, r.stats.walkin_skipped, r.stats.walkin_vct_nodes, r.stats.walkin_nodes,
    });
}

fn fourAndThree(cells: []Cell, move: Position, color: Cell) struct { has_four: bool, has_open_three: bool } {
    const idx = @as(u16, move.row) * BOARD_SIZE + move.col;
    cells[idx] = color;
    defer cells[idx] = .empty;
    const ft = minimax.analyzeFourAndThree(cells, move.row, move.col, color);
    return .{ .has_four = ft.has_four, .has_open_three = ft.has_open_three };
}

// =============================================================================
// 局面 1（計測 2 の idx 22 相当）: 黒 H8 I8 J8 J6 / 白 G9 I9 G8 H7、黒番
// 現行は F9（置いた後に白の VCT7 G7 G6 G11 G10 I7 F7 K7）。I6 / J7 / K8 は安全。
// =============================================================================

const FIXTURE1_BLACK = "H8 I8 J8 J6";
const FIXTURE1_WHITE = "G9 I9 G8 H7";

test "局面 1: F9 の後に白の lenient 追い詰めがあり、I6 / J7 / K8 の後には無い（前提の直接確認）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    try testing.expect(walksIntoVCT(&cells, "F9", .black, .white));
    try testing.expect(!walksIntoVCT(&cells, "I6", .black, .white));
    try testing.expect(!walksIntoVCT(&cells, "J7", .black, .white));
    try testing.expect(!walksIntoVCT(&cells, "K8", .black, .white));
}

test "局面 1: V1 後の最善手は F9 でなく I6 / J7 / K8 のいずれか（walkin_switches = 1、切り替え先は禁手でない）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    const r = runHard(&cells, .black, HARD_MAX_NODES);
    errdefer printResult("fixture1", r);
    try testing.expect(!samePos(r.position, "F9"));
    try testing.expect(samePos(r.position, "I6") or samePos(r.position, "J7") or samePos(r.position, "K8"));
    try testing.expect(!walksIntoVCTAt(&cells, r.position, .black, .white));
    try testing.expectEqual(forbidden.ForbiddenType.none, forbidden.checkForbiddenMove(&cells, r.position.row, r.position.col));
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_switches);
    try testing.expect(r.stats.walkin_checks >= 2);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_skipped);
    // 検証（相手 VCT）と除外再探索の消費は別々に記録される
    try testing.expect(r.stats.walkin_vct_nodes > 0);
    try testing.expect(r.stats.walkin_nodes > 0);
}

test "局面 1: 決定的 hard の結果は J7（walkin_fired = 1、switches = 1、checks = 3）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    const r = runHard(&cells, .black, HARD_MAX_NODES);
    errdefer printResult("fixture1-J7", r);
    try testing.expect(samePos(r.position, "J7"));
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_switches);
    try testing.expectEqual(@as(u32, 3), r.stats.walkin_checks);
}

// =============================================================================
// 局面 2（idx 23 相当、同型）: 黒 H8 H7 I6 H5 / 白 I8 G7 J7 H6、黒番。現行 H9 → 安全な代替 F8 / J4 など
// =============================================================================

const FIXTURE2_BLACK = "H8 H7 I6 H5";
const FIXTURE2_WHITE = "I8 G7 J7 H6";

test "局面 2: H9 の後に白の lenient 追い詰めがあり、F8 / J4 の後には無い（前提の直接確認）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE2_BLACK, FIXTURE2_WHITE);
    try testing.expect(walksIntoVCT(&cells, "H9", .black, .white));
    try testing.expect(!walksIntoVCT(&cells, "F8", .black, .white));
    try testing.expect(!walksIntoVCT(&cells, "J4", .black, .white));
}

test "局面 2: V1 後の最善手は H9 でなく、置いた後に白の追い詰めが残らない（禁手でない）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE2_BLACK, FIXTURE2_WHITE);
    const r = runHard(&cells, .black, HARD_MAX_NODES);
    errdefer printResult("fixture2", r);
    try testing.expect(!samePos(r.position, "H9"));
    try testing.expect(!walksIntoVCTAt(&cells, r.position, .black, .white));
    try testing.expectEqual(forbidden.ForbiddenType.none, forbidden.checkForbiddenMove(&cells, r.position.row, r.position.col));
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_switches);
    try testing.expect(r.stats.walkin_checks >= 2);
}

// =============================================================================
// 全候補が追い詰めに入る局面（§5.6-2）: 局面 1 に白 G6（+ 黒 A1 で黒番を保つ）。
// 深さ 5 では探索が損を見ておらず（score −1095）、最善 G7 は白の追い詰めに入る → 発火。
// 除外再探索（深さ 4）の代替手 G5 は score −3967（負け確定）なので、切り替え先の score 下限
// ガードで検証せず最善手のまま（checks = 1）。深さ 6 以上では探索自身が −99999 を返し V1 は触らない。
// =============================================================================

test "全候補が追い詰めに入る局面では最善手を変えない（fired = 1、代替手が負け確定なので検証せず checks = 1、switches = 0）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, "H8 I8 J8 J6 A1", "G9 I9 G8 H7 G6");
    const r = runDeterministic(&cells, .black, 5, HARD_MAX_NODES);
    errdefer printResult("all-walk-in", r);
    try testing.expect(r.score > -2500);
    try testing.expect(walksIntoVCTAt(&cells, r.position, .black, .white));
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_checks);
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_fired);
    // 除外再探索は走った（消費が記録される）が、代替手の検証には至っていない
    try testing.expect(r.stats.walkin_nodes > 0);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_switches);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_skipped);
    // 主探索と同じ最善手（切り替えていない）
    try testing.expect(samePos(r.position, "G7"));
}

// =============================================================================
// 最善手が四 / 活三を作る局面（§5.6-3）: 落ちない・黒番で禁手でない
// =============================================================================

test "最善手が四（活三なし）の局面: K8 の四で白の活三を止める。落ちず、禁手でない" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, "H8 I8 J8 K11", "G8 K5 K6 K7");
    const r = runHard(&cells, .black, HARD_MAX_NODES);
    errdefer printResult("plain-four", r);
    const ft = fourAndThree(&cells, r.position, .black);
    try testing.expect(ft.has_four and !ft.has_open_three);
    try testing.expectEqual(forbidden.ForbiddenType.none, forbidden.checkForbiddenMove(&cells, r.position.row, r.position.col));
    try testing.expect(r.stats.walkin_checks >= 1);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_switches);
}

test "最善手が活三を作る局面（相手の追い詰め探索は VCF-only に落ちる限界）: 落ちず、禁手でない" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, "H8 I8 J8 J6 A1", "G9 I9 G8 H7 K7");
    const r = runHard(&cells, .black, HARD_MAX_NODES);
    errdefer printResult("open-three", r);
    const ft = fourAndThree(&cells, r.position, .black);
    try testing.expect(ft.has_open_three);
    try testing.expectEqual(forbidden.ForbiddenType.none, forbidden.checkForbiddenMove(&cells, r.position.row, r.position.col));
    try testing.expect(r.stats.walkin_checks >= 1);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_switches);
}

// =============================================================================
// 予算（§5.6-4）: 決定的モードで検証分が `nodes` に計上され、主探索の `max_nodes` が予約分だけ減る
// =============================================================================

test "決定的モード: 主探索の max_nodes は予約分だけ減り、検証・再探索の消費が nodes に計上される" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    const policy = budget_mod.BudgetPolicy.DETERMINISTIC;
    try testing.expectEqual(search.WALKIN_NODES_RESERVE, policy.walkin_nodes);

    // 小予算: 主探索が上限で止まる。主探索分 = nodes − walkin_nodes は N − 予約 + プローブ超過分以内
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    const small: u32 = 150_000;
    const rs = runHard(&cells, .black, small);
    errdefer printResult("acct-small", rs);
    try testing.expect(rs.interrupted);
    const main_nodes = rs.stats.nodes - rs.stats.walkin_vct_nodes - rs.stats.walkin_nodes;
    try testing.expect(main_nodes <= small - policy.walkin_nodes + policy.probe_vct_nodes);
    try testing.expect(main_nodes >= small - policy.walkin_nodes);

    // hard 相当: V1 が発火し、検証 + 除外再探索の消費が walkin_nodes と nodes に入る。
    // 上限 = N + 再探索 K 回分（発火時のみの追加予算）+ プローブ超過分
    const rh = runHard(&cells, .black, HARD_MAX_NODES);
    errdefer printResult("acct-hard", rh);
    try testing.expectEqual(@as(u32, 1), rh.stats.walkin_switches);
    try testing.expect(rh.stats.walkin_vct_nodes > 0);
    try testing.expect(rh.stats.walkin_nodes > 0);
    try testing.expect(rh.stats.nodes >= rh.stats.walkin_vct_nodes + rh.stats.walkin_nodes);
    try testing.expect(rh.stats.nodes <= HARD_MAX_NODES + 3 * search.WALKIN_RESEARCH_NODES + policy.probe_vct_nodes);
    // 同一入力で再現する（決定的）
    const rh2 = runHard(&cells, .black, HARD_MAX_NODES);
    try testing.expectEqual(rh.position, rh2.position);
    try testing.expectEqual(rh.score, rh2.score);
    try testing.expectEqual(rh.stats.nodes, rh2.stats.nodes);
    try testing.expectEqual(rh.stats.walkin_nodes, rh2.stats.walkin_nodes);
    try testing.expectEqual(rh.stats.walkin_vct_nodes, rh2.stats.walkin_vct_nodes);
}

// =============================================================================
// 適用範囲のゲート（レビュー反映）: 浅い難易度・振り返り経路・小予算では走らせない
// =============================================================================

test "max_depth < 3（beginner / easy）では予約も検証もしない（walkin_* すべて 0、nodes は予約なしの主探索のみ）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    for ([_]u8{ 1, 2 }) |d| {
        const r = runDeterministic(&cells, .black, d, HARD_MAX_NODES);
        errdefer printResult("shallow", r);
        try testing.expectEqual(d, r.completed_depth);
        try testing.expectEqual(@as(u32, 0), r.stats.walkin_checks);
        try testing.expectEqual(@as(u32, 0), r.stats.walkin_fired);
        try testing.expectEqual(@as(u32, 0), r.stats.walkin_switches);
        try testing.expectEqual(@as(u32, 0), r.stats.walkin_skipped);
        try testing.expectEqual(@as(u32, 0), r.stats.walkin_vct_nodes);
        try testing.expectEqual(@as(u32, 0), r.stats.walkin_nodes);
    }
}

test "振り返り経路（exact_top_k > 0 / aspiration_mode != 0）では予約も検証もしない（最善手＝主探索の値）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);

    tt_mod.global_tt.clear();
    resetClock();
    var p_exact = golden.hardParams(0, HARD_MAX_NODES);
    p_exact.exact_top_k = 2;
    const re = search.findBestMoveIterative(&cells, .black, p_exact);
    errdefer printResult("review-exact", re);
    // 主探索の最善手 F9（walk-in）のまま切り替えない
    try testing.expect(samePos(re.position, "F9"));
    try testing.expectEqual(@as(u32, 0), re.stats.walkin_checks);
    try testing.expectEqual(@as(u32, 0), re.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 0), re.stats.walkin_skipped);
    try testing.expectEqual(@as(u32, 0), re.stats.walkin_vct_nodes);

    tt_mod.global_tt.clear();
    resetClock();
    var p_asp = golden.hardParams(0, HARD_MAX_NODES);
    p_asp.aspiration_mode = 1;
    const ra = search.findBestMoveIterative(&cells, .black, p_asp);
    errdefer printResult("review-asp", ra);
    try testing.expectEqual(@as(u32, 0), ra.stats.walkin_checks);
    try testing.expectEqual(@as(u32, 0), ra.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 0), ra.stats.walkin_skipped);
    try testing.expectEqual(@as(u32, 0), ra.stats.walkin_vct_nodes);
}

test "決定的モードの小予算（max_nodes <= 予約額）では検証を走らせず walkin_skipped = 1（nodes は上限内）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;
    const policy = budget_mod.BudgetPolicy.DETERMINISTIC;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    const small: u32 = 50_000;
    try testing.expect(small <= policy.walkin_nodes);
    const r = runHard(&cells, .black, small);
    errdefer printResult("tiny", r);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_checks);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_skipped);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_vct_nodes);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_nodes);
    try testing.expect(r.stats.nodes <= small + policy.probe_vct_nodes);
}

// =============================================================================
// 時間モード（擬似時計 step=1）: 予算切れで `walkin_skipped` が数える
// =============================================================================

test "時間モード: 絶対デッドライン超過で深さ 1 しか完了しなければ検証を走らせない（checks = 0、skip にも数えない）" {
    try testing.expect(!budget_mod.deterministic_mode);
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    tt_mod.global_tt.clear();
    deadline.test_now_ms = 1;
    deadline.test_clock_step = 1;
    defer resetClock();
    const r = search.findBestMoveIterative(&cells, .black, golden.hardParams(50, 200_000));
    errdefer printResult("time-50ms", r);
    try testing.expectEqual(@as(u32, 1), r.stats.absolute_deadline_hit);
    try testing.expect(r.completed_depth < 3);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_checks);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_skipped);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_switches);
    // 出口でグローバルデッドラインは解除されている
    try testing.expectEqual(@as(u32, 0), deadline.g_absolute_deadline_ms);
}

test "時間モード: 検証の時間予算（WALKIN_TIME_RESERVE）が擬似時計で尽きると判定不能 → walkin_skipped = 1" {
    try testing.expect(!budget_mod.deterministic_mode);
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setup(&cells, FIXTURE1_BLACK, FIXTURE1_WHITE);
    tt_mod.global_tt.clear();
    deadline.test_now_ms = 1;
    deadline.test_clock_step = 1;
    defer resetClock();
    // 主探索は時間で切れない（1,000,000 ms）。検証は 400 ms 分の時計読みで打ち切られる
    const r = search.findBestMoveIterative(&cells, .black, golden.hardParams(1_000_000, 200_000));
    errdefer printResult("time-1M", r);
    try testing.expectEqual(@as(u8, 7), r.completed_depth);
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_checks);
    try testing.expectEqual(@as(u32, 1), r.stats.walkin_skipped);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_switches);
    // 時間モードでは検証の消費は nodes に加算されない（記録のみ。ゴールデン B の nodes 不変が証拠）
    try testing.expect(r.stats.walkin_vct_nodes > 0);
    // 判定不能なので除外再探索は走っていない
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_fired);
    try testing.expectEqual(@as(u32, 0), r.stats.walkin_nodes);
}
