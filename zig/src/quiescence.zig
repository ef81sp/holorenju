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

/// quiescence の打ち切り制御。
///
/// **設計方針（ハードウェア非依存の決定的強度）**:
/// 強さは「総ノード数」という決定的な予算で縛る。同じノード予算なら CPU 性能に依らず
/// 同じ着手＝強さが一定。これがハングの根治でもある（旧来 `max_nodes` は minimax ノードのみ
/// 計上し quiescence ノードを数えず、q探索が実質無制限になって暴走していた＝監査の欠陥C）。
///
/// **打ち切りポリシー（2層）**:
/// - ノード予算超過 → **ローカル**打ち切り（static eval 返却のみ・フラグは立てない）。
///   探索全体の停止確定は次の minimax ノード入口の `node_count_exceeded` 判定が担う。
/// - 壁時計超過 → 共有 `timeout_flag` をセット（時間切れはグローバル事象のため）。
///
/// **出荷構成での整理**: hard(timeLimit=10s, maxNodes=1M) では典型ハードで時間が先に
/// bind し、ノード予算は病的な q爆発を決定的に頭打ちにする安全網として効く。
/// 完全に決定的な強度（計測・リプレイ用途）は timeLimit=0 のノード予算のみで運用する。
///
/// - `node_counter`: 探索全体で共有する総ノードカウンタ（`ctx.stats.nodes` を指す）。
///   minimax ノードと quiescence ノードの両方をここに計上し、`max_nodes` で**決定的に**打ち切る。
/// - `max_nodes`: グローバル総ノード上限（0 = 無制限）。これが主たる打ち切り条件。
/// - `deadline` / `absolute_deadline` / `no_time_limit` / `timeout_flag`:
///   壁時計の**安全天井**（出荷時の応答性用）。`no_time_limit=true`（計測時）では一切効かず、
///   強度は純粋にノード予算のみで決まる＝再現可能・ハードウェア非依存。
///   `no_time_limit` にデフォルトは与えない（設定し忘れで天井が黙って消えるのを防ぐ）。
pub const QLimits = struct {
    node_counter: *u32,
    max_nodes: u32 = 0,
    deadline: u32 = 0,
    absolute_deadline: u32 = 0,
    no_time_limit: bool,
    timeout_flag: *bool,
};

extern fn getTimestampMsExternal() u32;

/// 壁時計（ms）。ネイティブ（テスト）では 0 を返し時間制限なし。
fn getTimestampMs() u32 {
    if (@import("builtin").cpu.arch == .wasm32) {
        return getTimestampMsExternal();
    }
    return 0;
}

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
///
/// 連続四・跳び四を区別せず、方向ごとに「その方向で埋めると五になる点」を
/// `threats.collectLineFivePoints` で列挙して判定する（受け点の SSoT）。
/// - 五点 0 個: この方向は四ではない（黒の長連にしかならない四）→ 無視
/// - 五点 2 個以上: 両方は塞げない ＝ 活四（防御不可）→ null
/// - 五点 1 個: 止め四。その点が受け
///
/// issue #115: 以前は跳び四で `findJumpGapPosition` の返り値を検証せずに
/// 使っていたため、同一ライン上に長連ギャップと正当なギャップが併存すると
/// 長連ギャップ（＝五にできない点）を受けとして返していた。
pub fn getFourDefensePosition(cells: []const Cell, last_row: u8, last_col: u8, color: Cell) ?Position {
    var first_defense: ?Position = null;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = ll.queryPatternByCell(last_row, last_col, i, color);
        if (result.count != 4 and !result.has_jump_four) continue;

        var five_points = threats.PositionList.init();
        _ = threats.collectLineFivePoints(cells, last_row, last_col, dir.dr, dir.dc, color, &five_points);

        if (five_points.len == 0) continue;
        if (five_points.len >= 2) return null;
        if (first_defense == null) first_defense = five_points.items[0];
    }

    return first_defense;
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
    limits: QLimits,
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

    // フィールドコピー（旧: 手動リテラル）ではなく eval_options を丸ごと引き継いで
    // last_mover_is_perspective だけ上書きする。これにより eval_basis 等の新規
    // フィールドが将来追加されても取りこぼさない（§3.3 の「手動コピーの罠」対応）。
    //
    // stm 供給ルール: ここは legacy/prospect どちらでも常時 is_maximizing から
    // last_mover_is_perspective を導出する（既存挙動、変更なし）。minimax.zig の
    // abortEvalOptions（打ち切り時の静的評価）は prospect のみ stm を供給し legacy は
    // .unset のまま――同じ「静的評価」でも呼び出し元によって stm 供給ルールが非対称な
    // ことに注意（minimax.zig の abortEvalOptions のコメント参照）。
    var eval_opts = eval_options;
    eval_opts.last_mover_is_perspective = if (!is_maximizing) .yes else .no;

    // 総ノード数を共有カウンタに計上（minimax と同じカウンタ）。
    limits.node_counter.* += 1;

    // 決定的ノード上限（主たる打ち切り条件・ハードウェア非依存）。
    // q探索ノードも総予算に計上されるため、密局面での q爆発が決定的に頭打ちになる。
    if (limits.max_nodes > 0 and limits.node_counter.* >= limits.max_nodes) {
        return incremental_eval.getEvaluation(cells, perspective, eval_opts);
    }

    // 壁時計の安全天井（出荷時の応答性用）。`no_time_limit` 時は無効＝計測は決定的。
    // 共有カウンタ基準なので部分木境界に依らず一定間隔で発火する（旧来の取りこぼしを修正）。
    if (!limits.no_time_limit and (limits.node_counter.* & 1023) == 0) {
        const now = getTimestampMs();
        const time_up = (limits.deadline > 0 and now >= limits.deadline) or
            (limits.absolute_deadline > 0 and now >= limits.absolute_deadline);
        if (time_up) {
            limits.timeout_flag.* = true;
        }
    }
    if (limits.timeout_flag.*) {
        return incremental_eval.getEvaluation(cells, perspective, eval_opts);
    }

    // Stand-pat: 何もしない場合の評価（インクリメンタル評価を使用）
    const stand_pat = incremental_eval.getEvaluation(cells, perspective, eval_opts);

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
    var aborted = false;

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
            limits,
            tt,
        );

        // 石を除去
        incremental_eval.removeStone(cells, move.row, move.col);

        // 打ち切り（ノード予算/時間切れ）が起きたら弟ノードの走査も止める。
        // これがないと打切り後も幅方向の走査が続き「眠い崩壊」で予算を大きく超過する。
        if (limits.timeout_flag.* or
            (limits.max_nodes > 0 and limits.node_counter.* >= limits.max_nodes))
        {
            aborted = true;
            break;
        }

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

    // 打ち切り時は不完全な best_score を TT に書かない（TT汚染防止）。
    if (aborted) {
        return best_score;
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
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
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
        .{ .node_counter = &node_counter, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
    try std.testing.expectEqual(score, 0);
}

/// 戦術手のある局面を作る（黒が四を複数作れる）。返り値は手番色。
fn setupTacticalPosition(cells: *[CELL_COUNT]Cell) void {
    @memset(cells, .empty);
    // 横3連 (7,3)(7,4)(7,5) → (7,2)/(7,6) で四
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    // 縦3連 (5,8)(6,8)(7,8) → (4,8)/(8,8) で四
    cells[5 * BOARD_SIZE + 8] = .black;
    cells[6 * BOARD_SIZE + 8] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(cells);
}

test "quiescenceSearch: 総ノード上限=1 は最初の1ノードで打ち切る" {
    ll.init();
    var cells: [CELL_COUNT]Cell = undefined;
    setupTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    _ = quiescenceSearch(
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
        .{ .node_counter = &node_counter, .max_nodes = 1, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
    // 総ノード上限=1 → ルートノードのみ訪問して即打ち切り。再帰しない。
    try std.testing.expectEqual(@as(u32, 1), stats.nodes);
    try std.testing.expectEqual(@as(u32, 1), node_counter);
    // ノード上限による打ち切りはグローバル flag を立てない（時間切れではない）。
    try std.testing.expectEqual(false, timeout_flag);
}

test "quiescenceSearch: 既定上限では戦術局面で再帰する（>1ノード）" {
    ll.init();
    var cells: [CELL_COUNT]Cell = undefined;
    setupTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    _ = quiescenceSearch(
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
        .{ .node_counter = &node_counter, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
    // 四が作れる戦術局面なので脅威手を展開して複数ノード訪問する。
    try std.testing.expect(stats.nodes > 1);
}

/// 密な戦術局面を作る（黒の独立した三×4本 → 四を作る手が8つ、
/// 四→受け→四… の連鎖で q木が大きく育つ）。木の途中打切りテスト用。
fn setupDenseTacticalPosition(cells: *[CELL_COUNT]Cell) void {
    @memset(cells, .empty);
    const rows = [_]u8{ 2, 5, 8, 11 };
    for (rows) |r| {
        cells[@as(u16, r) * BOARD_SIZE + 3] = .black;
        cells[@as(u16, r) * BOARD_SIZE + 4] = .black;
        cells[@as(u16, r) * BOARD_SIZE + 5] = .black;
    }
    bitboard.initFromCells(cells);
}

test "quiescenceSearch: 木の途中でノード予算が尽きても安全に巻き戻り早期停止する" {
    ll.init();
    var cells: [CELL_COUNT]Cell = undefined;
    setupDenseTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };

    const eval_options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };

    // 無制限で全木サイズを測る
    tt.clear();
    var stats_full = QSearchStats{};
    var timeout_full = false;
    var counter_full: u32 = 0;
    _ = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        eval_options,
        MAX_QUIESCENCE_DEPTH,
        &stats_full,
        .{ .node_counter = &counter_full, .no_time_limit = true, .timeout_flag = &timeout_full },
        &tt,
    );
    // 前提: 戦術局面で木がある程度広がる（広がらないなら局面を強化すべき）
    try std.testing.expect(counter_full > 8);

    // 半分の予算で再帰の途中から打ち切られ、全木より早く停止すること
    tt.clear();
    var stats_cap = QSearchStats{};
    var timeout_cap = false;
    var counter_cap: u32 = 0;
    const cap = counter_full / 2;
    _ = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        eval_options,
        MAX_QUIESCENCE_DEPTH,
        &stats_cap,
        .{ .node_counter = &counter_cap, .max_nodes = cap, .no_time_limit = true, .timeout_flag = &timeout_cap },
        &tt,
    );
    // 予算には到達した（cap未満で終わる＝打切り経路を踏んでいないテストを防ぐ）
    try std.testing.expect(counter_cap >= cap);
    // 巻き戻り中の弟ノード訪問分は超過しうるが、全木探索よりは確実に少ない
    try std.testing.expect(counter_cap < counter_full);
    // ノード予算打切りはローカル: グローバル flag は立てない
    try std.testing.expectEqual(false, timeout_cap);
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

/// issue #115 の局面（左下原点・黒先手）
///
/// 実戦 14 手 "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9" +
/// "L7 M6 L8 L6 J7 M10" + "K7 M7 N8 O8 J8"
/// 8 行目は G8 H8 _ J8 K8 L8 _ N8（黒）/ O8（白）。
/// I8 を埋めると G8..L8 の 6 連＝長連、M8 を埋めると J8..N8 の五。本物の受けは M8。
fn setupIssue115FourGapPosition(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[8 * BOARD_SIZE + 7] = .white; // H7
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[5 * BOARD_SIZE + 8] = .black; // I10
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[6 * BOARD_SIZE + 9] = .black; // J9
    cells[5 * BOARD_SIZE + 9] = .white; // J10
    cells[7 * BOARD_SIZE + 10] = .black; // K8
    cells[4 * BOARD_SIZE + 7] = .white; // H11
    cells[6 * BOARD_SIZE + 11] = .black; // L9
    cells[6 * BOARD_SIZE + 10] = .white; // K9
    cells[4 * BOARD_SIZE + 8] = .black; // I11
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 11] = .black; // L7
    cells[9 * BOARD_SIZE + 12] = .white; // M6
    cells[7 * BOARD_SIZE + 11] = .black; // L8
    cells[9 * BOARD_SIZE + 11] = .white; // L6
    cells[8 * BOARD_SIZE + 9] = .black; // J7
    cells[5 * BOARD_SIZE + 12] = .white; // M10
    cells[8 * BOARD_SIZE + 10] = .black; // K7
    cells[8 * BOARD_SIZE + 12] = .white; // M7
    cells[7 * BOARD_SIZE + 13] = .black; // N8
    cells[7 * BOARD_SIZE + 14] = .white; // O8
    cells[7 * BOARD_SIZE + 9] = .black; // J8
}

test "getFourDefensePosition: 長連ギャップではなく五になるギャップを返す（issue #115）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue115FourGapPosition(&cells);
    bitboard.initFromCells(&cells);

    // J8 は本物の四（M8 側の跳び四）。受けは M8 であって I8 ではない。
    const defense = getFourDefensePosition(&cells, 7, 9, .black);
    try std.testing.expect(defense != null);
    try std.testing.expectEqual(@as(u8, 7), defense.?.row);
    try std.testing.expectEqual(@as(u8, 12), defense.?.col); // M8
}

test "getFourDefensePosition: 白の _XXXX_ で片端の先が白でも活四（防御不可）" {
    ll.init();
    // C8-D8-E8-F8-(空G8)-H8(白)。白に長連の制限は無いので G8 を埋めると 6 連＝五。
    // B8 も五点なので五点は 2 つ＝活四＝防御不可（黒の同形との対比）。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .white; // C8
    cells[7 * BOARD_SIZE + 3] = .white; // D8
    cells[7 * BOARD_SIZE + 4] = .white; // E8
    cells[7 * BOARD_SIZE + 5] = .white; // F8
    cells[7 * BOARD_SIZE + 7] = .white; // H8
    bitboard.initFromCells(&cells);

    try std.testing.expect(getFourDefensePosition(&cells, 7, 4, .white) == null);
}
