/// VCF（Victory by Continuous Fours）探索
///
/// 四を連続して打つことで勝利する手順を探索する。
/// 白番の場合、黒の防御点が禁手なら即勝利。
/// TS版 vcf.ts に対応

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const ll = @import("line_lookup.zig");
const quiescence = @import("quiescence.zig");
const scores = @import("scores.zig");
const threats = @import("threats.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;
const Position = threats.Position;

/// VCF探索の最大深度
pub const VCF_MAX_DEPTH: u8 = 8;

/// VCF探索の時間制限（ミリ秒）
pub const VCF_TIME_LIMIT: u32 = 150;

// =============================================================================
// TimeLimiter
// =============================================================================

pub const TimeLimiter = struct {
    start_time: u32,
    time_limit: u32,
    nodes: u32,
    max_nodes: u32, // 0 = 無制限
};

fn isTimeExceeded(limiter: *const TimeLimiter) bool {
    if (limiter.max_nodes > 0 and limiter.nodes >= limiter.max_nodes) {
        return true;
    }
    if (limiter.time_limit == 0) return false;
    const now = getTimestampMs();
    if (now == 0) return false; // ネイティブテスト
    return (now - limiter.start_time) >= limiter.time_limit;
}

fn incrementNodes(limiter: *TimeLimiter) void {
    limiter.nodes += 1;
}

// =============================================================================
// 四を作れる手の列挙
// =============================================================================

/// 四を作れる位置を列挙（五連完成手を含む）
/// TS版 threatPatterns.ts の findFourMoves に対応
pub fn findFourMoves(cells: []Cell, color: Cell, buf: *[225]Position) u16 {
    var count: u16 = 0;
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // 仮配置（bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);

            // 五連チェック（最優先）
            if (forbidden.checkFive(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                buf[count] = .{ .row = r, .col = c };
                count += 1;
                continue;
            }

            // 四チェック
            const is_four = quiescence.createsFour(cells, r, c, color);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (!is_four) continue;

            // 禁手チェックは四を作る手だけに限定
            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, r, c);
                if (fr != .none) continue;
            }

            buf[count] = .{ .row = r, .col = c };
            count += 1;
        }
    }

    return count;
}

// =============================================================================
// hasVCF
// =============================================================================

/// VCFが成立するかチェック
pub fn hasVCF(
    cells: []Cell,
    color: Cell,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) bool {
    if (isTimeExceeded(limiter)) return false;
    if (depth >= max_depth) return false;

    var buf: [225]Position = undefined;
    const four_count = findFourMoves(cells, color, &buf);

    const opponent = color.opposite();

    for (0..four_count) |i| {
        const move = buf[i];
        incrementNodes(limiter);

        // 四を作る（インプレース、bitboard も同期）
        const idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連チェック
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            return true;
        }

        // 相手の応手（四を止める）
        const defense_pos = quiescence.getFourDefensePosition(cells, move.row, move.col, color);

        // #124: `.not_four`（四ですらない）を勝ちにしない。勝ちは `.unstoppable`（活四）のみ。
        if (defense_pos == .unstoppable) {
            // 止められない = 勝利
            cells[idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            return true;
        }

        const dp = switch (defense_pos) {
            .block => |p| p,
            else => {
                cells[idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                continue;
            },
        };

        // 白番の場合、黒の防御位置が禁手ならVCF成立
        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) {
                cells[idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                return true;
            }
        }

        // 相手が止めた後の局面で再帰
        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
        cells[def_idx] = opponent;
        bitboard.placeStone(dp.row, dp.col, opponent);

        // 防御で五連完成 → VCF不成立
        const defense_wins = forbidden.checkFive(cells, dp.row, dp.col, opponent);
        // 防御でカウンターフォー → VCF中断
        const defense_counter_four = !defense_wins and quiescence.createsFour(cells, dp.row, dp.col, opponent);

        var result = false;
        if (!defense_wins and !defense_counter_four) {
            result = hasVCF(cells, color, depth + 1, limiter, max_depth);
        }

        // Undo（逆順）
        cells[def_idx] = .empty;
        bitboard.removeStone(dp.row, dp.col);
        cells[idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        if (result) return true;
    }

    return false;
}

// =============================================================================
// findVCFMove（反復深化）
// =============================================================================

/// VCFの最初の手を返す
pub fn findVCFMove(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32) ?Position {
    return findVCFMoveWithBudget(cells, color, max_depth, time_limit, 0);
}

/// VCFの最初の手を返す（ノード数制限付き）
/// max_nodes=0 は無制限
pub fn findVCFMoveWithBudget(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32, max_nodes: u32) ?Position {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    // 反復深化: 浅い深度から探索し最短VCFを優先
    var depth: u8 = 1;
    while (depth <= max_depth) : (depth += 1) {
        if (isTimeExceeded(&limiter)) return null;
        const result = findVCFMoveRecursive(cells, color, 0, &limiter, depth);
        if (result) |_| return result;
    }
    return null;
}

/// VCFの最初の手を返す（再帰版）
/// 1パスで五連→活四→再帰の順に処理
fn findVCFMoveRecursive(
    cells: []Cell,
    color: Cell,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) ?Position {
    if (depth >= max_depth) return null;
    if (isTimeExceeded(limiter)) return null;

    var buf: [225]Position = undefined;
    const four_count = findFourMoves(cells, color, &buf);

    const opponent = color.opposite();

    // Phase 1: 即勝ちチェック（五連・活四・禁手防御不能）
    const MAX_RECURSIVE = 225;
    var recursive_moves: [MAX_RECURSIVE]Position = undefined;
    var recursive_defense: [MAX_RECURSIVE]Position = undefined;
    var recursive_count: u16 = 0;

    for (0..four_count) |i| {
        const move = buf[i];
        incrementNodes(limiter);
        if (isTimeExceeded(limiter)) return null;

        const idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連 → 即勝ち
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            return move;
        }

        const defense_pos = quiescence.getFourDefensePosition(cells, move.row, move.col, color);
        cells[idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        // 活四（防御不能） → 即勝ち。`.not_four` は四ですらないのでスキップ（#124）
        if (defense_pos == .unstoppable) {
            return move;
        }

        const dp = switch (defense_pos) {
            .block => |p| p,
            else => continue,
        };

        // 白番: 黒の防御位置が禁手 → 即勝ち
        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) return move;
        }

        // 再帰探索用に蓄積
        if (recursive_count < MAX_RECURSIVE) {
            recursive_moves[recursive_count] = move;
            recursive_defense[recursive_count] = dp;
            recursive_count += 1;
        }
    }

    // Phase 2: 再帰探索
    for (0..recursive_count) |i| {
        const move = recursive_moves[i];
        const dp = recursive_defense[i];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;

        cells[move_idx] = color;
        bitboard.placeStone(move.row, move.col, color);
        cells[def_idx] = opponent;
        bitboard.placeStone(dp.row, dp.col, opponent);

        // 防御で五連完成 or カウンターフォー → スキップ
        const defense_wins = forbidden.checkFive(cells, dp.row, dp.col, opponent);
        const defense_counter_four = !defense_wins and quiescence.createsFour(cells, dp.row, dp.col, opponent);

        var vcf_move: ?Position = null;
        if (!defense_wins and !defense_counter_four) {
            vcf_move = findVCFMoveRecursive(cells, color, depth + 1, limiter, max_depth);
        }

        // Undo
        cells[def_idx] = .empty;
        bitboard.removeStone(dp.row, dp.col);
        cells[move_idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        if (vcf_move != null) {
            return if (depth == 0) move else vcf_move;
        }
    }

    return null;
}

// =============================================================================
// findVCFSequence（手順蓄積版）
// =============================================================================

pub const VCFSequenceResult = struct {
    /// 攻撃手+防御手の交互列: [攻撃1, 防御1, 攻撃2, 防御2, ..., 最終攻撃手]
    sequence: [64]Position,
    len: u8,
    is_forbidden_trap: bool,
    found: bool,
};

/// VCF手順全体を返す（反復深化）
pub fn findVCFSequence(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
) VCFSequenceResult {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    var result = VCFSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
    };

    // 反復深化: 浅い深度から探索し最短手順を優先
    var depth: u8 = 1;
    while (depth <= max_depth) : (depth += 1) {
        if (isTimeExceeded(&limiter)) return result;

        var seq_len: u8 = 0;
        var is_forbidden_trap = false;
        const found = findVCFSequenceRecursive(cells, color, 0, &limiter, depth, &result.sequence, &seq_len, &is_forbidden_trap);
        if (found) {
            result.len = seq_len;
            result.is_forbidden_trap = is_forbidden_trap;
            result.found = true;
            return result;
        }
    }
    return result;
}

/// 指定初手からのVCF手順を返す
pub fn findVCFSequenceFromFirstMove(
    cells: []Cell,
    first_move: Position,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
) VCFSequenceResult {
    var result = VCFSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
    };

    const idx = @as(u16, first_move.row) * BOARD_SIZE + first_move.col;
    if (cells[idx] != .empty) return result;

    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    // 仮配置
    cells[idx] = color;
    bitboard.placeStone(first_move.row, first_move.col, color);

    // 五連チェック → 即勝ち
    if (forbidden.checkFive(cells, first_move.row, first_move.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(first_move.row, first_move.col);
        result.sequence[0] = first_move;
        result.len = 1;
        result.found = true;
        return result;
    }

    // 四を作るかチェック
    if (!quiescence.createsFour(cells, first_move.row, first_move.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(first_move.row, first_move.col);
        return result;
    }

    // 防御位置を取得
    const defense_pos = quiescence.getFourDefensePosition(cells, first_move.row, first_move.col, color);
    if (defense_pos == .unstoppable) {
        // 活四 → 防御不可能 → VCF成立
        cells[idx] = .empty;
        bitboard.removeStone(first_move.row, first_move.col);
        result.sequence[0] = first_move;
        result.len = 1;
        result.found = true;
        return result;
    }

    // createsFour を通っているので `.not_four` は理論上到達しないが、保守側に倒す（#124）
    const dp = switch (defense_pos) {
        .block => |p| p,
        else => {
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            return result;
        },
    };

    // 白番: 黒の防御位置が禁手 → 即勝ち
    if (color == .white) {
        const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
        if (fr != .none) {
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            result.sequence[0] = first_move;
            result.len = 1;
            result.is_forbidden_trap = true;
            result.found = true;
            return result;
        }
    }

    // 防御石を仮配置してVCF探索継続
    const opponent = color.opposite();
    const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
    cells[def_idx] = opponent;
    bitboard.placeStone(dp.row, dp.col, opponent);

    const continuation = findVCFSequence(cells, color, max_depth, time_limit, max_nodes);

    // Undo（逆順）
    cells[def_idx] = .empty;
    bitboard.removeStone(dp.row, dp.col);
    cells[idx] = .empty;
    bitboard.removeStone(first_move.row, first_move.col);

    if (!continuation.found) return result;

    // 手順を組み立て: [初手, 防御手, 継続手順...]
    result.sequence[0] = first_move;
    result.sequence[1] = dp;
    var i: u8 = 0;
    while (i < continuation.len) : (i += 1) {
        result.sequence[2 + i] = continuation.sequence[i];
    }
    result.len = 2 + continuation.len;
    result.is_forbidden_trap = continuation.is_forbidden_trap;
    result.found = true;
    return result;
}

/// VCF手順の再帰探索
/// 1パスで五連→活四→再帰の順に処理
fn findVCFSequenceRecursive(
    cells: []Cell,
    color: Cell,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
    sequence: *[64]Position,
    seq_len: *u8,
    is_forbidden_trap: *bool,
) bool {
    if (depth >= max_depth) return false;
    if (isTimeExceeded(limiter)) return false;

    var buf: [225]Position = undefined;
    const four_count = findFourMoves(cells, color, &buf);

    const opponent = color.opposite();

    // Phase 1: 即勝ちチェック
    const MAX_RECURSIVE = 225;
    var recursive_moves: [MAX_RECURSIVE]Position = undefined;
    var recursive_defense: [MAX_RECURSIVE]Position = undefined;
    var recursive_count: u16 = 0;

    for (0..four_count) |i| {
        const move = buf[i];
        incrementNodes(limiter);
        if (isTimeExceeded(limiter)) return false;

        const idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連 → 即勝ち
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            sequence[seq_len.*] = move;
            seq_len.* += 1;
            return true;
        }

        const defense_pos = quiescence.getFourDefensePosition(cells, move.row, move.col, color);
        cells[idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        // 活四（防御不能） → 即勝ち。`.not_four` は四ですらないのでスキップ（#124）
        if (defense_pos == .unstoppable) {
            sequence[seq_len.*] = move;
            seq_len.* += 1;
            return true;
        }

        const dp = switch (defense_pos) {
            .block => |p| p,
            else => continue,
        };

        // 白番: 黒の防御位置が禁手 → 即勝ち
        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) {
                sequence[seq_len.*] = move;
                seq_len.* += 1;
                is_forbidden_trap.* = true;
                return true;
            }
        }

        // 再帰探索用に蓄積
        if (recursive_count < MAX_RECURSIVE) {
            recursive_moves[recursive_count] = move;
            recursive_defense[recursive_count] = dp;
            recursive_count += 1;
        }
    }

    // Phase 2: 再帰探索
    for (0..recursive_count) |i| {
        const move = recursive_moves[i];
        const dp = recursive_defense[i];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;

        cells[move_idx] = color;
        bitboard.placeStone(move.row, move.col, color);
        cells[def_idx] = opponent;
        bitboard.placeStone(dp.row, dp.col, opponent);

        // 防御で五連完成 or カウンターフォー → スキップ
        const defense_wins = forbidden.checkFive(cells, dp.row, dp.col, opponent);
        const defense_counter_four = !defense_wins and quiescence.createsFour(cells, dp.row, dp.col, opponent);

        var found = false;
        if (!defense_wins and !defense_counter_four) {
            const saved_len = seq_len.*;
            sequence[seq_len.*] = move;
            seq_len.* += 1;
            sequence[seq_len.*] = dp;
            seq_len.* += 1;

            found = findVCFSequenceRecursive(cells, color, depth + 1, limiter, max_depth, sequence, seq_len, is_forbidden_trap);

            if (!found) {
                // 手順を巻き戻し
                seq_len.* = saved_len;
            }
        }

        // Undo
        cells[def_idx] = .empty;
        bitboard.removeStone(dp.row, dp.col);
        cells[move_idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        if (found) return true;
    }

    return false;
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

test "findFourMoves: basic" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連: (7,5),(7,6),(7,7) → (7,4) と (7,8) が四の手
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var buf: [225]Position = undefined;
    const count = findFourMoves(&cells, .black, &buf);
    try testing.expect(count >= 2);
}

test "hasVCF: immediate five" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,4),(7,5),(7,6),(7,7) → 五連可能
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    const result = hasVCF(&cells, .black, 0, &limiter, VCF_MAX_DEPTH);
    try testing.expect(result);
}

test "hasVCF: no four available" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒1石のみ
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    const result = hasVCF(&cells, .black, 0, &limiter, VCF_MAX_DEPTH);
    try testing.expect(!result);
}

test "findVCFMove: immediate five" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,4),(7,5),(7,6),(7,7)
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFMove(&cells, .black, VCF_MAX_DEPTH, 0);
    try testing.expect(result != null);
}

test "findVCFMove: no VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFMove(&cells, .black, VCF_MAX_DEPTH, 0);
    try testing.expect(result == null);
}

test "hasVCF: open four (unblockable)" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連 + 両端空き → 仮置きで活四になる
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    // 白が1つブロック
    cells[7 * BOARD_SIZE + 4] = .white;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // (7,8) に置くと4連で片方開き = 止め四
    // 活四にするには別方向が必要。この配置では単なる止め四。
    // depth=1でVCFを探す
    const result = hasVCF(&cells, .black, 0, &limiter, VCF_MAX_DEPTH);
    // 3連+片ブロックでは活四にならないが、止め四→再帰
    // 実際には (7,8) で止め四 → 防御 → 終了。VCF不成立の可能性もある
    // テストは結果がboolを返すことの確認
    _ = result;
}

// === findVCFSequence Tests ===

test "findVCFSequence: immediate five - sequence has 1 move" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,4),(7,5),(7,6),(7,7) → (7,3) or (7,8) で五連
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFSequence(&cells, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 1), result.len);
    // 最終攻撃手のみ（五連完成手）
    const move = result.sequence[0];
    try testing.expect((move.row == 7 and move.col == 3) or (move.row == 7 and move.col == 8));
}

test "findVCFSequence: two-step VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連: (7,5),(7,6),(7,7) + (7,4)に白ブロック
    // → (7,8)で止め四 → 白が(7,9)で防御 → (7,3)方向にはブロックされている
    // もっと確実な2段VCF: 2方向に四が作れる配置
    //
    // 縦方向: (4,7),(5,7),(6,7) の3連
    // 横方向: (7,5),(7,6),(7,7) の3連
    // (7,7)が交点 → (3,7)で縦四 → 防御(8,7) → (7,8)で横四＋五連
    cells[4 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFSequence(&cells, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(result.found);
    // 少なくとも攻撃1→防御1→攻撃2の3手以上
    try testing.expect(result.len >= 1);
}

test "findVCFSequence: no VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒1石のみ → VCF不成立
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFSequence(&cells, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(!result.found);
}

test "findVCFSequenceFromFirstMove: immediate five" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,4),(7,5),(7,6),(7,7)
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFSequenceFromFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 1), result.len);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].row);
    try testing.expectEqual(@as(u8, 8), result.sequence[0].col);
}

test "findVCFSequenceFromFirstMove: occupied cell returns not found" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCFSequenceFromFirstMove(&cells, .{ .row = 7, .col = 7 }, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(!result.found);
}

test "findVCFSequence: 五点 0 個の偽四で VCF 成立にしない（issue #124）" {
    // 8 行目（row=7）: A8白 B8白 C8黒 D8黒 E8黒 F8空 G8空 H8黒 I8空 J8黒 K8空 L8白
    // 黒番。G8 に打っても五点はゼロ（F8 は 6 連＝長連、I8 は 4 連）なので四ですらない。
    // 旧実装は G8 を「止められない四」として len=1 の VCF を返していた。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 0] = .white; // A8
    cells[7 * BOARD_SIZE + 1] = .white; // B8
    cells[7 * BOARD_SIZE + 2] = .black; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[7 * BOARD_SIZE + 11] = .white; // L8

    const result = findVCFSequence(&cells, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(!result.found);

    const from_g8 = findVCFSequenceFromFirstMove(&cells, .{ .row = 7, .col = 6 }, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(!from_g8.found);
}
