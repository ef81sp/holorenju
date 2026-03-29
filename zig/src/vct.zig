/// VCT（Victory by Continuous Threats）探索
///
/// 四と活三を含む脅威手を連続して打つことで勝利する手順を探索する。
/// VCFより広い脅威（活三を含む）を扱う。
/// TS版 vct.ts + vctHelpers.ts + threatMoves.ts + threatPatterns.ts に対応

const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
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

    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        const dir_index = jp.DIRECTION_INDICES[i];

        // 連続四（黒は長連チェック付き）
        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            // 黒の長連チェック: analyzeDirectionOnCells の count は center 含む
            // count==4 は4連。checkEndsForFour相当のチェックは
            // 端が開いていれば四が成立（黒の場合、TS版ではcheckEndsForFourで
            // 追加の長連チェックを行うが、count==4 なら5連目で問題ない）
            has_four = true;
        }

        // 跳び四
        if (!has_four and result.count != 4) {
            if (jp.checkJumpFour(cells, row, col, dir_index, color)) {
                if (!isJumpFourOverline(cells, row, col, dir.dr, dir.dc, color)) {
                    has_four = true;
                }
            }
        }

        // 連続活三
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            // 跳び四の一部である連続三は活三ではないのチェックは省略
            // （classifyThreat では厳密な判定よりも高速性を重視）
            has_open_three = true;
        }

        // 跳び三
        if (!has_open_three and result.count != 3) {
            if (jp.checkJumpThree(cells, row, col, dir_index, color)) {
                has_open_three = true;
            }
        }

        if (has_four and has_open_three) break;
    }

    return .{ .creates_four = has_four, .creates_open_three = has_open_three };
}

/// 活三ができるかチェック（石配置済み前提）
pub fn createsOpenThree(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        const dir_index = jp.DIRECTION_INDICES[i];

        // 連続活三
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            return true;
        }

        // 跳び三
        if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color)) {
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

            for (DIRECTIONS, 0..) |dir, i| {
                const dir_index = jp.DIRECTION_INDICES[i];
                const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

                // 連続活三（跳び四の一部は除外）
                if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
                    if (!jp.checkJumpFour(cells, row, col, dir_index, color)) {
                        return true;
                    }
                }

                // 跳び三
                if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color)) {
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
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            const idx = @as(u16, row) * BOARD_SIZE + col;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearExistingStone(cells, row, col)) continue;

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

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearExistingStone(cells, r, c)) continue;

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
        const dir_index = jp.DIRECTION_INDICES[i];
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

        // 連続四をチェック
        if (result.count == 4) {
            const ends = threats.getLineEnds(cells, row, col, dir.dr, dir.dc, color);
            // 活四（両端開き）= 防御不可
            if (ends.len == 2) {
                return PositionList.init();
            }
            // 止め四 = 1点で防御
            if (ends.len == 1) {
                defense_positions.addUnique(ends.items[0]);
            }
        }

        // 跳び四をチェック
        if (result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, color)) {
            if (threats.findJumpGapPosition(cells, row, col, dir.dr, dir.dc, color)) |gap| {
                defense_positions.addUnique(gap);
            }
        }

        // 活三をチェック
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            const ends = threats.getLineEnds(cells, row, col, dir.dr, dir.dc, color);
            for (0..ends.len) |j| {
                defense_positions.addUnique(ends.items[j]);
            }
        }

        // 跳び三をチェック
        if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color)) {
            const jump_defense = threats.detectJumpThreePattern(cells, row, col, dir.dr, dir.dc, color);
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
    for (DIRECTIONS, 0..) |dir, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, opponent_color);

        // 連続四
        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            return .four;
        }

        // 跳び四
        if (result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, opponent_color)) {
            if (!isJumpFourOverline(cells, row, col, dir.dr, dir.dc, opponent_color)) {
                return .four;
            }
        }

        // 連続活三
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            has_three = true;
        }

        // 跳び三
        if (!has_three and result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, opponent_color)) {
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
    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = 0,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT無効
    if (hasOpenThree(cells, opponent)) return null;
    if (hasFourThreeAvailable(cells, opponent)) return null;
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return null;

    // まずVCFの手を試す
    const vcf_move = vcf_mod.findVCFMove(cells, color, vcf_mod.VCF_MAX_DEPTH, time_limit);
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
