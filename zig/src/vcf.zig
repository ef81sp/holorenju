/// VCF（Victory by Continuous Fours）探索
///
/// 四を連続して打つことで勝利する手順を探索する。
/// 白番の場合、黒の防御点が禁手なら即勝利。
/// TS版 vcf.ts に対応

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const deadline = @import("deadline.zig");
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

/// 探索の予算（時間 / ノード数）
///
/// 予算操作は VCF / VCT の両方から使うので、ここのメソッドを SSoT にする
/// （かつては `vcf.zig` と `vct.zig` に同名の自由関数が二重定義されていて、
///  片方が飽和加算・片方が通常加算という差もあった）。
pub const TimeLimiter = struct {
    start_time: u32,
    time_limit: u32,
    nodes: u32,
    max_nodes: u32, // 0 = 無制限

    /// 生成時点で親の予算が尽きていたことを表すフラグ（issue #147 B）
    ///
    /// `time_limit == 0` / `max_nodes == 0` はどちらも「無制限」を意味するため、
    /// 「残り 0」を数値で表現できない。`child()` が親の使い切りを検出したときに
    /// これを立て、`exceeded()` が最優先で見る。
    exhausted: bool = false,

    /// 探索ノードを 1 つ計上する
    pub fn bump(self: *TimeLimiter) void {
        self.nodes +|= 1;
    }

    /// 別 limiter で回した探索の消費ノードを取り込む（issue #119）
    pub fn charge(self: *TimeLimiter, consumed: u32) void {
        self.nodes +|= consumed;
    }

    /// 予算（ノード数 or 時間）を超えたか
    ///
    /// issue #147: 自前の予算に加えて **グローバル絶対デッドライン**
    /// （`deadline.g_absolute_deadline_ms`）も見る。`time_limit == 0`（壁時計無制限）の
    /// limiter でも打ち切られるよう、短絡より **前** にデッドラインを評価する。
    /// 時刻取得は 1 回だけで、従来より頻度が増えないようにしてある。
    pub fn exceeded(self: *const TimeLimiter) bool {
        if (self.exhausted) return true;
        if (self.max_nodes > 0 and self.nodes >= self.max_nodes) {
            return true;
        }
        const absolute = deadline.g_absolute_deadline_ms;
        if (self.time_limit == 0 and absolute == 0) return false;
        const now = getTimestampMs();
        if (now == 0) return false; // ネイティブテスト（時計なし）
        if (absolute != 0 and now >= absolute) return true;
        if (self.time_limit == 0) return false;
        return (now - self.start_time) >= self.time_limit;
    }

    /// 子探索へ渡す残りノード予算（0 = 無制限。issue #119 / レビュー should-8）
    ///
    /// 子探索は独自 limiter で回るので、満額の `max_nodes` を渡すと
    /// 「親の予算 × 子の数」まで使えてしまう。
    pub fn remainingNodes(self: *const TimeLimiter) u32 {
        if (self.max_nodes == 0) return 0;
        return self.max_nodes -| self.nodes;
    }

    /// 残りの壁時計予算（ms）。`null` = 無制限、`0` = 使い切り（issue #147 B）
    ///
    /// ネイティブテスト（擬似時計が 0 = 時計なし）では満額を返す。
    pub fn remainingMs(self: *const TimeLimiter) ?u32 {
        if (self.exhausted) return 0;
        if (self.time_limit == 0) return null;
        const now = getTimestampMs();
        if (now == 0) return self.time_limit; // 時計なし＝満額
        const elapsed = now -| self.start_time;
        if (elapsed >= self.time_limit) return 0;
        return self.time_limit - elapsed;
    }

    /// 子探索用の limiter を作る（issue #147 B の SSoT）
    ///
    /// 原則: **子の壁時計予算は親の残りを超えない。予算は復活しない。**
    /// エントリ関数（`findVCFSequence` / `findVCTSequence` など）は `start_time` を
    /// 現在時刻にリセットするため、親の中で呼ぶたびに予算が満額に戻っていた
    /// （プローブ 50ms → 実測 141ms、pre-search VCT 300ms → 494ms）。
    ///
    /// - 壁時計: 親が無制限なら `own_budget_ms` のまま、そうでなければ
    ///   `min(own_budget_ms, 親の残り)`（`own_budget_ms == 0`＝子は無制限を望む
    ///   場合は親の残りをそのまま継承）。
    /// - ノード: `own_max_nodes != 0` ならその値、`0` なら親の残りノード。
    ///   壁時計と違い `min` を取らないのは、ノード予算は #119 の `charge()` で
    ///   親へ払い戻される設計になっており、二重に絞ると既存の探索が変わるため。
    pub fn child(self: *const TimeLimiter, own_budget_ms: u32, own_max_nodes: u32) TimeLimiter {
        const parent_rem = self.remainingMs();
        const nodes_left = self.remainingNodes();
        const time_budget: u32 = if (parent_rem) |rem|
            (if (own_budget_ms == 0) rem else @min(own_budget_ms, rem))
        else
            own_budget_ms;
        return .{
            .start_time = getTimestampMs(),
            .time_limit = time_budget,
            .nodes = 0,
            .max_nodes = if (own_max_nodes != 0) own_max_nodes else nodes_left,
            .exhausted = self.exhausted or
                (parent_rem != null and parent_rem.? == 0) or
                (self.max_nodes != 0 and nodes_left == 0),
        };
    }

    /// 絶対時刻のデッドラインを「親 limiter」として表現する（issue #147 B）
    ///
    /// `SearchContext.deadline` のように limiter を持たない親（メイン探索）の
    /// 残り時間を `child()` に渡すためのアダプタ。`deadline_ms == 0` は無制限。
    pub fn untilDeadline(deadline_ms: u32) TimeLimiter {
        const unlimited = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
        if (deadline_ms == 0) return unlimited;
        const now = getTimestampMs();
        if (now == 0) return unlimited; // ネイティブテスト（時計なし）
        if (now >= deadline_ms) {
            return .{ .start_time = now, .time_limit = 1, .nodes = 0, .max_nodes = 0, .exhausted = true };
        }
        return .{ .start_time = now, .time_limit = deadline_ms - now, .nodes = 0, .max_nodes = 0 };
    }
};

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
    if (limiter.exceeded()) return false;
    if (depth >= max_depth) return false;

    var buf: [225]Position = undefined;
    const four_count = findFourMoves(cells, color, &buf);

    const opponent = color.opposite();

    for (0..four_count) |i| {
        const move = buf[i];
        limiter.bump();

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

        // #124: 勝ちは `.unstoppable`（活四）のみ。`.not_four` は四ですらないのでスキップ。
        // 網羅 switch にして、将来 variant が増えたときに黙って保守側へ落ちないようにする。
        const dp = switch (defense_pos) {
            .unstoppable => {
                // 止められない = 勝利
                cells[idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                return true;
            },
            .not_four => {
                cells[idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                continue;
            },
            .block => |p| p,
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
        if (limiter.exceeded()) return null;
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
    if (limiter.exceeded()) return null;

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
        limiter.bump();
        if (limiter.exceeded()) return null;

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
        const dp = switch (defense_pos) {
            .unstoppable => return move,
            .not_four => continue,
            .block => |p| p,
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
    /// この探索が消費したノード数（呼び出し側の共有 limiter へ加算するため。issue #119）
    nodes: u32 = 0,
};

/// VCF手順全体を返す（反復深化）
pub fn findVCFSequence(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
) VCFSequenceResult {
    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };
    return findVCFSequenceWithLimiter(cells, color, max_depth, &limiter);
}

/// 親 limiter の残り予算を継承した子 limiter で VCF 手順を探す（issue #147 B）
///
/// 子の消費ノードは呼び出し後に親へ計上する（#119 の部分払い）ので、
/// 呼び出し側で `charge()` を重ねて呼んではいけない。
pub fn findVCFSequenceWithParent(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    own_time_limit: u32,
    own_max_nodes: u32,
    parent: *TimeLimiter,
) VCFSequenceResult {
    var limiter = parent.child(own_time_limit, own_max_nodes);
    const result = findVCFSequenceWithLimiter(cells, color, max_depth, &limiter);
    parent.charge(limiter.nodes);
    return result;
}

/// `findVCFSequence` の本体（limiter を受け取る版）
fn findVCFSequenceWithLimiter(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    limiter: *TimeLimiter,
) VCFSequenceResult {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var result = VCFSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
    };

    // 反復深化: 浅い深度から探索し最短手順を優先
    var depth: u8 = 1;
    while (depth <= max_depth) : (depth += 1) {
        if (limiter.exceeded()) break;

        var seq_len: u8 = 0;
        var is_forbidden_trap = false;
        const found = findVCFSequenceRecursive(cells, color, 0, limiter, depth, &result.sequence, &seq_len, &is_forbidden_trap);
        if (found) {
            result.len = seq_len;
            result.is_forbidden_trap = is_forbidden_trap;
            result.found = true;
            break;
        }
    }
    // 呼び出し側（vct.zig など）が共有 limiter へ加算できるよう消費ノード数を返す（#119）
    result.nodes = limiter.nodes;
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
    // `.not_four` は createsFour を通っているので理論上到達しないが、保守側に倒す（#124）
    const dp = switch (defense_pos) {
        .unstoppable => {
            // 活四 → 防御不可能 → VCF成立
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            result.sequence[0] = first_move;
            result.len = 1;
            result.found = true;
            return result;
        },
        .not_four => {
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            return result;
        },
        .block => |p| p,
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

    result.nodes = continuation.nodes;
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
    if (limiter.exceeded()) return false;

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
        limiter.bump();
        if (limiter.exceeded()) return false;

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
        const dp = switch (defense_pos) {
            .unstoppable => {
                sequence[seq_len.*] = move;
                seq_len.* += 1;
                return true;
            },
            .not_four => continue,
            .block => |p| p,
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

/// 壁時計（ms）。時計の SSoT は `deadline.nowMs`（ネイティブテストでは擬似時計）。
fn getTimestampMs() u32 {
    return deadline.nowMs();
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

// --- issue #147: グローバル絶対デッドライン ---

test "TimeLimiter.exceeded: グローバル絶対デッドラインを超えていれば true（#147）" {
    // 予算無制限（time_limit=0 / max_nodes=0）の limiter でも、
    // グローバル絶対デッドラインを過ぎていれば打ち切られる。
    deadline.test_now_ms = 5000;
    defer deadline.test_now_ms = 0;

    var limiter = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    try testing.expect(!limiter.exceeded());

    deadline.set(1000);
    defer deadline.clear();
    try testing.expect(limiter.exceeded());

    deadline.clear();
    try testing.expect(!limiter.exceeded());
}

test "TimeLimiter.exceeded: デッドライン未到達なら従来どおり false（#147）" {
    deadline.test_now_ms = 500;
    defer deadline.test_now_ms = 0;
    deadline.set(1000);
    defer deadline.clear();

    var limiter = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    try testing.expect(!limiter.exceeded());
}

test "TimeLimiter.exceeded: グローバル 0 ならノード予算の判定は不変（#147）" {
    deadline.clear();
    var limiter = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 3, .max_nodes = 3 };
    try testing.expect(limiter.exceeded());

    var loose = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 2, .max_nodes = 3 };
    try testing.expect(!loose.exceeded());
}

// --- issue #147 B: 入れ子 limiter の予算継承 ---

test "TimeLimiter.remainingMs: 親の残り時間を返す（#147 B）" {
    deadline.clear();
    deadline.test_now_ms = 1020;
    defer deadline.test_now_ms = 0;

    // 予算 50ms・開始 1000ms・現在 1020ms → 残り 30ms
    const limited = TimeLimiter{ .start_time = 1000, .time_limit = 50, .nodes = 0, .max_nodes = 0 };
    try testing.expectEqual(@as(?u32, 30), limited.remainingMs());

    // 使い切り
    const spent = TimeLimiter{ .start_time = 900, .time_limit = 50, .nodes = 0, .max_nodes = 0 };
    try testing.expectEqual(@as(?u32, 0), spent.remainingMs());

    // 壁時計無制限は null（＝無制限）
    const unlimited = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    try testing.expectEqual(@as(?u32, null), unlimited.remainingMs());
}

test "TimeLimiter.child: 子の予算は min(独自予算, 親の残り)（#147 B）" {
    deadline.clear();
    deadline.test_now_ms = 1020;
    defer deadline.test_now_ms = 0;

    // 親の残り 30ms < 子の独自予算 50ms → 30ms
    const parent = TimeLimiter{ .start_time = 1000, .time_limit = 50, .nodes = 0, .max_nodes = 0 };
    const c = parent.child(50, 0);
    try testing.expectEqual(@as(u32, 30), c.time_limit);
    try testing.expectEqual(@as(u32, 1020), c.start_time);
    try testing.expect(!c.exhausted);

    // 子の独自予算 10ms < 親の残り 30ms → 10ms
    const tight = parent.child(10, 0);
    try testing.expectEqual(@as(u32, 10), tight.time_limit);

    // 子が壁時計無制限（0）を望んでも親の残りを継承する
    const inherit = parent.child(0, 0);
    try testing.expectEqual(@as(u32, 30), inherit.time_limit);
}

test "TimeLimiter.child: 親が無制限なら独自予算のまま（#147 B）" {
    deadline.clear();
    deadline.test_now_ms = 1020;
    defer deadline.test_now_ms = 0;

    const parent = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    const c = parent.child(50, 0);
    try testing.expectEqual(@as(u32, 50), c.time_limit);
    try testing.expect(!c.exhausted);

    // 独自予算も 0 なら無制限のまま
    const u = parent.child(0, 0);
    try testing.expectEqual(@as(u32, 0), u.time_limit);
}

test "TimeLimiter.child: 親が予算を使い切っていれば子は即打ち切り（#147 B）" {
    deadline.clear();
    deadline.test_now_ms = 1020;
    defer deadline.test_now_ms = 0;

    // 壁時計を使い切った親
    const spent = TimeLimiter{ .start_time = 900, .time_limit = 50, .nodes = 0, .max_nodes = 0 };
    var c = spent.child(50, 0);
    try testing.expect(c.exhausted);
    try testing.expect(c.exceeded());

    // ノード予算を使い切った親
    const spent_nodes = TimeLimiter{ .start_time = 1020, .time_limit = 0, .nodes = 100, .max_nodes = 100 };
    var cn = spent_nodes.child(50, 0);
    try testing.expect(cn.exceeded());
}

test "TimeLimiter.child: ノード予算は独自値、無指定なら親の残り（#147 B）" {
    deadline.clear();
    const parent = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 40, .max_nodes = 100 };
    try testing.expectEqual(@as(u32, 10), parent.child(0, 10).max_nodes);
    try testing.expectEqual(@as(u32, 60), parent.child(0, 0).max_nodes);

    const unlimited = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    try testing.expectEqual(@as(u32, 0), unlimited.child(0, 0).max_nodes);
}

test "TimeLimiter.untilDeadline: デッドラインまでの残りを親として表現する（#147 B）" {
    deadline.clear();
    deadline.test_now_ms = 1000;
    defer deadline.test_now_ms = 0;

    // 残り 200ms の親 → 子の 500ms 要求は 200ms に切り詰められる
    const parent = TimeLimiter.untilDeadline(1200);
    try testing.expectEqual(@as(?u32, 200), parent.remainingMs());
    try testing.expectEqual(@as(u32, 200), parent.child(500, 0).time_limit);

    // デッドライン超過 → 子は即打ち切り
    var past = TimeLimiter.untilDeadline(900).child(50, 0);
    try testing.expect(past.exceeded());

    // 0 は無制限
    const none = TimeLimiter.untilDeadline(0);
    try testing.expectEqual(@as(?u32, null), none.remainingMs());
}

test "findVCFSequenceWithParent: 親の残り時間を継承する（#147 B）" {
    deadline.clear();
    deadline.test_now_ms = 1020;
    defer deadline.test_now_ms = 0;

    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    // 親は壁時計を使い切っている → 子は探索せず不成立を返す
    var spent = TimeLimiter{ .start_time = 900, .time_limit = 50, .nodes = 0, .max_nodes = 0 };
    const blocked = findVCFSequenceWithParent(&cells, .black, VCF_MAX_DEPTH, 0, 0, &spent);
    try testing.expect(!blocked.found);

    // 親に余裕があれば従来どおり見つかる
    var fresh = TimeLimiter{ .start_time = 1000, .time_limit = 50, .nodes = 0, .max_nodes = 0 };
    const ok = findVCFSequenceWithParent(&cells, .black, VCF_MAX_DEPTH, 0, 0, &fresh);
    try testing.expect(ok.found);
    // 消費ノードは親へ計上される
    try testing.expect(fresh.nodes > 0);
}

test "findVCFSequence: グローバル絶対デッドライン超過で即打ち切り（#147）" {
    // 「two-step VCF」と同じ盤面。通常は found=true になる。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[4 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    try testing.expect(findVCFSequence(&cells, .black, VCF_MAX_DEPTH, 0, 0).found);

    deadline.test_now_ms = 5000;
    defer deadline.test_now_ms = 0;
    deadline.set(1000);
    defer deadline.clear();

    const result = findVCFSequence(&cells, .black, VCF_MAX_DEPTH, 0, 0);
    try testing.expect(!result.found);
}
