/// VCT（Victory by Continuous Threats）探索
///
/// 四と活三を含む脅威手を連続して打つことで勝利する手順を探索する。
/// VCFより広い脅威（活三を含む）を扱う。
/// TS版 vct.ts + vctHelpers.ts + threatMoves.ts + threatPatterns.ts に対応

const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const ll = @import("line_lookup.zig");
const patterns = @import("patterns.zig");
const quiescence = @import("quiescence.zig");
const scores = @import("scores.zig");
const threats = @import("threats.zig");
const vcf_mod = @import("vcf.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;
const Position = threats.Position;
const PositionList = threats.PositionList;
const TimeLimiter = vcf_mod.TimeLimiter;

/// VCT探索の最大深度
pub const VCT_MAX_DEPTH: u8 = 5;

/// VCT探索の時間制限（ミリ秒）
pub const VCT_TIME_LIMIT: u32 = 300;

/// ct=three 時のVCF深度上限
const CT_THREE_VCF_MAX_DEPTH: u8 = 6;

// =============================================================================
// 脅威分類（TS版 threatMoves.ts の classifyThreat に対応）
// =============================================================================

pub const ThreatClassification = struct {
    creates_four: bool,
    creates_open_three: bool,
};

/// 指定位置に石を置くと四/活三ができるかを1パスで判定
/// 石は配置済み前提
pub fn classifyThreat(cells: []const Cell, row: u8, col: u8, color: Cell) ThreatClassification {
    var has_four = false;
    var has_open_three = false;

    for (0..4) |i| {
        const result = ll.queryPatternFromCells(cells, row, col, i, color);

        // 連続四（黒はオーバーライン補正）
        if (result.count == 4) {
            var end1_open = result.end1 == 0;
            var end2_open = result.end2 == 0;
            if (color == .black) {
                if (end1_open) end1_open = !isOverlineEnd(cells, row, col, i, true);
                if (end2_open) end2_open = !isOverlineEnd(cells, row, col, i, false);
            }
            if (end1_open or end2_open) {
                has_four = true;
            }
        }

        // 跳び四
        if (!has_four and result.count != 4 and result.has_jump_four) {
            if (!isJumpFourOverline(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, color)) {
                has_four = true;
            }
        }

        // 連続活三
        if (result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            has_open_three = true;
        }

        // 跳び三
        if (!has_open_three and result.count != 3 and result.has_jump_three) {
            has_open_three = true;
        }

        if (has_four and has_open_three) break;
    }

    return .{ .creates_four = has_four, .creates_open_three = has_open_three };
}

/// 活三ができるかチェック（石配置済み前提）
pub fn createsOpenThree(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    for (0..4) |i| {
        const result = ll.queryPatternFromCells(cells, row, col, i, color);

        // 連続活三
        if (result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            return true;
        }

        // 跳び三
        if (result.count != 3 and result.has_jump_three) {
            return true;
        }
    }
    return false;
}

/// 脅威が成立しているか（四または活三）
pub fn isThreat(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    const result = classifyThreat(cells, row, col, color);
    return result.creates_four or result.creates_open_three;
}

// =============================================================================
// 跳び四長連チェック（TS版 threatMoves.ts の isJumpFourOverline に対応）
// =============================================================================

/// 黒のオーバーライン補正: count==4 の空き端の先に黒石があるかチェック
fn isOverlineEnd(cells: []const Cell, row: u8, col: u8, dir_idx: usize, is_positive: bool) bool {
    const dir = DIRECTIONS[dir_idx];
    const dr: i8 = if (is_positive) dir.dr else -dir.dr;
    const dc: i8 = if (is_positive) dir.dc else -dir.dc;

    // Count consecutive own stones from center in this direction
    var consecutive: i16 = 0;
    var r: i16 = @as(i16, row) + @as(i16, dr);
    var c: i16 = @as(i16, col) + @as(i16, dc);
    while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .black) {
        consecutive += 1;
        r += @as(i16, dr);
        c += @as(i16, dc);
    }

    // The end is at the empty cell. Check 1 further past it for a black stone.
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

fn isJumpFourOverline(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) bool {
    if (color != .black) return false;

    // 正方向のギャップを探す
    var gap = findJumpFourGapDir(cells, row, col, dr, dc);
    if (gap == null) {
        gap = findJumpFourGapDir(cells, row, col, -dr, -dc);
    }
    const g = gap orelse return false;

    // ギャップを埋めた場合の連続数をチェック
    const pos_result = board_mod.countInDirectionOnCells(cells, g.row, g.col, dr, dc, .black);
    const neg_result = board_mod.countInDirectionOnCells(cells, g.row, g.col, -dr, -dc, .black);
    const total = @as(u16, pos_result.count) + neg_result.count + 1;
    return total >= 6;
}

fn findJumpFourGapDir(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8) ?Position {
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;

    // 連続する石をスキップ
    while (board_mod.isValid(r, c) and cellAt(cells, r, c) == .black) {
        r += dr;
        c += dc;
    }

    // 空きマス
    if (!board_mod.isValid(r, c)) return null;
    if (cellAt(cells, r, c) != .empty) return null;

    const gap_r: u8 = @intCast(r);
    const gap_c: u8 = @intCast(c);

    // 空きの先に黒石が続くか
    r += dr;
    c += dc;
    if (board_mod.isValid(r, c) and cellAt(cells, r, c) == .black) {
        return .{ .row = gap_r, .col = gap_c };
    }
    return null;
}

// =============================================================================
// hasOpenThree（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 指定色が活三を持っているかチェック
pub fn hasOpenThree(cells: []const Cell, color: Cell) bool {
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            if (cellAt(cells, @intCast(row), @intCast(col)) != color) continue;

            for (0..4) |i| {
                const result = ll.queryPatternFromCells(cells, row, col, i, color);

                // 連続活三（跳び四の一部は除外）
                if (result.count == 3 and result.end1 == 0 and result.end2 == 0) {
                    if (!result.has_jump_four) {
                        return true;
                    }
                }

                // 跳び三
                if (result.count != 3 and result.has_jump_three) {
                    return true;
                }
            }
        }
    }
    return false;
}

// =============================================================================
// hasFourThreeAvailable（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 指定色がミセ手（1手で四三を作れる手）を持っているかチェック
pub fn hasFourThreeAvailable(cells: []Cell, color: Cell) bool {
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            const idx = @as(u16, row) * BOARD_SIZE + col;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, row, col)) continue;

            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, row, col);
                if (fr != .none) continue;
            }

            if (evaluate.createsFourThree(cells, row, col, color)) {
                return true;
            }
        }
    }
    return false;
}

// =============================================================================
// findThreatMoves（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 脅威（四・活三）を作れる位置を列挙（四を優先）
pub fn findThreatMoves(cells: []Cell, color: Cell, buf: *[225]Position) u16 {
    var four_count: u16 = 0;
    var three_count: u16 = 0;
    // 四は前から、活三は後ろから格納
    var three_buf: [225]Position = undefined;
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // インプレースで仮配置
            cells[idx] = color;

            // 五連が作れる場合は最優先
            if (forbidden.checkFive(cells, r, c, color)) {
                cells[idx] = .empty;
                buf[four_count] = .{ .row = r, .col = c };
                four_count += 1;
                continue;
            }

            // 四と活三を1パスで判定
            const threat = classifyThreat(cells, r, c, color);
            cells[idx] = .empty;

            if (!threat.creates_four and !threat.creates_open_three) continue;

            // 禁手チェック
            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, r, c);
                if (fr != .none) continue;
            }

            if (threat.creates_four) {
                buf[four_count] = .{ .row = r, .col = c };
                four_count += 1;
            } else {
                three_buf[three_count] = .{ .row = r, .col = c };
                three_count += 1;
            }
        }
    }

    // 活三を四の後ろに追加
    for (0..three_count) |i| {
        buf[four_count + i] = three_buf[i];
    }

    return four_count + three_count;
}

// =============================================================================
// getThreatDefensePositions（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 脅威に対する防御位置を取得
pub fn getThreatDefensePositions(cells: []const Cell, row: u8, col: u8, color: Cell) PositionList {
    var defense_positions = PositionList.init();

    for (DIRECTIONS, 0..) |dir, i| {
        const result = ll.queryPatternFromCells(cells, row, col, i, color);

        // 連続四をチェック（黒はオーバーライン補正）
        if (result.count == 4) {
            var end1_open = result.end1 == 0;
            var end2_open = result.end2 == 0;
            if (color == .black) {
                if (end1_open) end1_open = !isOverlineEnd(cells, row, col, i, true);
                if (end2_open) end2_open = !isOverlineEnd(cells, row, col, i, false);
            }

            if (end1_open and end2_open) {
                // 活四（両端開き）= 防御不可
                return PositionList.init();
            }

            // 止め四: 開いている端の座標を計算して防御位置とする
            if (end1_open) {
                const pos_count = board_mod.countInDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
                const er: u8 = @intCast(@as(i16, row) + @as(i16, dir.dr) * (@as(i16, pos_count.count) + 1));
                const ec: u8 = @intCast(@as(i16, col) + @as(i16, dir.dc) * (@as(i16, pos_count.count) + 1));
                defense_positions.addUnique(.{ .row = er, .col = ec });
            }
            if (end2_open) {
                const neg_count = board_mod.countInDirectionOnCells(cells, row, col, -dir.dr, -dir.dc, color);
                const er: u8 = @intCast(@as(i16, row) - @as(i16, dir.dr) * (@as(i16, neg_count.count) + 1));
                const ec: u8 = @intCast(@as(i16, col) - @as(i16, dir.dc) * (@as(i16, neg_count.count) + 1));
                defense_positions.addUnique(.{ .row = er, .col = ec });
            }
        }

        // 跳び四をチェック
        var has_jump_four = false;
        if (result.count != 4 and result.has_jump_four) {
            has_jump_four = true;
            if (threats.findJumpGapPosition(cells, row, col, dir.dr, dir.dc, color)) |gap| {
                defense_positions.addUnique(gap);
            }
        }

        // 活三をチェック（同方向に跳び四がある場合は不要：跳び四の防御が優先）
        if (!has_jump_four and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const ends = threats.getLineEnds(cells, row, col, dir.dr, dir.dc, color);
            for (0..ends.len) |j| {
                defense_positions.addUnique(ends.items[j]);
            }
        }

        // 跳び三をチェック
        if (result.count != 3 and result.has_jump_three) {
            const jump_defense = threats.getJumpThreeDefensePositions(cells, row, col, dir.dr, dir.dc, color);
            for (0..jump_defense.len) |j| {
                defense_positions.addUnique(jump_defense.items[j]);
            }
        }
    }

    return defense_positions;
}

// =============================================================================
// checkDefenseCounterThreat（TS版 threatPatterns.ts に対応）
// =============================================================================

pub const CounterThreat = enum {
    win,
    four,
    three,
    none,
};

/// 防御手のカウンター脅威をチェック
pub fn checkDefenseCounterThreat(cells: []const Cell, row: u8, col: u8, opponent_color: Cell) CounterThreat {
    // 五連チェック
    if (forbidden.checkFive(cells, row, col, opponent_color)) {
        return .win;
    }

    var has_three = false;
    for (0..4) |i| {
        const result = ll.queryPatternFromCells(cells, row, col, i, opponent_color);

        // 連続四（黒はオーバーライン補正）
        if (result.count == 4) {
            var end1_open = result.end1 == 0;
            var end2_open = result.end2 == 0;
            if (opponent_color == .black) {
                if (end1_open) end1_open = !isOverlineEnd(cells, row, col, i, true);
                if (end2_open) end2_open = !isOverlineEnd(cells, row, col, i, false);
            }
            if (end1_open or end2_open) {
                return .four;
            }
        }

        // 跳び四
        if (result.count != 4 and result.has_jump_four) {
            if (!isJumpFourOverline(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, opponent_color)) {
                return .four;
            }
        }

        // 連続活三
        if (result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            has_three = true;
        }

        // 跳び三
        if (!has_three and result.count != 3 and result.has_jump_three) {
            has_three = true;
        }
    }

    return if (has_three) .three else .none;
}

/// ブロック石が攻撃継続に必要な脅威を持つか判定
fn blockHasThreat(ct: CounterThreat) bool {
    return ct != .none;
}

// =============================================================================
// evaluateCounterThreat（TS版 vct.ts に対応）
// =============================================================================

/// 防御手のカウンター脅威に応じてVCT継続を判定
fn evaluateCounterThreat(
    ct: CounterThreat,
    cells: []Cell,
    color: Cell,
    defense_pos: Position,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) bool {
    const opponent = color.opposite();

    switch (ct) {
        .win => return false,
        .four => {
            // 防御のカウンター四に対してブロック
            const block_pos = quiescence.getFourDefensePosition(cells, defense_pos.row, defense_pos.col, opponent);
            if (block_pos == null) {
                // 活四でブロック不可 → VCT不成立
                return false;
            }
            const bp = block_pos.?;

            // ブロック配置
            const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
            cells[block_idx] = color;

            // ブロック石が攻撃側の脅威を作らなければVCT不成立
            const block_ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
            if (!blockHasThreat(block_ct)) {
                cells[block_idx] = .empty;
                return false;
            }

            // ブロックの脅威に対する防御をチェック
            const block_ok = processBlockDefenses(cells, bp, color, depth, max_depth, limiter);

            cells[block_idx] = .empty;
            return block_ok;
        },
        .three => {
            // 防御側が活三 → VCFのみで勝てるか
            if (isTimeExceeded(limiter)) return false;
            const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
            return vcf_mod.hasVCF(cells, color, 0, limiter, vcf_depth);
        },
        .none => {
            // 通常の再帰
            return hasVCT(cells, color, depth + 1, limiter, max_depth);
        },
    }
}

fn isTimeExceeded(limiter: *const TimeLimiter) bool {
    if (limiter.max_nodes > 0 and limiter.nodes >= limiter.max_nodes) {
        return true;
    }
    if (limiter.time_limit == 0) return false;
    const now = getTimestampMs();
    if (now == 0) return false;
    return (now - limiter.start_time) >= limiter.time_limit;
}

// =============================================================================
// processBlockDefenses
// =============================================================================

/// ブロックの脅威に対する防御サイクルを処理
fn processBlockDefenses(
    cells: []Cell,
    block_pos: Position,
    color: Cell,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
) bool {
    const opponent = color.opposite();

    const block_def_positions = getThreatDefensePositions(cells, block_pos.row, block_pos.col, color);

    // 防御不可 → ブロックの脅威で勝ち
    if (block_def_positions.len == 0) {
        return true;
    }

    for (0..block_def_positions.len) |i| {
        const bd_pos = block_def_positions.items[i];

        // 白番: 黒の防御位置が禁手ならスキップ（攻撃側の勝ち）
        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, bd_pos.row, bd_pos.col);
            if (fr != .none) continue;
        }

        const bd_idx = @as(u16, bd_pos.row) * BOARD_SIZE + bd_pos.col;
        cells[bd_idx] = opponent;

        const bd_ct = checkDefenseCounterThreat(cells, bd_pos.row, bd_pos.col, opponent);

        if (bd_ct == .win) {
            cells[bd_idx] = .empty;
            return false;
        }

        const vct_ok = evaluateCounterThreat(bd_ct, cells, color, bd_pos, depth, limiter, max_depth);

        cells[bd_idx] = .empty;

        if (!vct_ok) return false;
    }

    return true;
}

// =============================================================================
// hasVCT
// =============================================================================

/// VCTが成立するかチェック
pub fn hasVCT(
    cells: []Cell,
    color: Cell,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) bool {
    if (depth >= max_depth) return false;
    if (isTimeExceeded(limiter)) return false;

    // まずVCFを試す
    if (vcf_mod.hasVCF(cells, color, 0, limiter, vcf_mod.VCF_MAX_DEPTH)) {
        return true;
    }

    const opponent = color.opposite();

    // 相手に活三があればVCT（三脅威）は不成立
    if (hasOpenThree(cells, opponent)) return false;

    var threat_buf: [225]Position = undefined;
    const threat_count = findThreatMoves(cells, color, &threat_buf);

    for (0..threat_count) |i| {
        const move = threat_buf[i];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;

        // 五連チェック
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            return true;
        }

        const defense_positions = getThreatDefensePositions(cells, move.row, move.col, color);

        if (defense_positions.len == 0) {
            // 防御不可 → 脅威が成立していれば勝ち
            if (isThreat(cells, move.row, move.col, color)) {
                cells[move_idx] = .empty;
                return true;
            }
            cells[move_idx] = .empty;
            continue;
        }

        // 全防御に対してVCTが継続するかチェック
        var all_defense_leads_to_vct = true;

        for (0..defense_positions.len) |j| {
            const dp = defense_positions.items[j];

            // 白番: 黒の防御位置が禁手ならスキップ
            if (color == .white) {
                const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
                if (fr != .none) continue;
            }

            const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
            cells[def_idx] = opponent;

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);
            const vct_ok = evaluateCounterThreat(ct, cells, color, dp, depth, limiter, max_depth);

            cells[def_idx] = .empty;

            if (!vct_ok) {
                all_defense_leads_to_vct = false;
                break;
            }
        }

        cells[move_idx] = .empty;

        if (all_defense_leads_to_vct and defense_positions.len > 0) {
            return true;
        }
    }

    return false;
}

// =============================================================================
// findVCTMove（反復深化）
// =============================================================================

/// VCT勝ち手を探索
pub fn findVCTMove(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32) ?Position {
    return findVCTMoveWithBudget(cells, color, max_depth, time_limit, 0);
}

/// VCT勝ち手を探索（ノード数制限付き）
/// max_nodes=0 は無制限
pub fn findVCTMoveWithBudget(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32, max_nodes: u32) ?Position {
    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT無効
    if (hasOpenThree(cells, opponent)) return null;
    if (hasFourThreeAvailable(cells, opponent)) return null;
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return null;

    // まずVCFの手を試す
    const vcf_move = vcf_mod.findVCFMoveWithBudget(cells, color, vcf_mod.VCF_MAX_DEPTH, time_limit, max_nodes);
    if (vcf_move) |vm| return vm;

    // 反復深化
    var depth: u8 = 1;
    while (depth <= max_depth) : (depth += 1) {
        if (isTimeExceeded(&limiter)) return null;
        const result = findVCTMoveRecursive(cells, color, 0, &limiter, depth);
        if (result) |_| return result;
    }
    return null;
}

/// VCT手の再帰探索
fn findVCTMoveRecursive(
    cells: []Cell,
    color: Cell,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) ?Position {
    if (depth >= max_depth) return null;
    if (isTimeExceeded(limiter)) return null;

    // VCFに委譲
    const vcf_move = vcf_mod.findVCFMove(cells, color, vcf_mod.VCF_MAX_DEPTH, 0);
    if (vcf_move) |vm| return if (depth == 0) vm else vcf_move;

    const opponent = color.opposite();

    // 相手に活三があればVCT不成立
    if (hasOpenThree(cells, opponent)) return null;

    var threat_buf: [225]Position = undefined;
    const threat_count = findThreatMoves(cells, color, &threat_buf);

    for (0..threat_count) |i| {
        const move = threat_buf[i];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;

        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            return move;
        }

        const defense_positions = getThreatDefensePositions(cells, move.row, move.col, color);

        if (defense_positions.len == 0) {
            if (isThreat(cells, move.row, move.col, color)) {
                cells[move_idx] = .empty;
                return move;
            }
            cells[move_idx] = .empty;
            continue;
        }

        var all_defense_leads_to_vct = true;

        for (0..defense_positions.len) |j| {
            const dp = defense_positions.items[j];

            if (color == .white) {
                const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
                if (fr != .none) continue;
            }

            const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
            cells[def_idx] = opponent;

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

            var vct_ok = false;
            switch (ct) {
                .win => vct_ok = false,
                .four => {
                    const block_pos = quiescence.getFourDefensePosition(cells, dp.row, dp.col, opponent);
                    if (block_pos == null) {
                        vct_ok = false;
                    } else {
                        const bp = block_pos.?;
                        const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
                        cells[block_idx] = color;

                        const block_ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
                        if (!blockHasThreat(block_ct)) {
                            vct_ok = false;
                        } else {
                            vct_ok = processBlockDefenses(cells, bp, color, depth, max_depth, limiter);
                        }

                        cells[block_idx] = .empty;
                    }
                },
                .three => {
                    if (!isTimeExceeded(limiter)) {
                        const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
                        vct_ok = vcf_mod.hasVCF(cells, color, 0, limiter, vcf_depth);
                    }
                },
                .none => {
                    // hasVCTで2番目以降の防御をチェック
                    if (j == 0) {
                        // 最初の防御は再帰で手を探す
                        const sub = findVCTMoveRecursive(cells, color, depth + 1, limiter, max_depth);
                        vct_ok = (sub != null);
                    } else {
                        vct_ok = hasVCT(cells, color, depth + 1, limiter, max_depth);
                    }
                },
            }

            cells[def_idx] = .empty;

            if (!vct_ok) {
                all_defense_leads_to_vct = false;
                break;
            }
        }

        cells[move_idx] = .empty;

        if (all_defense_leads_to_vct and defense_positions.len > 0) {
            return move;
        }
    }

    return null;
}

// =============================================================================
// findVCTSequence（手順蓄積版）
// =============================================================================

pub const VCTBranch = struct {
    defense_index: u8,
    defense_move: Position,
    continuation: [16]Position,
    continuation_len: u8,
};

pub const VCTSequenceResult = struct {
    sequence: [64]Position,
    len: u8,
    is_forbidden_trap: bool,
    found: bool,
    branches: [20]VCTBranch,
    branch_count: u8,
};

/// 再帰コンテキスト（分岐収集用）
const VCTRecursiveContext = struct {
    is_forbidden_trap: bool,
    collect_branches: bool,
    branches: [20]VCTBranch,
    branch_count: u8,
};

/// 防御ごとの手順エントリ
const DefenseSeqEntry = struct {
    defense: Position,
    seq: [64]Position,
    seq_len: u8,
    child_branches: [20]VCTBranch,
    child_branch_count: u8,
    is_forbidden_trap: bool,
};

const MAX_DEFENSE_ENTRIES = 20;

/// VCT手順全体を返す（反復深化）
pub fn findVCTSequence(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
    collect_branches: bool,
) VCTSequenceResult {
    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    var result = VCTSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
        .branches = undefined,
        .branch_count = 0,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT不成立（四追いでしか勝てない）
    if (hasOpenThree(cells, opponent)) return tryVCFOnly(cells, color, &limiter, &result);
    if (hasFourThreeAvailable(cells, opponent)) return tryVCFOnly(cells, color, &limiter, &result);
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return tryVCFOnly(cells, color, &limiter, &result);

    // VCFが先に成立する場合はVCF手順を返す
    const vcf_seq = vcf_mod.findVCFSequence(cells, color, vcf_mod.VCF_MAX_DEPTH, time_limit, max_nodes);
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            result.sequence[i] = vcf_seq.sequence[i];
        }
        result.len = vcf_seq.len;
        result.is_forbidden_trap = vcf_seq.is_forbidden_trap;
        result.found = true;
        return result;
    }

    // 反復深化
    var depth: u8 = 1;
    while (depth <= max_depth) : (depth += 1) {
        if (isTimeExceeded(&limiter)) return result;

        var seq_len: u8 = 0;
        var context = VCTRecursiveContext{
            .is_forbidden_trap = false,
            .collect_branches = collect_branches,
            .branches = undefined,
            .branch_count = 0,
        };
        const found = findVCTSequenceRecursive(cells, color, 0, depth, &limiter, &result.sequence, &seq_len, &context);
        if (found) {
            result.len = seq_len;
            result.is_forbidden_trap = context.is_forbidden_trap;
            result.found = true;
            result.branch_count = context.branch_count;
            var bi: u8 = 0;
            while (bi < context.branch_count) : (bi += 1) {
                result.branches[bi] = context.branches[bi];
            }
            return result;
        }
    }
    return result;
}

/// VCF-onlyフォールバック: 相手にVCT阻害要因があるとき
fn tryVCFOnly(cells: []Cell, color: Cell, limiter: *TimeLimiter, result: *VCTSequenceResult) VCTSequenceResult {
    const vcf_seq = vcf_mod.findVCFSequence(cells, color, vcf_mod.VCF_MAX_DEPTH, limiter.time_limit, if (limiter.max_nodes > 0) limiter.max_nodes else 0);
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            result.sequence[i] = vcf_seq.sequence[i];
        }
        result.len = vcf_seq.len;
        result.is_forbidden_trap = vcf_seq.is_forbidden_trap;
        result.found = true;
    }
    return result.*;
}

/// VCT手順の再帰探索
fn findVCTSequenceRecursive(
    cells: []Cell,
    color: Cell,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
    sequence: *[64]Position,
    seq_len: *u8,
    context: *VCTRecursiveContext,
) bool {
    if (depth >= max_depth) return false;
    if (isTimeExceeded(limiter)) return false;

    // VCF手順に委譲
    const vcf_seq = vcf_mod.findVCFSequence(cells, color, vcf_mod.VCF_MAX_DEPTH, 0, 0);
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            if (seq_len.* + i < 64) {
                sequence[seq_len.* + i] = vcf_seq.sequence[i];
            }
        }
        seq_len.* += vcf_seq.len;
        if (vcf_seq.is_forbidden_trap) {
            context.is_forbidden_trap = true;
        }
        return true;
    }

    const opponent = color.opposite();

    // 相手に活三があればVCT不成立
    if (hasOpenThree(cells, opponent)) return false;

    var threat_buf: [225]Position = undefined;
    const threat_count = findThreatMoves(cells, color, &threat_buf);

    // 最短手順の候補を保持（全脅威手を試して最短を選ぶ）
    var best_seq: [64]Position = undefined;
    var best_seq_len: u8 = 64; // 最短を見つけるため最大値で初期化
    var best_context = VCTRecursiveContext{
        .is_forbidden_trap = false,
        .collect_branches = context.collect_branches,
        .branches = undefined,
        .branch_count = 0,
    };
    var has_best = false;

    for (0..threat_count) |ti| {
        const move = threat_buf[ti];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;

        // 五連チェック — 1手で終わるので即返却（これ以上短い手順はない）
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            sequence[seq_len.*] = move;
            seq_len.* += 1;
            return true;
        }

        const defense_positions = getThreatDefensePositions(cells, move.row, move.col, color);

        if (defense_positions.len == 0) {
            if (isThreat(cells, move.row, move.col, color)) {
                cells[move_idx] = .empty;
                // 1手で終わるので即返却
                sequence[seq_len.*] = move;
                seq_len.* += 1;
                return true;
            }
            cells[move_idx] = .empty;
            continue;
        }

        // 全防御に対してVCTが継続するかチェック
        var all_defense_leads_to_vct = true;
        var defense_entries: [MAX_DEFENSE_ENTRIES]DefenseSeqEntry = undefined;
        var defense_entry_count: u8 = 0;
        var first_defense_seq: [64]Position = undefined;
        var first_defense_seq_len: u8 = 0;
        var has_first_defense = false;

        for (0..defense_positions.len) |j| {
            const dp = defense_positions.items[j];

            if (color == .white) {
                const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
                if (fr != .none) continue;
            }

            const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
            cells[def_idx] = opponent;

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

            if (ct == .win) {
                cells[def_idx] = .empty;
                all_defense_leads_to_vct = false;
                break;
            }

            // ct=four: ブロック配置
            if (ct == .four) {
                const block_pos = quiescence.getFourDefensePosition(cells, dp.row, dp.col, opponent);
                if (block_pos == null) {
                    cells[def_idx] = .empty;
                    all_defense_leads_to_vct = false;
                    break;
                }
                const bp = block_pos.?;
                const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
                cells[block_idx] = color;

                const block_ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
                if (!blockHasThreat(block_ct)) {
                    cells[block_idx] = .empty;
                    cells[def_idx] = .empty;
                    all_defense_leads_to_vct = false;
                    break;
                }

                const block_ok = processBlockDefensesSeq(cells, bp, color, depth, max_depth, limiter, context.collect_branches or !has_first_defense);

                if (block_ok.found) {
                    if (context.collect_branches and defense_entry_count < MAX_DEFENSE_ENTRIES) {
                        var entry = &defense_entries[defense_entry_count];
                        entry.defense = dp;
                        entry.seq[0] = bp;
                        var si: u8 = 0;
                        while (si < block_ok.seq_len) : (si += 1) {
                            entry.seq[1 + si] = block_ok.seq[si];
                        }
                        entry.seq_len = 1 + block_ok.seq_len;
                        entry.child_branch_count = 0;
                        entry.is_forbidden_trap = block_ok.is_forbidden_trap;
                        defense_entry_count += 1;
                    }
                    if (!has_first_defense and block_ok.seq_len_valid) {
                        first_defense_seq[0] = dp;
                        first_defense_seq[1] = bp;
                        var si: u8 = 0;
                        while (si < block_ok.seq_len) : (si += 1) {
                            first_defense_seq[2 + si] = block_ok.seq[si];
                        }
                        first_defense_seq_len = 2 + block_ok.seq_len;
                        has_first_defense = true;
                    }
                }

                cells[block_idx] = .empty;
                cells[def_idx] = .empty;

                if (!block_ok.found) {
                    all_defense_leads_to_vct = false;
                    break;
                }
                continue;
            }

            if (ct == .three) {
                // ct=three: VCFのみで勝てるか
                const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
                if (context.collect_branches or !has_first_defense) {
                    const vcf_result = vcf_mod.findVCFSequence(cells, color, vcf_depth, 0, 0);
                    if (!vcf_result.found) {
                        cells[def_idx] = .empty;
                        all_defense_leads_to_vct = false;
                        break;
                    }
                    if (context.collect_branches and defense_entry_count < MAX_DEFENSE_ENTRIES) {
                        var entry = &defense_entries[defense_entry_count];
                        entry.defense = dp;
                        var si: u8 = 0;
                        while (si < vcf_result.len) : (si += 1) {
                            entry.seq[si] = vcf_result.sequence[si];
                        }
                        entry.seq_len = vcf_result.len;
                        entry.child_branch_count = 0;
                        entry.is_forbidden_trap = vcf_result.is_forbidden_trap;
                        defense_entry_count += 1;
                    }
                    if (!has_first_defense) {
                        first_defense_seq[0] = dp;
                        var si: u8 = 0;
                        while (si < vcf_result.len) : (si += 1) {
                            first_defense_seq[1 + si] = vcf_result.sequence[si];
                        }
                        first_defense_seq_len = 1 + vcf_result.len;
                        has_first_defense = true;
                    }
                } else {
                    if (!vcf_mod.hasVCF(cells, color, 0, limiter, vcf_depth)) {
                        cells[def_idx] = .empty;
                        all_defense_leads_to_vct = false;
                        break;
                    }
                }
                cells[def_idx] = .empty;
                continue;
            }

            // ct=none: 通常の再帰
            if (context.collect_branches or !has_first_defense) {
                var sub_context = VCTRecursiveContext{
                    .is_forbidden_trap = false,
                    .collect_branches = context.collect_branches,
                    .branches = undefined,
                    .branch_count = 0,
                };
                var sub_seq: [64]Position = undefined;
                var sub_len: u8 = 0;
                const found = findVCTSequenceRecursive(cells, color, depth + 1, max_depth, limiter, &sub_seq, &sub_len, &sub_context);

                cells[def_idx] = .empty;

                if (!found) {
                    all_defense_leads_to_vct = false;
                    break;
                }

                if (context.collect_branches and defense_entry_count < MAX_DEFENSE_ENTRIES) {
                    var entry = &defense_entries[defense_entry_count];
                    entry.defense = dp;
                    var si: u8 = 0;
                    while (si < sub_len) : (si += 1) {
                        entry.seq[si] = sub_seq[si];
                    }
                    entry.seq_len = sub_len;
                    entry.child_branch_count = sub_context.branch_count;
                    var bi: u8 = 0;
                    while (bi < sub_context.branch_count) : (bi += 1) {
                        entry.child_branches[bi] = sub_context.branches[bi];
                    }
                    entry.is_forbidden_trap = sub_context.is_forbidden_trap;
                    defense_entry_count += 1;
                } else if (sub_context.is_forbidden_trap) {
                    context.is_forbidden_trap = true;
                }
                if (!has_first_defense) {
                    first_defense_seq[0] = dp;
                    var si: u8 = 0;
                    while (si < sub_len) : (si += 1) {
                        first_defense_seq[1 + si] = sub_seq[si];
                    }
                    first_defense_seq_len = 1 + sub_len;
                    has_first_defense = true;
                }
            } else {
                // hasVCTでチェックのみ
                const vct_ok = hasVCT(cells, color, depth + 1, limiter, max_depth);
                cells[def_idx] = .empty;
                if (!vct_ok) {
                    all_defense_leads_to_vct = false;
                    break;
                }
            }
        }

        cells[move_idx] = .empty;

        if (all_defense_leads_to_vct and defense_positions.len > 0 and has_first_defense) {
            // この脅威手での手順長を計算
            var candidate_seq: [64]Position = undefined;
            var candidate_len: u8 = 0;
            var candidate_context = VCTRecursiveContext{
                .is_forbidden_trap = false,
                .collect_branches = context.collect_branches,
                .branches = undefined,
                .branch_count = 0,
            };

            if (context.collect_branches and defense_entry_count > 0) {
                const shortest_idx = selectShortestDefense(&defense_entries, defense_entry_count);
                buildBranches(&defense_entries, defense_entry_count, shortest_idx, &candidate_seq, &candidate_len, move, &candidate_context);
            } else {
                candidate_seq[0] = move;
                candidate_len = 1;
                var fi: u8 = 0;
                while (fi < first_defense_seq_len) : (fi += 1) {
                    if (candidate_len < 64) {
                        candidate_seq[candidate_len] = first_defense_seq[fi];
                        candidate_len += 1;
                    }
                }
            }

            // 最短の候補を保持
            if (!has_best or candidate_len < best_seq_len) {
                var ci: u8 = 0;
                while (ci < candidate_len) : (ci += 1) {
                    best_seq[ci] = candidate_seq[ci];
                }
                best_seq_len = candidate_len;
                best_context = candidate_context;
                has_best = true;
            }
        }
    }

    if (has_best) {
        var ci: u8 = 0;
        while (ci < best_seq_len) : (ci += 1) {
            if (seq_len.* < 64) {
                sequence[seq_len.*] = best_seq[ci];
                seq_len.* += 1;
            }
        }
        context.is_forbidden_trap = best_context.is_forbidden_trap;
        context.branch_count = best_context.branch_count;
        var bi: u8 = 0;
        while (bi < best_context.branch_count) : (bi += 1) {
            context.branches[bi] = best_context.branches[bi];
        }
        return true;
    }

    return false;
}

/// ブロック防御のシーケンス版結果
const BlockDefSeqResult = struct {
    found: bool,
    seq: [64]Position,
    seq_len: u8,
    seq_len_valid: bool,
    is_forbidden_trap: bool,
};

/// processBlockDefenses のシーケンス収集版
fn processBlockDefensesSeq(
    cells: []Cell,
    block_pos: Position,
    color: Cell,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
    need_sequence: bool,
) BlockDefSeqResult {
    var result = BlockDefSeqResult{
        .found = false,
        .seq = undefined,
        .seq_len = 0,
        .seq_len_valid = false,
        .is_forbidden_trap = false,
    };

    const opponent = color.opposite();
    const block_def_positions = getThreatDefensePositions(cells, block_pos.row, block_pos.col, color);

    // 防御不可 → ブロックの脅威で勝ち
    if (block_def_positions.len == 0) {
        result.found = true;
        result.seq_len_valid = true;
        return result;
    }

    var longest_seq: [64]Position = undefined;
    var longest_len: u8 = 0;
    var has_longest = false;

    for (0..block_def_positions.len) |i| {
        const bd_pos = block_def_positions.items[i];

        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, bd_pos.row, bd_pos.col);
            if (fr != .none) continue;
        }

        const bd_idx = @as(u16, bd_pos.row) * BOARD_SIZE + bd_pos.col;
        cells[bd_idx] = opponent;

        const bd_ct = checkDefenseCounterThreat(cells, bd_pos.row, bd_pos.col, opponent);

        if (bd_ct == .win) {
            cells[bd_idx] = .empty;
            return result; // found=false
        }

        if (need_sequence) {
            const sub = buildBlockDefSubSequence(bd_ct, cells, color, bd_pos, depth, max_depth, limiter);
            cells[bd_idx] = .empty;
            if (!sub.found) return result;
            // candidate = [bd_pos, sub.seq...]
            const candidate_len = 1 + sub.seq_len;
            if (!has_longest or candidate_len > longest_len) {
                longest_seq[0] = bd_pos;
                var si: u8 = 0;
                while (si < sub.seq_len) : (si += 1) {
                    longest_seq[1 + si] = sub.seq[si];
                }
                longest_len = candidate_len;
                has_longest = true;
                result.is_forbidden_trap = sub.is_forbidden_trap;
            }
        } else {
            const vct_ok = evaluateCounterThreat(bd_ct, cells, color, bd_pos, depth, limiter, max_depth);
            cells[bd_idx] = .empty;
            if (!vct_ok) return result;
        }
    }

    result.found = true;
    if (has_longest) {
        var si: u8 = 0;
        while (si < longest_len) : (si += 1) {
            result.seq[si] = longest_seq[si];
        }
        result.seq_len = longest_len;
        result.seq_len_valid = true;
    }
    return result;
}

/// ブロック防御のサブシーケンス構築
const SubSeqResult = struct {
    found: bool,
    seq: [64]Position,
    seq_len: u8,
    is_forbidden_trap: bool,
};

fn buildBlockDefSubSequence(
    ct: CounterThreat,
    cells: []Cell,
    color: Cell,
    defense_pos: Position,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
) SubSeqResult {
    var result = SubSeqResult{
        .found = false,
        .seq = undefined,
        .seq_len = 0,
        .is_forbidden_trap = false,
    };

    switch (ct) {
        .win => return result,
        .three => {
            const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
            const vcf_result = vcf_mod.findVCFSequence(cells, color, vcf_depth, 0, 0);
            if (!vcf_result.found) return result;
            var i: u8 = 0;
            while (i < vcf_result.len) : (i += 1) {
                result.seq[i] = vcf_result.sequence[i];
            }
            result.seq_len = vcf_result.len;
            result.is_forbidden_trap = vcf_result.is_forbidden_trap;
            result.found = true;
            return result;
        },
        .four => {
            const opponent = color.opposite();
            const nested_block = quiescence.getFourDefensePosition(cells, defense_pos.row, defense_pos.col, opponent);
            if (nested_block == null) return result;
            const nb = nested_block.?;
            const nb_idx = @as(u16, nb.row) * BOARD_SIZE + nb.col;
            cells[nb_idx] = color;

            const nb_threat = checkDefenseCounterThreat(cells, nb.row, nb.col, color);
            if (!blockHasThreat(nb_threat)) {
                cells[nb_idx] = .empty;
                return result;
            }

            const nested = processBlockDefensesSeq(cells, nb, color, depth + 1, max_depth, limiter, true);
            cells[nb_idx] = .empty;
            if (!nested.found) return result;

            result.seq[0] = nb;
            var i: u8 = 0;
            while (i < nested.seq_len) : (i += 1) {
                result.seq[1 + i] = nested.seq[i];
            }
            result.seq_len = 1 + nested.seq_len;
            result.is_forbidden_trap = nested.is_forbidden_trap;
            result.found = true;
            return result;
        },
        .none => {
            var sub_seq: [64]Position = undefined;
            var sub_len: u8 = 0;
            var sub_context = VCTRecursiveContext{
                .is_forbidden_trap = false,
                .collect_branches = false,
                .branches = undefined,
                .branch_count = 0,
            };
            const found = findVCTSequenceRecursive(cells, color, depth + 1, max_depth, limiter, &sub_seq, &sub_len, &sub_context);
            if (!found) return result;
            var i: u8 = 0;
            while (i < sub_len) : (i += 1) {
                result.seq[i] = sub_seq[i];
            }
            result.seq_len = sub_len;
            result.is_forbidden_trap = sub_context.is_forbidden_trap;
            result.found = true;
            return result;
        },
    }
}

/// 最短の防御継続を選択（攻撃側の最短勝ちラインをメインPVにする）
fn selectShortestDefense(entries: *const [MAX_DEFENSE_ENTRIES]DefenseSeqEntry, count: u8) u8 {
    var shortest_idx: u8 = 0;
    var shortest_len: u8 = if (count > 0) entries[0].seq_len else 0;
    var i: u8 = 1;
    while (i < count) : (i += 1) {
        if (entries[i].seq_len < shortest_len) {
            shortest_len = entries[i].seq_len;
            shortest_idx = i;
        }
    }
    return shortest_idx;
}

/// メインPVとサイド分岐を構築
fn buildBranches(
    entries: *const [MAX_DEFENSE_ENTRIES]DefenseSeqEntry,
    entry_count: u8,
    main_idx: u8,
    sequence: *[64]Position,
    seq_len: *u8,
    move: Position,
    context: *VCTRecursiveContext,
) void {
    const main_entry = entries[main_idx];
    const defense_index_in_seq = seq_len.* + 1; // +1 for attack move

    if (main_entry.is_forbidden_trap) {
        context.is_forbidden_trap = true;
    }

    // push attack move
    sequence[seq_len.*] = move;
    seq_len.* += 1;
    // push defense + continuation
    sequence[seq_len.*] = main_entry.defense;
    seq_len.* += 1;
    var si: u8 = 0;
    while (si < main_entry.seq_len) : (si += 1) {
        if (seq_len.* < 64) {
            sequence[seq_len.*] = main_entry.seq[si];
            seq_len.* += 1;
        }
    }

    // メインPVの子分岐を親に統合
    const sub_seq_offset = defense_index_in_seq + 1;
    var ci: u8 = 0;
    while (ci < main_entry.child_branch_count) : (ci += 1) {
        if (context.branch_count < 20) {
            var branch = main_entry.child_branches[ci];
            branch.defense_index = @intCast(sub_seq_offset + branch.defense_index);
            context.branches[context.branch_count] = branch;
            context.branch_count += 1;
        }
    }

    // 残りの防御を分岐として記録
    var ei: u8 = 0;
    while (ei < entry_count) : (ei += 1) {
        if (ei == main_idx) {
            ei += 0; // skip
            continue;
        }
        if (context.branch_count >= 20) break;
        const entry = entries[ei];
        var branch = VCTBranch{
            .defense_index = @intCast(defense_index_in_seq),
            .defense_move = entry.defense,
            .continuation = undefined,
            .continuation_len = @min(entry.seq_len, 16),
        };
        var bi: u8 = 0;
        while (bi < branch.continuation_len) : (bi += 1) {
            branch.continuation[bi] = entry.seq[bi];
        }
        context.branches[context.branch_count] = branch;
        context.branch_count += 1;
    }
}

// =============================================================================
// findVCTSequenceFromFirstMove
// =============================================================================

/// 指定初手からのVCT手順を返す
pub fn findVCTSequenceFromFirstMove(
    cells: []Cell,
    first_move: Position,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
    collect_branches: bool,
) VCTSequenceResult {
    var result = VCTSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
        .branches = undefined,
        .branch_count = 0,
    };

    const idx = @as(u16, first_move.row) * BOARD_SIZE + first_move.col;
    if (cells[idx] != .empty) return result;

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT開始手として無効
    if (hasOpenThree(cells, opponent)) return result;
    if (hasFourThreeAvailable(cells, opponent)) return result;
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return result;

    // 仮配置
    cells[idx] = color;

    // 五連チェック → 即勝ち
    if (forbidden.checkFive(cells, first_move.row, first_move.col, color)) {
        cells[idx] = .empty;
        result.sequence[0] = first_move;
        result.len = 1;
        result.found = true;
        return result;
    }

    // 脅威かチェック
    if (!isThreat(cells, first_move.row, first_move.col, color)) {
        cells[idx] = .empty;
        return result;
    }

    // 防御位置を列挙
    const defense_positions = getThreatDefensePositions(cells, first_move.row, first_move.col, color);

    if (defense_positions.len == 0) {
        cells[idx] = .empty;
        result.sequence[0] = first_move;
        result.len = 1;
        result.found = true;
        return result;
    }

    // 全防御に対してVCT継続＆最短継続を記録（攻撃側の最短勝ちライン）
    var main_defense: ?Position = null;
    var main_continuation_seq: [64]Position = undefined;
    var main_continuation_len: u8 = 0;
    var main_is_forbidden_trap = false;

    for (0..defense_positions.len) |j| {
        const dp = defense_positions.items[j];

        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) continue;
        }

        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
        cells[def_idx] = opponent;

        const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

        if (ct == .win) {
            cells[def_idx] = .empty;
            cells[idx] = .empty;
            return result;
        }

        var continuation_found = false;
        var cont_seq: [64]Position = undefined;
        var cont_len: u8 = 0;
        var cont_is_forbidden = false;

        if (ct == .four) {
            const block_pos = quiescence.getFourDefensePosition(cells, dp.row, dp.col, opponent);
            if (block_pos == null) {
                cells[def_idx] = .empty;
                cells[idx] = .empty;
                return result;
            }
            const bp = block_pos.?;
            const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
            cells[block_idx] = color;

            const block_ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
            if (blockHasThreat(block_ct)) {
                const block_ok = processBlockDefensesSeq(cells, bp, color, 0, max_depth, &limiter, true);
                if (block_ok.found and block_ok.seq_len_valid) {
                    cont_seq[0] = bp;
                    var si: u8 = 0;
                    while (si < block_ok.seq_len) : (si += 1) {
                        cont_seq[1 + si] = block_ok.seq[si];
                    }
                    cont_len = 1 + block_ok.seq_len;
                    cont_is_forbidden = block_ok.is_forbidden_trap;
                    continuation_found = true;
                }
            }
            cells[block_idx] = .empty;
        } else if (ct == .three) {
            const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
            const vcf_result = vcf_mod.findVCFSequence(cells, color, vcf_depth, 0, 0);
            if (vcf_result.found) {
                var si: u8 = 0;
                while (si < vcf_result.len) : (si += 1) {
                    cont_seq[si] = vcf_result.sequence[si];
                }
                cont_len = vcf_result.len;
                cont_is_forbidden = vcf_result.is_forbidden_trap;
                continuation_found = true;
            }
        } else {
            // ct=none: 通常のVCT探索
            _ = collect_branches;
            const sub = findVCTSequence(cells, color, max_depth, time_limit, max_nodes, false);
            if (sub.found) {
                var si: u8 = 0;
                while (si < sub.len) : (si += 1) {
                    cont_seq[si] = sub.sequence[si];
                }
                cont_len = sub.len;
                cont_is_forbidden = sub.is_forbidden_trap;
                continuation_found = true;
            }
        }

        cells[def_idx] = .empty;

        if (!continuation_found) {
            cells[idx] = .empty;
            return result;
        }

        // 最短の継続をメインラインとして記録（攻撃側の最短勝ちライン）
        if (main_defense == null or cont_len < main_continuation_len) {
            main_defense = dp;
            var si: u8 = 0;
            while (si < cont_len) : (si += 1) {
                main_continuation_seq[si] = cont_seq[si];
            }
            main_continuation_len = cont_len;
            main_is_forbidden_trap = cont_is_forbidden;
        }
    }

    cells[idx] = .empty;

    if (main_defense == null) return result;

    // 手順を組み立て: [初手, 防御手, 継続手順...]
    result.sequence[0] = first_move;
    result.sequence[1] = main_defense.?;
    var i: u8 = 0;
    while (i < main_continuation_len) : (i += 1) {
        if (2 + i < 64) {
            result.sequence[2 + i] = main_continuation_seq[i];
        }
    }
    result.len = 2 + main_continuation_len;
    result.is_forbidden_trap = main_is_forbidden_trap;
    result.found = true;
    return result;
}

// =============================================================================
// isVCTFirstMove
// =============================================================================

/// 指定手がVCT開始手として有効かチェック
pub fn isVCTFirstMove(
    cells: []Cell,
    move_pos: Position,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
) bool {
    const idx = @as(u16, move_pos.row) * BOARD_SIZE + move_pos.col;
    if (cells[idx] != .empty) return false;

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT開始手として無効
    if (hasOpenThree(cells, opponent)) return false;
    if (hasFourThreeAvailable(cells, opponent)) return false;
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return false;

    // 仮配置
    cells[idx] = color;

    // 五連チェック
    if (forbidden.checkFive(cells, move_pos.row, move_pos.col, color)) {
        cells[idx] = .empty;
        return true;
    }

    // 脅威かチェック
    if (!isThreat(cells, move_pos.row, move_pos.col, color)) {
        cells[idx] = .empty;
        return false;
    }

    // 防御位置を列挙
    const defense_positions = getThreatDefensePositions(cells, move_pos.row, move_pos.col, color);

    if (defense_positions.len == 0) {
        cells[idx] = .empty;
        return true;
    }

    // 全防御に対してVCTが継続するか
    for (0..defense_positions.len) |j| {
        const dp = defense_positions.items[j];

        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) continue;
        }

        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
        cells[def_idx] = opponent;

        const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);
        const vct_ok = evaluateCounterThreat(ct, cells, color, dp, 1, &limiter, max_depth);

        cells[def_idx] = .empty;

        if (!vct_ok) {
            cells[idx] = .empty;
            return false;
        }
    }

    cells[idx] = .empty;
    return true;
}

// =============================================================================
// ユーティリティ
// =============================================================================

fn cellAt(cells: []const Cell, r: i16, c: i16) Cell {
    return cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))];
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

test "classifyThreat: four detection" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連: (7,5),(7,6),(7,7) + 仮配置 (7,8)
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み

    const result = classifyThreat(&cells, 7, 8, .black);
    try testing.expect(result.creates_four);
}

test "classifyThreat: open three detection" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒2連 + 仮配置で3連: (7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み

    const result = classifyThreat(&cells, 7, 8, .black);
    try testing.expect(result.creates_open_three);
}

test "hasOpenThree: basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活三: (7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    try testing.expect(hasOpenThree(&cells, .black));
    try testing.expect(!hasOpenThree(&cells, .white));
}

test "getThreatDefensePositions: four" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,5),(7,6),(7,7),(7,8) 片端ブロック
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    const defense = getThreatDefensePositions(&cells, 7, 8, .black);
    // 止め四: (7,9) の1点で防御
    try testing.expect(defense.len == 1);
    try testing.expectEqual(defense.items[0].col, 9);
}

test "getThreatDefensePositions: open four" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活四: (7,5),(7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;

    const defense = getThreatDefensePositions(&cells, 7, 8, .black);
    // 活四: 防御不可
    try testing.expectEqual(defense.len, 0);
}

test "checkDefenseCounterThreat: basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白が3連 → 防御の仮配置で4連に
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 8] = .white; // 防御石配置

    const ct = checkDefenseCounterThreat(&cells, 7, 8, .white);
    try testing.expect(ct == .four);
}

test "hasVCT: immediate five via VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: VCFで即勝ち
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    const result = hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH);
    try testing.expect(result);
}

test "hasVCT: no threat" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    const result = hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH);
    try testing.expect(!result);
}

test "findVCTMove: immediate via VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTMove(&cells, .black, VCT_MAX_DEPTH, 0);
    try testing.expect(result != null);
}

test "findThreatMoves: four prioritized" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連 → 四を作れる
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    var buf: [225]Position = undefined;
    const count = findThreatMoves(&cells, .black, &buf);
    try testing.expect(count >= 2);
}

// === findVCTSequence Tests ===

test "findVCTSequence: immediate five via VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: VCFで即勝ち
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(result.found);
    try testing.expect(result.len >= 1);
}

test "findVCTSequence: no VCT" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(!result.found);
}

test "findVCTSequenceFromFirstMove: immediate five" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,4),(7,5),(7,6),(7,7)
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 1), result.len);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].row);
    try testing.expectEqual(@as(u8, 8), result.sequence[0].col);
}

test "findVCTSequenceFromFirstMove: occupied cell returns not found" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 7 }, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(!result.found);
}

test "isVCTFirstMove: immediate five" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = isVCTFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCT_MAX_DEPTH, 0, 0);
    try testing.expect(result);
}

test "isVCTFirstMove: not a threat" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = isVCTFirstMove(&cells, .{ .row = 0, .col = 0 }, .black, VCT_MAX_DEPTH, 0, 0);
    try testing.expect(!result);
}

test "findVCTMove: 5-stone opening should not find VCT for white" {
    // 棋譜: H8 H9 J10 I9 G7
    // Black: H8(7,7), J10(5,9), G7(8,6)
    // White: H9(6,7), I9(6,8)
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[5 * BOARD_SIZE + 9] = .black; // J10
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 6] = .black; // G7

    // White should NOT have VCT in this early position
    const move = findVCTMove(&cells, .white, VCT_MAX_DEPTH, 5000);
    try testing.expect(move == null);
}

test "findVCTSequence: 5-stone opening should not find VCT for white" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .white;
    cells[5 * BOARD_SIZE + 9] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 6] = .black;

    const result = findVCTSequence(&cells, .white, VCT_MAX_DEPTH, 5000, 500000, false);
    try testing.expect(!result.found);
}

test "getThreatDefensePositions: black four with overline should not be undefendable" {
    // C8-D8-E8-F8-(空G8)-H8(黒) の配置
    // row=7 (0-indexed), C=2, D=3, E=4, F=5, G=6(empty), H=7
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .black; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    // G8 (7*15+6) = empty
    cells[7 * BOARD_SIZE + 7] = .black; // H8

    // E8を基準に脅威防御判定: G8方向はoverlineで塞がり
    // → 防御不可（空リスト）ではなく、B8を含む防御位置を返すべき
    const defense = getThreatDefensePositions(&cells, 7, 4, .black);
    try testing.expect(defense.len > 0); // 防御可能
    try testing.expectEqual(defense.items[0].row, 7);
    try testing.expectEqual(defense.items[0].col, 1); // B8
}
