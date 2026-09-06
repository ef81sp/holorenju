//! root 上位 K 手の真値化（`exact_top_k` / `refineTopCandidates`）のテスト
//! （設計メモ docs/plans/review-multipv-2026-09-06.md §3-2〜§3-5）
//!
//! 実探索（hard 相当）を回すので ReleaseFast でビルドし、`zig build test-golden` で実行する。
//! 決定的モード（`budget.deterministic_mode`）で回し、壁時計に依存しない。
//!
//! 「同じ ctx 状態で直後に全窓 `searchRootMove` した値」は、グローバル TT を共有した
//! 新しい ctx で全窓探索することで得る（真値で確定した手の子局面には exact エントリが
//! 残っているので、TT ヒットで同じ値が返る）。
const std = @import("std");
const board_mod = @import("board.zig");
const budget_mod = @import("budget.zig");
const deadline = @import("deadline.zig");
const golden = @import("search_golden_test.zig");
const incremental_eval = @import("incremental_eval.zig");
const ll = @import("line_lookup.zig");
const minimax = @import("minimax.zig");
const move_order = @import("move_order.zig");
const scores = @import("scores.zig");
const search = @import("search.zig");
const tt_mod = @import("tt.zig");
const zobrist = @import("zobrist.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const Position = search.Position;
const testing = std.testing;

/// 0 = 無制限（決定的モードでも refine の全窓再探索は主探索の 1〜2 倍のノードを使うので上限を置かない）
const MAX_NODES: u32 = 0;
const K: u8 = 5;

/// 通常探索で複数候補が並ぶ局面（事前探索で即決しないもの）
const KIFUS = [_][]const u8{
    "H8 I9 I8 G8 F6 I7 G6",
    "H8 I9 I8 G8 F6 I7 G6 H7 I6 H6 J8 K7",
    "H9 I8 I9 G7 H8 H7 F7 J9 G6 I10 H10",
    "H8 H7 H6 I6 J6 H5 I5 G8 J5 J7 K8 G9 G7 J4 K7 H4",
};

fn params(exact_top_k: u8, forced_move: ?Position, max_nodes: u32) search.IterativeDeepeningParams {
    var p = golden.hardParams(0, max_nodes);
    p.absolute_time_limit = 0;
    p.aspiration_mode = 1; // 振り返りと同じ（事前探索即決・唯一手の早期 return をスキップ）
    p.exact_top_k = exact_top_k;
    p.forced_move = forced_move;
    return p;
}

fn colorOf(n: u16) Cell {
    return if (n % 2 == 0) .black else .white;
}

fn run(kifu: []const u8, p: search.IterativeDeepeningParams) search.IterativeDeepingResult {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = golden.parseKifu(kifu, &cells);
    tt_mod.global_tt.clear();
    deadline.test_now_ms = 0;
    deadline.test_clock_step = 0;
    return search.findBestMoveIterative(&cells, colorOf(n), p);
}

/// 直前の探索と同じグローバル TT を使い、新しい ctx で `move` を全窓・深さ `depth` で探索する
fn fullWindowValue(kifu: []const u8, move: Position, depth: u8, p: search.IterativeDeepeningParams) i32 {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const n = golden.parseKifu(kifu, &cells);
    const color = colorOf(n);

    var history = move_order.HistoryTable.init();
    var killers = move_order.KillerMoves.init();
    var counter_moves = minimax.initCounterMoveTable();
    var ctx = minimax.SearchContext.init(
        &tt_mod.global_tt,
        &history,
        &killers,
        &counter_moves,
        p.eval_options,
        p.board_eval_options,
    );
    ctx.budget = budget_mod.BudgetPolicy.derive();
    ctx.no_time_limit = true;

    ll.init();
    incremental_eval.initFromBoard(&cells, .{
        .connectivity_bonus = p.board_eval_options.connectivity_bonus,
        .single_four_penalty_multiplier = p.board_eval_options.single_four_penalty_multiplier,
        .eval_basis = p.board_eval_options.eval_basis,
    });
    const hash = zobrist.computeBoardHash(&cells);
    return minimax.searchRootMove(&cells, hash, move, color, depth, -scores.INFINITY, scores.INFINITY, &ctx);
}

fn samePos(a: Position, b: Position) bool {
    return a.row == b.row and a.col == b.col;
}

fn indexOf(r: search.IterativeDeepingResult, m: Position) ?usize {
    for (0..r.top_candidate_count) |i| {
        if (samePos(r.top_candidates[i].move, m)) return i;
    }
    return null;
}

fn printCandidates(label: []const u8, r: search.IterativeDeepingResult) void {
    std.debug.print("  {s}: pos=({d},{d}) score={d} depth={d} nodes={d} mask=0b{b}\n", .{
        label, r.position.row, r.position.col, r.score, r.completed_depth, r.stats.nodes, r.exact_mask,
    });
    for (0..r.top_candidate_count) |i| {
        const c = r.top_candidates[i];
        std.debug.print("    [{d}] ({d},{d}) {d}{s}\n", .{ i, c.move.row, c.move.col, c.score, if (c.exact) "" else " (bound)" });
    }
}

test "§3-2 不安定率の計測: exact_top_k = 0 の境界値 b_i と全窓の真値 v_i を比べ、v_i > b_i の件数をログに出す（閾値なし）" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;

    var bounds: u32 = 0;
    var broken: u32 = 0;
    for (KIFUS) |kifu| {
        const p = params(0, null, MAX_NODES);
        const r = run(kifu, p);
        try testing.expectEqual(@as(u8, 0), r.exact_mask);
        for (0..r.top_candidate_count) |i| {
            const c = r.top_candidates[i];
            if (c.exact) continue;
            bounds += 1;
            const v = fullWindowValue(kifu, c.move, r.completed_depth, p);
            if (v > c.score) {
                broken += 1;
                std.debug.print("  bound broken: {s} ({d},{d}) bound={d} full={d}\n", .{ kifu, c.move.row, c.move.col, c.score, v });
            }
        }
    }
    std.debug.print("§3-2 upper-bound violations: {d} / {d}\n", .{ broken, bounds });
}

test "§3-3 自己整合: exact_top_k = 5 の上位 5 件は真値・降順で、全窓の再探索と一致する" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;

    for (KIFUS) |kifu| {
        const p = params(K, null, MAX_NODES);
        const r = run(kifu, p);
        errdefer printCandidates(kifu, r);
        try testing.expect(!r.interrupted);
        const r0 = run(kifu, params(0, null, MAX_NODES));
        std.debug.print("  K=5 refine cost: {s} nodes {d} -> {d} (x{d}.{d:0>2})\n", .{
            kifu, r0.stats.nodes, r.stats.nodes, r.stats.nodes / r0.stats.nodes, (r.stats.nodes * 100 / r0.stats.nodes) % 100,
        });
        // fullWindowValue は直前の探索の TT を見るので、K=5 の探索を最後にやり直して TT を戻す
        const r_again = run(kifu, p);
        try testing.expectEqual(r.exact_mask, r_again.exact_mask);
        try testing.expectEqual(r.stats.nodes, r_again.stats.nodes);
        const n: u8 = @min(K, r.top_candidate_count);
        try testing.expect(n >= 2);
        // 候補先頭 = 着手・スコア
        try testing.expect(samePos(r.position, r.top_candidates[0].move));
        try testing.expectEqual(r.top_candidates[0].score, r.score);
        for (0..n) |i| {
            try testing.expect((r.exact_mask >> @intCast(i)) & 1 == 1);
            try testing.expect(r.top_candidates[i].exact);
            if (i > 0) try testing.expect(r.top_candidates[i - 1].score >= r.top_candidates[i].score);
            const v = fullWindowValue(kifu, r.top_candidates[i].move, r.completed_depth, p);
            errdefer std.debug.print("  mismatch [{d}] ({d},{d}) refined={d} full={d}\n", .{ i, r.top_candidates[i].move.row, r.top_candidates[i].move.col, r.top_candidates[i].score, v });
            try testing.expectEqual(v, r.top_candidates[i].score);
        }
    }
}

test "§3-3 K = 1 で最善手が root 真値なら着手・スコアは K = 0 と同じ（再探索は null window の確認だけ）" {
    // 「root で exact が立った手は再探索されない」の直接の検証は search.zig の
    // refineTopCandidates 単体テスト。ここでは K=1 の結果が主探索の最善と一致し、
    // 増分ノードが最善手の全窓再探索（≈ 主探索の PV サブツリー）より十分小さいことを見る。
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;

    var checked: u32 = 0;
    for (KIFUS) |kifu| {
        const r0 = run(kifu, params(0, null, MAX_NODES));
        if (!r0.top_candidates[0].exact) continue;
        const r1 = run(kifu, params(1, null, MAX_NODES));
        errdefer printCandidates(kifu, r1);
        try testing.expectEqual(r0.score, r1.score);
        try testing.expect(samePos(r0.position, r1.position));
        try testing.expectEqual(@as(u8, 1), r1.exact_mask & 1);
        try testing.expect(r1.stats.nodes >= r0.stats.nodes);
        std.debug.print("  K=1 extra nodes: {s} +{d} (base {d})\n", .{ kifu, r1.stats.nodes - r0.stats.nodes, r0.stats.nodes });
        checked += 1;
    }
    try testing.expect(checked > 0);
}

test "§3-4 打ち切り: 主探索直後にノード上限が尽きると着手・スコアは exact_top_k = 0 と同一で exact_mask は root 分のみ" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;

    for (KIFUS) |kifu| {
        const r0 = run(kifu, params(0, null, MAX_NODES));
        try testing.expect(!r0.interrupted);
        // 主探索は同一（上限に届かない）、refine の最初の 1 ノードで上限に当たる
        const r = run(kifu, params(K, null, r0.stats.nodes + 1));
        errdefer printCandidates(kifu, r);
        try testing.expect(samePos(r0.position, r.position));
        try testing.expectEqual(r0.score, r.score);
        try testing.expectEqual(r0.completed_depth, r.completed_depth);
        try testing.expectEqual(r0.stats.nodes + 1, r.stats.nodes);
        // 立っているビットは root 由来（再探索は完了していない）。K=0 の上位 5 件にある手なら値も一致
        for (0..r.top_candidate_count) |i| {
            const c = r.top_candidates[i];
            const bit = (r.exact_mask >> @intCast(i)) & 1 == 1;
            try testing.expectEqual(c.exact, bit);
            if (indexOf(r0, c.move)) |j| {
                try testing.expectEqual(r0.top_candidates[j].score, c.score);
                try testing.expectEqual(r0.top_candidates[j].exact, c.exact);
            }
        }
    }
}

test "§3-5 強制候補: 候補外の手を forced_move に渡すと 6 件目として真値で返る" {
    budget_mod.deterministic_mode = true;
    defer budget_mod.deterministic_mode = false;

    for (KIFUS) |kifu| {
        const p = params(K, null, MAX_NODES);
        const r0 = run(kifu, p);
        if (r0.top_candidate_count < K) continue;

        // 上位 5 件に入っていない空点を探す（石の隣接点から）
        var cells = [_]Cell{.empty} ** CELL_COUNT;
        _ = golden.parseKifu(kifu, &cells);
        var forced: ?Position = null;
        outer: for (0..BOARD_SIZE) |r_u| {
            for (0..BOARD_SIZE) |c_u| {
                const idx = r_u * BOARD_SIZE + c_u;
                if (cells[idx] != .empty) continue;
                const pos = Position{ .row = @intCast(r_u), .col = @intCast(c_u) };
                if (indexOf(r0, pos) != null) continue;
                // 隣接に石がある
                var adjacent = false;
                for ([_]i8{ -1, 0, 1 }) |dr| for ([_]i8{ -1, 0, 1 }) |dc| {
                    const rr = @as(i16, @intCast(r_u)) + dr;
                    const cc = @as(i16, @intCast(c_u)) + dc;
                    if (rr < 0 or cc < 0 or rr >= BOARD_SIZE or cc >= BOARD_SIZE) continue;
                    if (cells[@as(usize, @intCast(rr)) * BOARD_SIZE + @as(usize, @intCast(cc))] != .empty) adjacent = true;
                };
                if (adjacent) {
                    forced = pos;
                    break :outer;
                }
            }
        }
        try testing.expect(forced != null);

        const pf = params(K, forced, MAX_NODES);
        const r = run(kifu, pf);
        errdefer printCandidates(kifu, r);
        try testing.expectEqual(@as(u8, K + 1), r.top_candidate_count);
        try testing.expect(samePos(r.top_candidates[K].move, forced.?));
        try testing.expect((r.exact_mask >> K) & 1 == 1);
        try testing.expect(r.top_candidates[K].exact);
        const v = fullWindowValue(kifu, forced.?, r.completed_depth, pf);
        try testing.expectEqual(v, r.top_candidates[K].score);
        // 上位 5 件は強制手の有無で変わらない（着手も同じ）
        try testing.expect(samePos(r0.position, r.position));
    }
}
