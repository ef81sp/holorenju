/// 位置評価関数
///
/// 指定位置に石を置いた場合の評価スコアを計算
/// TS版 positionEvaluation.ts に対応

const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const patterns = @import("patterns.zig");
const scores = @import("scores.zig");
const threats_mod = @import("threats.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;

pub const Position = threats_mod.Position;

/// 評価オプション
pub const EvalOptions = struct {
    enable_mise: bool = false,
    enable_forbidden_trap: bool = false,
    enable_multi_threat: bool = false,
    enable_counter_four: bool = false,
    enable_mandatory_defense: bool = false,
    enable_single_four_penalty: bool = false,
    single_four_penalty_multiplier: i32 = 100, // 0-100 (実際の値は /100)
    enable_mise_threat: bool = false,
    enable_double_three_threat: bool = false,
    enable_forbidden_vulnerability: bool = false,
    has_precomputed_threats: bool = false,
    precomputed_threats: ?threats_mod.ThreatInfo = null,
};

pub const DEFAULT_EVAL_OPTIONS = EvalOptions{};

pub const FULL_EVAL_OPTIONS = EvalOptions{
    .enable_mise = true,
    .enable_forbidden_trap = true,
    .enable_multi_threat = true,
    .enable_counter_four = true,
    .enable_mandatory_defense = true,
    .enable_single_four_penalty = true,
    .single_four_penalty_multiplier = 0,
    .enable_mise_threat = true,
    .enable_double_three_threat = true,
    .enable_forbidden_vulnerability = true,
};

/// 中央からの距離に基づくボーナスを計算
pub fn getCenterBonus(row: u8, col: u8) i32 {
    const dr = if (row > 7) @as(i32, row) - 7 else 7 - @as(i32, row);
    const dc = if (col > 7) @as(i32, col) - 7 else 7 - @as(i32, col);
    const distance = dr + dc;
    const bonus = @divTrunc(@max(0, scores.CENTER_BONUS * (14 - distance)), 14);
    return bonus;
}

/// 防御倍率
const DEFENSE_MULTIPLIERS = struct {
    const five: i32 = 100; // 1.0 * 100
    const open_four: i32 = 95; // 0.95 * 100
    const four: i32 = 70; // 0.7 * 100
    const open_three: i32 = 70; // 0.7 * 100
    const three: i32 = 30; // 0.3 * 100
    const open_two: i32 = 20; // 0.2 * 100
    const two: i32 = 10; // 0.1 * 100
};

/// 石パターンスコア（各方向合算 + 跳びパターン）— computeAttackScore に対応
fn computeAttackScore(cells: []Cell, row: u8, col: u8, color: Cell) struct {
    score: i32,
    has_four: bool,
    has_valid_open_three: bool,
    jump_four_count: i32,
    has_jump_three: bool,
} {
    var total_score: i32 = 0;

    // 各方向の解析結果をキャッシュ
    var dir_counts: [4]u8 = undefined;
    var dir_end1s: [4]board_mod.EndState = undefined;
    var dir_end2s: [4]board_mod.EndState = undefined;
    var jump_four_dirs: [4]bool = [_]bool{false} ** 4;

    // 1st pass: 連続パターン + 跳び四検出
    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        dir_counts[i] = result.count;
        dir_end1s[i] = result.end1;
        dir_end2s[i] = result.end2;

        var dir_score = patterns.getPatternScore(result.count, result.end1, result.end2);

        // 斜め方向ボーナス
        if ((i == 2 or i == 3) and dir_score > 0) {
            dir_score = @divTrunc(dir_score * scores.DIAGONAL_BONUS_NUM + 50, scores.DIAGONAL_BONUS_DEN);
        }

        total_score += dir_score;

        // 跳び四チェック
        const dir_index = jp.DIRECTION_INDICES[i];
        if (result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, color)) {
            jump_four_dirs[i] = true;
        }
    }

    // 2nd pass: 四・活三判定
    var has_four = false;
    var has_valid_open_three = false;
    var jump_four_count: i32 = 0;
    var has_jump_three = false;

    for (DIRECTIONS, 0..) |_, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const count = dir_counts[i];
        const end1 = dir_end1s[i];
        const end2 = dir_end2s[i];

        // 連続四
        if (count == 4 and (end1 == .empty or end2 == .empty)) {
            has_four = true;
        }

        // 連続三の有効性チェック（跳び四方向でなければ）
        if (count == 3 and !jump_four_dirs[i] and end1 == .empty and end2 == .empty) {
            if (patterns.isValidConsecutiveThree(cells, row, col, dir_index, color)) {
                has_valid_open_three = true;
            }
        }

        // 跳び四
        if (jump_four_dirs[i]) {
            has_four = true;
            jump_four_count += 1;
        }

        // 跳び三
        if (count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color)) {
            has_jump_three = true;
            if (patterns.isValidJumpThree(cells, row, col, dir_index, color)) {
                has_valid_open_three = true;
            }
        }
    }

    // 跳び四のスコア加算
    total_score += jump_four_count * scores.FOUR;

    // 跳び三のスコア加算
    if (has_jump_three and has_valid_open_three) {
        total_score += scores.OPEN_THREE;
    }

    return .{
        .score = total_score,
        .has_four = has_four,
        .has_valid_open_three = has_valid_open_three,
        .jump_four_count = jump_four_count,
        .has_jump_three = has_jump_three,
    };
}

/// 指定位置に石を置いた場合の評価スコアを計算
pub fn evaluatePosition(
    cells: []Cell,
    row: u8,
    col: u8,
    color: Cell,
    options: EvalOptions,
) i32 {
    if (color == .empty) return 0;

    const idx = @as(u16, row) * BOARD_SIZE + col;

    // 五連チェック（最優先、盤面変更前）
    if (forbidden.checkFive(cells, row, col, color)) {
        return scores.FIVE;
    }

    // インプレースで石を配置
    cells[idx] = color;

    const score = evaluatePositionCore(cells, row, col, color, options);

    // 確実にUndoする
    cells[idx] = .empty;
    return score;
}

fn evaluatePositionCore(
    cells: []Cell,
    row: u8,
    col: u8,
    color: Cell,
    options: EvalOptions,
) i32 {
    const opponent_color = color.opposite();
    const idx = @as(u16, row) * BOARD_SIZE + col;

    // 攻撃スコア
    const attack = computeAttackScore(cells, row, col, color);
    const attack_score = attack.score;

    // 四三ボーナス
    var four_three_bonus: i32 = 0;
    if (attack.has_four and attack.has_valid_open_three) {
        four_three_bonus = scores.FOUR_THREE_BONUS;
    }

    // 必須防御ルール
    if (options.enable_mandatory_defense) {
        var threat: threats_mod.ThreatInfo = undefined;
        var used_precomputed = false;

        if (options.has_precomputed_threats) {
            if (options.precomputed_threats) |t| {
                threat = t;
                used_precomputed = true;
            }
        }

        if (!used_precomputed) {
            // Undo → detectOpponentThreats → Redo
            cells[idx] = .empty;
            threat = threats_mod.detectOpponentThreats(cells, opponent_color);
            cells[idx] = color;
        }

        const has_my_open_four = attack_score >= scores.OPEN_FOUR;
        const can_win_first = has_my_open_four or four_three_bonus > 0;

        // 相手の活四を止めない手は除外
        if (threat.open_fours.len > 0 and !has_my_open_four) {
            if (!threat.open_fours.contains(row, col)) return -1000000;
        }

        // 相手の止め四を止めない手は除外
        if (threat.fours.len > 0 and threat.open_fours.len == 0 and !has_my_open_four) {
            if (!threat.fours.contains(row, col)) return -1000000;
        }

        // 相手の活三を止めない手は除外
        if (threat.open_threes.len > 0 and threat.open_fours.len == 0 and threat.fours.len == 0 and !can_win_first) {
            if (!threat.open_threes.contains(row, col)) return -1000000;

            // 活三を止めつつミセ手も止める必要がある
            if (options.enable_mise_threat and threat.mises.len > 0) {
                if (!threat.mises.contains(row, col) and
                    threats_mod.hasDefenseThatBlocksBoth(&threat.open_threes, &threat.mises))
                {
                    return -1000000;
                }
            }
        }

        // 三三脅威を止めない手は除外
        if (options.enable_double_three_threat and threat.double_threes.len == 1 and
            threat.open_fours.len == 0 and threat.fours.len == 0 and
            threat.open_threes.len == 0 and !can_win_first)
        {
            if (!threat.double_threes.contains(row, col)) return -1000000;
        }

        // ミセ手を止めない手は除外
        if (options.enable_mise_threat and threat.mises.len > 0 and
            threat.open_fours.len == 0 and threat.fours.len == 0 and
            threat.open_threes.len == 0 and !can_win_first)
        {
            if (!threat.mises.contains(row, col)) return -1000000;
        }
    }

    // 白の三三・四四チ��ック
    if (color == .white and threats_mod.checkWhiteWinningPattern(cells, row, col)) {
        return scores.FIVE;
    }

    // 禁手追い込みボーナス（白番のみ）
    var forbidden_trap_bonus: i32 = 0;
    if (options.enable_forbidden_trap and color == .white) {
        forbidden_trap_bonus = evaluateForbiddenTrap(cells, row, col);
    }

    // 禁手脆弱性ペナルティ（黒番のみ）
    var forbidden_vulnerability_penalty: i32 = 0;
    if (options.enable_forbidden_vulnerability and color == .black) {
        forbidden_vulnerability_penalty = evaluateForbiddenVulnerability(cells, row, col);
    }

    // ミセ手ボーナス
    var mise_bonus: i32 = 0;
    if (options.enable_mise and four_three_bonus == 0 and attack_score < scores.OPEN_FOUR) {
        mise_bonus = computeMiseBonus(cells, row, col, color);
    }

    // 複数方向脅威ボーナス
    var multi_threat_bonus: i32 = 0;
    if (options.enable_multi_threat) {
        const threat_count = threats_mod.countThreatDirections(cells, row, col, color);
        multi_threat_bonus = threats_mod.evaluateMultiThreat(threat_count);
    }

    // 単発四ペナルティ
    var single_four_penalty: i32 = 0;
    if (options.enable_single_four_penalty) {
        if (attack.has_four and !attack.has_valid_open_three) {
            if (!hasFollowUpThreat(cells, row, col, color)) {
                const four_count = if (attack.jump_four_count > 0) attack.jump_four_count else 1;
                single_four_penalty = @divTrunc(scores.FOUR * four_count * (100 - options.single_four_penalty_multiplier), 100);
            }
        }
    }

    // 防御スコア
    cells[idx] = opponent_color;
    const opponent_attack = computeAttackScore(cells, row, col, opponent_color);

    // 防御交差点ボーナス
    var defense_multi_threat_bonus: i32 = 0;
    if (options.enable_multi_threat) {
        const def_threat_count = threats_mod.countThreatDirections(cells, row, col, opponent_color);
        if (def_threat_count >= 2) {
            defense_multi_threat_bonus = scores.DEFENSE_MULTI_THREAT_BONUS * (@as(i32, def_threat_count) - 1);
        }
    }

    // 元に戻す
    cells[idx] = color;

    // 防御スコアをパターン別倍率で計算（概算: 全体に DEFENSE_MULTIPLIERS.four を適用）
    // 正確にはパターン別の breakdown が必要だが、コアの探索では概算で十分
    var defense_score = @divTrunc(opponent_attack.score * 70, 100); // 平均 0.7 倍

    // カウンターフォー
    if (options.enable_counter_four) {
        if (attack_score >= scores.FOUR and opponent_attack.score >= scores.OPEN_THREE) {
            defense_score = @divTrunc(defense_score * 150, 100);
        }
    }

    // 中央ボーナス
    const center_bonus = getCenterBonus(row, col);

    return attack_score + defense_score + center_bonus + four_three_bonus +
        forbidden_trap_bonus + mise_bonus + multi_threat_bonus +
        defense_multi_threat_bonus - single_four_penalty - forbidden_vulnerability_penalty;
}

/// 禁手追い込み評価（白番専用）
fn evaluateForbiddenTrap(cells: []Cell, row: u8, col: u8) i32 {
    var trap_score: i32 = 0;

    for (DIRECTIONS, 0..) |dir, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, .white);

        // 四を作った場合
        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            const defense = threats_mod.getLineEnds(cells, row, col, dir.dr, dir.dc, .white);
            var all_forbidden = defense.len > 0;
            for (0..defense.len) |j| {
                const pos = defense.items[j];
                if (forbidden.checkForbiddenMove(cells, pos.row, pos.col) == .none) {
                    all_forbidden = false;
                    break;
                }
            }
            if (all_forbidden and defense.len > 0) {
                trap_score += scores.FORBIDDEN_TRAP_STRONG;
            }
        }

        // 活三を作った場合
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            const ext = threats_mod.getLineEnds(cells, row, col, dir.dr, dir.dc, .white);
            for (0..ext.len) |j| {
                const pos = ext.items[j];
                if (forbidden.checkForbiddenMove(cells, pos.row, pos.col) != .none) {
                    trap_score += scores.FORBIDDEN_TRAP_SETUP;
                }
            }

            // 達四点の禁手追い込み
            const sfp = jp.getConsecutiveThreeStraightFourPoints(cells, row, col, dir_index, .white);
            if (sfp.count == 2) {
                const fb0 = forbidden.checkForbiddenMove(cells, sfp.points[0].row, sfp.points[0].col);
                const fb1 = forbidden.checkForbiddenMove(cells, sfp.points[1].row, sfp.points[1].col);
                if ((fb0 != .none and fb1 == .none) or (fb0 == .none and fb1 != .none)) {
                    trap_score += scores.FORBIDDEN_TRAP_STRONG;
                }
            }
        }

        // 跳び三を作った場合
        if (jp.checkJumpThree(cells, row, col, dir_index, .white)) {
            const jsfp = jp.getJumpThreeStraightFourPoints(cells, row, col, dir_index, .white);
            if (jsfp.found) {
                // 片方が禁手なら追い込み
                const fb = forbidden.checkForbiddenMove(cells, jsfp.point.row, jsfp.point.col);
                if (fb != .none) {
                    trap_score += scores.FORBIDDEN_TRAP_STRONG;
                }
            }
        }
    }

    return trap_score;
}

/// 禁手脆弱性ペナルティ（黒番専用）
fn evaluateForbiddenVulnerability(cells: []Cell, row: u8, col: u8) i32 {
    var total_penalty: i32 = 0;

    for (DIRECTIONS, 0..) |dir, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, .black);

        // 連続三を検出した場合
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            const ext = threats_mod.getLineEnds(cells, row, col, dir.dr, dir.dc, .black);
            for (0..ext.len) |j| {
                const pos = ext.items[j];
                if (forbidden.checkForbiddenMove(cells, pos.row, pos.col) != .none) {
                    if (hasWhiteStoneNear(cells, pos.row, pos.col, dir.dr, dir.dc)) {
                        total_penalty += scores.FORBIDDEN_VULNERABILITY_STRONG;
                    } else {
                        total_penalty += scores.FORBIDDEN_VULNERABILITY_MILD;
                    }
                }
            }
        }

        // 跳び三
        if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, .black)) {
            const sfp = jp.getJumpThreeStraightFourPoints(cells, row, col, dir_index, .black);
            if (sfp.found) {
                const pos = sfp.point;
                if (forbidden.checkForbiddenMove(cells, pos.row, pos.col) != .none) {
                    if (hasWhiteStoneNear(cells, pos.row, pos.col, dir.dr, dir.dc)) {
                        total_penalty += scores.FORBIDDEN_VULNERABILITY_STRONG;
                    } else {
                        total_penalty += scores.FORBIDDEN_VULNERABILITY_MILD;
                    }
                }
            }
        }

        if (total_penalty >= scores.FORBIDDEN_VULNERABILITY_CAP) {
            return scores.FORBIDDEN_VULNERABILITY_CAP;
        }
    }

    return @min(total_penalty, scores.FORBIDDEN_VULNERABILITY_CAP);
}

fn hasWhiteStoneNear(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8) bool {
    var step: i16 = 1;
    while (step <= 2) : (step += 1) {
        const r = @as(i16, row) + @as(i16, dr) * step;
        const c = @as(i16, col) + @as(i16, dc) * step;
        if (!board_mod.isValid(r, c)) break;
        if (cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .white) {
            return true;
        }
    }
    return false;
}

/// ミセボーナス計算（簡易版）
fn computeMiseBonus(cells: []Cell, row: u8, col: u8, color: Cell) i32 {
    // プレフィルタ: ミセの可能性をチェック
    if (!hasPotentialMiseTarget(cells, row, col, color)) return 0;

    // ミセターゲット探索
    const target_count = countMiseTargets(cells, row, col, color);
    if (target_count >= 2) {
        return scores.DOUBLE_MISE_BONUS;
    }
    return if (target_count > 0) scores.MISE_BONUS else 0;
}

fn hasPotentialMiseTarget(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    for (DIRECTIONS) |dir| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        if (result.count >= 2 and (result.end1 == .empty or result.end2 == .empty)) {
            return true;
        }
    }
    return false;
}

/// ミセターゲット数をカウント
fn countMiseTargets(cells: []Cell, row: u8, col: u8, color: Cell) u8 {
    var count: u8 = 0;
    var seen: [225]bool = [_]bool{false} ** 225;

    for (DIRECTIONS) |dir| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        if (result.count < 2) continue;

        // 正方向端
        var r: i16 = @as(i16, row) + dir.dr;
        var c: i16 = @as(i16, col) + dir.dc;
        while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == color) {
            r += dir.dr;
            c += dir.dc;
        }
        if (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .empty) {
            const key = @as(u16, @intCast(r)) * 15 + @as(u16, @intCast(c));
            if (!seen[key]) {
                if (color == .black) {
                    if (forbidden.checkForbiddenMove(cells, @intCast(r), @intCast(c)) != .none) {
                        continue;
                    }
                }
                if (evaluate.createsFourThree(cells, @intCast(r), @intCast(c), color)) {
                    seen[key] = true;
                    count += 1;
                }
            }
        }

        // 負方向端
        r = @as(i16, row) - dir.dr;
        c = @as(i16, col) - dir.dc;
        while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == color) {
            r -= dir.dr;
            c -= dir.dc;
        }
        if (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .empty) {
            const key = @as(u16, @intCast(r)) * 15 + @as(u16, @intCast(c));
            if (!seen[key]) {
                if (color == .black) {
                    if (forbidden.checkForbiddenMove(cells, @intCast(r), @intCast(c)) != .none) {
                        continue;
                    }
                }
                if (evaluate.createsFourThree(cells, @intCast(r), @intCast(c), color)) {
                    seen[key] = true;
                    count += 1;
                }
            }
        }
    }

    return count;
}

/// 後続脅威チェック
fn hasFollowUpThreat(cells: []Cell, row: u8, col: u8, color: Cell) bool {
    const opponent_color = color.opposite();

    for (DIRECTIONS) |dir| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            const defense = threats_mod.getLineEnds(cells, row, col, dir.dr, dir.dc, color);

            for (0..defense.len) |i| {
                const def_pos = defense.items[i];
                const def_idx = @as(u16, def_pos.row) * BOARD_SIZE + def_pos.col;

                // 相手の防御を仮配置
                cells[def_idx] = opponent_color;

                // 防御後、自分が四を作れる位置があるかチェック
                const can_continue = canContinueFourAfterDefense(cells, def_pos, color);

                // 復元
                cells[def_idx] = .empty;

                if (can_continue) return true;
            }
        }
    }
    return false;
}

fn canContinueFourAfterDefense(cells: []Cell, defense_pos: Position, color: Cell) bool {
    const r: i16 = defense_pos.row;
    const c: i16 = defense_pos.col;

    var dr: i16 = -1;
    while (dr <= 1) : (dr += 1) {
        var dc: i16 = -1;
        while (dc <= 1) : (dc += 1) {
            if (dr == 0 and dc == 0) continue;
            const new_r = r + dr;
            const new_c = c + dc;

            if (!board_mod.isValid(new_r, new_c)) continue;
            const new_idx = @as(u16, @intCast(new_r)) * BOARD_SIZE + @as(u16, @intCast(new_c));
            if (cells[new_idx] != .empty) continue;

            // 仮置き
            cells[new_idx] = color;

            // 四判定（analyzeJumpPatterns の hasFour 相当）
            var has_four = false;
            for (DIRECTIONS, 0..) |d, i| {
                const res = board_mod.analyzeDirectionOnCells(cells, @intCast(new_r), @intCast(new_c), d.dr, d.dc, color);
                if (res.count == 4 and (res.end1 == .empty or res.end2 == .empty)) {
                    has_four = true;
                    break;
                }
                const di = jp.DIRECTION_INDICES[i];
                if (res.count != 4 and jp.checkJumpFour(cells, @intCast(new_r), @intCast(new_c), di, color)) {
                    has_four = true;
                    break;
                }
            }

            // 復元
            cells[new_idx] = .empty;

            if (has_four) return true;
        }
    }

    return false;
}

// === Tests ===

test "evaluatePosition: five returns FIVE" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const score = evaluatePosition(&cells, 7, 8, .black, DEFAULT_EVAL_OPTIONS);
    try std.testing.expectEqual(score, scores.FIVE);
}

test "evaluatePosition: basic scoring" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const score = evaluatePosition(&cells, 7, 8, .black, DEFAULT_EVAL_OPTIONS);
    try std.testing.expect(score > 0);
}

test "getCenterBonus" {
    const center = getCenterBonus(7, 7);
    const corner = getCenterBonus(0, 0);
    try std.testing.expect(center > corner);
    try std.testing.expectEqual(center, scores.CENTER_BONUS);
}
