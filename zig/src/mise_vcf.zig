/// Mise-VCF探索
///
/// ミセ手（四三を狙う手）→ 相手の強制応手（四三点を防御）→ VCF勝ちの
/// 手順を探索する。通常のVCF探索では検出できない勝ち筋を発見する。
///
/// TS版 miseVcf.ts に対応

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const ll = @import("line_lookup.zig");
const patterns = @import("patterns.zig");
const quiescence = @import("quiescence.zig");
const threats = @import("threats.zig");
const vcf = @import("vcf.zig");
const vct = @import("vct.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;
const Position = threats.Position;

/// VCF探索の最大深度（Mise-VCF内部のVCF用）
const MISE_VCF_DEPTH: u8 = 12;

/// VCF探索のノード制限（時間ベース制御の代替）
const MISE_VCF_NODES: u32 = 5000;

/// ノリ手VCFのノード制限
const NORI_TE_VCF_NODES: u32 = 3000;

/// ミセターゲットリスト（固定サイズ）
const MAX_MISE_TARGETS = 16;

const MiseTargetList = struct {
    items: [MAX_MISE_TARGETS]Position = undefined,
    len: u8 = 0,

    fn push(self: *MiseTargetList, pos: Position) void {
        if (self.len < MAX_MISE_TARGETS) {
            self.items[self.len] = pos;
            self.len += 1;
        }
    }
};

// =============================================================================
// findMiseTargetsLite（TS版 miseTactics.ts に対応）
// =============================================================================

/// ミセターゲット（四三点）を軽量検出
///
/// ライン延長点のみをスキャンする高速版。各方向で2石以上の連続がある場合のみ
/// 端点を createsFourThree で検証する。
fn findMiseTargetsLite(cells: []Cell, row: u8, col: u8, color: Cell) MiseTargetList {
    var result = MiseTargetList{};
    var seen: [CELL_COUNT]bool = [_]bool{false} ** CELL_COUNT;

    for (DIRECTIONS, 0..) |dir, di| {
        const analysis = ll.queryPatternByCell(row, col, di, color);
        if (analysis.count < 2) continue; // 2石未満 → 四三不可能

        // 正方向端
        var r: i16 = @as(i16, row) + dir.dr;
        var c: i16 = @as(i16, col) + dir.dc;
        while (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == color) {
            r += dir.dr;
            c += dir.dc;
        }
        if (board_mod.isValid(r, c) and cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))] == .empty) {
            const key = @as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c));
            if (!seen[key]) {
                // 黒の禁手チェック
                if (color == .black) {
                    const fr = forbidden.checkForbiddenMove(cells, @intCast(r), @intCast(c));
                    if (fr != .none) {
                        // continue to negative direction
                    } else if (evaluate.createsFourThree(cells, @intCast(r), @intCast(c), color)) {
                        seen[key] = true;
                        result.push(.{ .row = @intCast(r), .col = @intCast(c) });
                    }
                } else if (evaluate.createsFourThree(cells, @intCast(r), @intCast(c), color)) {
                    seen[key] = true;
                    result.push(.{ .row = @intCast(r), .col = @intCast(c) });
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
            const key = @as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c));
            if (!seen[key]) {
                if (color == .black) {
                    const fr = forbidden.checkForbiddenMove(cells, @intCast(r), @intCast(c));
                    if (fr != .none) {
                        continue;
                    }
                }
                if (evaluate.createsFourThree(cells, @intCast(r), @intCast(c), color)) {
                    seen[key] = true;
                    result.push(.{ .row = @intCast(r), .col = @intCast(c) });
                }
            }
        }
    }

    return result;
}

// =============================================================================
// getCreatedOpenThreeDefenses（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 石を置いた際に作られた活三/飛び三の防御位置を返す
///
/// Mise-VCFのノリ手検証で使用。ミセ手は必ず三に含まれるため、
/// 4方向チェックで十分（全盤面スキャン不要）。
fn getCreatedOpenThreeDefenses(cells: []Cell, row: u8, col: u8, color: Cell) threats.PositionList {
    var defenses = threats.PositionList.init();

    for (DIRECTIONS, 0..) |dir, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const analysis = ll.queryPatternByCell(row, col, i, color);

        // 連続活三（跳び四の一部は除外、黒の場合はウソの三を除外）
        if (analysis.count == 3 and analysis.end1 == 0 and analysis.end2 == 0 and
            !analysis.has_jump_four and
            (color != .black or patterns.isValidConsecutiveThree(cells, row, col, dir_index, color)))
        {
            const open_three_defenses = threats.getOpenThreeDefensePositions(cells, row, col, dir.dr, dir.dc, color);
            for (0..open_three_defenses.len) |j| {
                const pos = open_three_defenses.items[j];
                // 空きマスのみ追加（重複除去は contains で）
                if (cells[@as(u16, pos.row) * BOARD_SIZE + pos.col] == .empty) {
                    if (!defenses.contains(pos.row, pos.col)) {
                        defenses.push(pos);
                    }
                }
            }
        }

        // 飛び三（黒の場合はウソの三を除外）
        if (analysis.count != 3 and analysis.has_jump_three and
            (color != .black or patterns.isValidJumpThree(cells, row, col, dir_index, color)))
        {
            const jump_defenses = threats.getJumpThreeDefensePositions(cells, row, col, dir.dr, dir.dc, color);
            for (0..jump_defenses.len) |j| {
                const pos = jump_defenses.items[j];
                if (cells[@as(u16, pos.row) * BOARD_SIZE + pos.col] == .empty) {
                    if (!defenses.contains(pos.row, pos.col)) {
                        defenses.push(pos);
                    }
                }
            }
        }
    }

    return defenses;
}

// =============================================================================
// isInvalidatedByNoriTe（TS版 miseVcf.ts に対応）
// =============================================================================

/// ノリ手チェック結果
const NoriTeResult = enum {
    valid, // 全防御位置でVCF成立 → 有効
    invalidated, // VCF不成立 → ノリ手で無効化
};

/// ノリ手チェック: 三防御位置ごとにVCFが成立するか検証
///
/// ミセ手が活三/飛び三を作った場合、相手は四三点ではなく三を止める可能性がある。
/// 全ての三防御位置でVCFが成立しなければ、Mise-VCFは無効（ノリ手で破綻）。
fn isInvalidatedByNoriTe(
    cells: []Cell,
    color: Cell,
    three_defenses: *const threats.PositionList,
) NoriTeResult {
    const opponent = color.opposite();

    for (0..three_defenses.len) |i| {
        const defense = three_defenses.items[i];
        const def_idx = @as(u16, defense.row) * BOARD_SIZE + defense.col;

        cells[def_idx] = opponent;
        bitboard.placeStone(defense.row, defense.col, opponent);

        var limiter = vcf.TimeLimiter{
            .start_time = 0,
            .time_limit = 0,
            .nodes = 0,
            .max_nodes = NORI_TE_VCF_NODES,
        };
        const vcf_ok = vcf.hasVCF(cells, color, 0, &limiter, MISE_VCF_DEPTH);

        cells[def_idx] = .empty;
        bitboard.removeStone(defense.row, defense.col);

        if (!vcf_ok) {
            return .invalidated; // VCF不成立 → ノリ手で無効化
        }
    }

    return .valid; // 全防御位置でVCF成立 → 有効
}

// =============================================================================
// findMiseVCFMove（TS版 miseVcf.ts に対応）
// =============================================================================

/// Mise-VCF勝ち手を探索
///
/// アルゴリズム:
/// 1. 相手に活三・ミセ手がある場合はスキップ
/// 2. 既存石の近傍の候補手を列挙
/// 3. 各候補手Mについて:
///    a. Mを配置（in-place）
///    b. プリフィルタ: ミセターゲットが存在しうるか
///    c. 四を作るミセ手はスキップ
///    d. findMiseTargetsLiteでミセターゲットTを検出
///    e. 強制性チェック: ミセ手が三を作らないなら却下
///    f. ノリ手チェック: 三防御位置でVCFが成立するか
///    g. 各TにOpponent石を配置（防御）
///    h. hasVCFでVCF判定
///    i. VCF成立 → MがMise-VCF勝ち手
///    j. 全てundo
pub fn findMiseVCFMove(cells: []Cell, color: Cell) ?Position {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    const opponent = color.opposite();

    // 相手に活三がある場合、ミセ手の強制応手の前提が崩れるためスキップ
    if (vct.hasOpenThree(cells, opponent)) {
        return null;
    }

    // 相手にミセ手（四三が作れる手）がある場合、ミセの強制応手の前提が崩れるためスキップ
    if (vct.hasFourThreeAvailable(cells, opponent)) {
        return null;
    }

    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // 黒番の禁手チェック
            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, r, c);
                if (fr != .none) continue;
            }

            // 候補手Mを配置（in-place、bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);

            // プリフィルタ: ミセターゲットが存在しうるか安価にチェック
            if (!hasPotentialMiseTarget(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // 四を作るミセ手はスキップ（通常VCFで検出済み）
            if (quiescence.createsFour(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // ミセターゲットを検出
            const mise_targets = findMiseTargetsLite(cells, r, c, color);
            if (mise_targets.len == 0) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // 強制性チェック: ミセ手が三を作らない場合は非強制 → 却下
            const three_defenses = getCreatedOpenThreeDefenses(cells, r, c, color);
            if (three_defenses.len == 0) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // ノリ手チェック
            const nori_result = isInvalidatedByNoriTe(cells, color, &three_defenses);
            if (nori_result == .invalidated) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // 各ミセターゲットについてVCF探索
            var found = false;
            for (0..mise_targets.len) |t_idx| {
                const target = mise_targets.items[t_idx];
                const target_idx = @as(u16, target.row) * BOARD_SIZE + target.col;

                // 相手の強制応手（四三点を防御）
                cells[target_idx] = opponent;
                bitboard.placeStone(target.row, target.col, opponent);

                // VCF探索
                var limiter = vcf.TimeLimiter{
                    .start_time = 0,
                    .time_limit = 0,
                    .nodes = 0,
                    .max_nodes = MISE_VCF_NODES,
                };
                const vcf_ok = vcf.hasVCF(cells, color, 0, &limiter, MISE_VCF_DEPTH);

                cells[target_idx] = .empty;
                bitboard.removeStone(target.row, target.col);

                if (vcf_ok) {
                    found = true;
                    break;
                }
            }

            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (found) {
                return .{ .row = r, .col = c };
            }
        }
    }

    return null;
}

// =============================================================================
// findMiseVCFSequence（TS版 miseVcf.ts の findMiseVCFSequence に対応）
// =============================================================================

/// 分岐の最大数（活三/飛び三の防御候補は方向×端数で最大8個程度）
pub const MAX_MISE_VCF_BRANCHES = 8;

/// 分岐内の継続手数上限（[D, VCF...]）
pub const MAX_MISE_VCF_BRANCH_LEN = 32;

/// Mise-VCF手順の分岐情報
pub const MiseVCFBranch = struct {
    /// メインPV内の代替対象インデックス（防御手の位置、常に 1）
    defense_index: u8,
    /// 代替防御手（メインPVのTとは異なる三防御位置）
    defense_move: Position,
    /// この防御後のVCF継続手順
    continuation: [MAX_MISE_VCF_BRANCH_LEN]Position,
    continuation_len: u8,
};

/// Mise-VCF手順の結果
pub const MiseVCFSequenceResult = struct {
    /// [ミセ手, 防御手, VCF手順...]
    sequence: [64]Position,
    len: u8,
    is_forbidden_trap: bool,
    found: bool,
    /// 代替防御の分岐情報（collect_branches=true 時のみ）
    branches: [MAX_MISE_VCF_BRANCHES]MiseVCFBranch,
    branch_count: u8,
};

/// Mise-VCF手順を探索
///
/// findMiseVCFMoveと同じロジックだが、VCF成立時にfindVCFSequenceで手順を取得して返す。
/// sequence = [ミセ手, 防御手(相手がミセを受ける手), VCF手順...] の形で返す。
///
/// collect_branches=true の場合、メインのT以外の三防御位置についても VCF 手順を
/// 収集し branches に格納する（レビュー表示用の代替防御）。
pub fn findMiseVCFSequence(
    cells: []Cell,
    color: Cell,
    time_limit_ms: u32,
    max_nodes: u32,
    collect_branches: bool,
) MiseVCFSequenceResult {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var result = MiseVCFSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
        .branches = undefined,
        .branch_count = 0,
    };

    const opponent = color.opposite();

    // 相手に活三がある場合、ミセ手の強制応手の前提が崩れるためスキップ
    if (vct.hasOpenThree(cells, opponent)) {
        return result;
    }

    // 相手にミセ手（四三が作れる手）がある場合、ミセの強制応手の前提が崩れるためスキップ
    if (vct.hasFourThreeAvailable(cells, opponent)) {
        return result;
    }

    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // 黒番の禁手チェック
            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, r, c);
                if (fr != .none) continue;
            }

            // 候補手Mを配置（in-place、bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);

            // プリフィルタ: ミセターゲットが存在しうるか安価にチェック
            if (!hasPotentialMiseTarget(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // 四を作るミセ手はスキップ（通常VCFで検出済み）
            if (quiescence.createsFour(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // ミセターゲットを検出
            const mise_targets = findMiseTargetsLite(cells, r, c, color);
            if (mise_targets.len == 0) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // 強制性チェック: ミセ手が三を作らない場合は非強制 → 却下
            const three_defenses = getCreatedOpenThreeDefenses(cells, r, c, color);
            if (three_defenses.len == 0) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // ノリ手チェック
            const nori_result = isInvalidatedByNoriTe(cells, color, &three_defenses);
            if (nori_result == .invalidated) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                continue;
            }

            // 各ミセターゲットについてVCF Sequence探索
            for (0..mise_targets.len) |t_idx| {
                const target = mise_targets.items[t_idx];
                const target_idx = @as(u16, target.row) * BOARD_SIZE + target.col;

                // 相手の強制応手（四三点を防御）
                cells[target_idx] = opponent;
                bitboard.placeStone(target.row, target.col, opponent);

                // VCF Sequence探索
                const vcf_result = vcf.findVCFSequence(cells, color, MISE_VCF_DEPTH, time_limit_ms, max_nodes);

                cells[target_idx] = .empty;
                bitboard.removeStone(target.row, target.col);

                if (vcf_result.found) {
                    // 手順を組み立て: [ミセ手, 防御手, VCF手順...]
                    result.sequence[0] = .{ .row = r, .col = c };
                    result.sequence[1] = target;
                    var i: u8 = 0;
                    while (i < vcf_result.len) : (i += 1) {
                        result.sequence[2 + i] = vcf_result.sequence[i];
                    }
                    result.len = 2 + vcf_result.len;
                    result.is_forbidden_trap = vcf_result.is_forbidden_trap;
                    result.found = true;

                    // 分岐収集: 三防御位置（メインのT以外）のVCF手順を記録
                    if (collect_branches) {
                        collectMiseVCFBranches(
                            cells,
                            color,
                            target,
                            &three_defenses,
                            time_limit_ms,
                            max_nodes,
                            &result,
                        );
                    }

                    cells[idx] = .empty;
                    bitboard.removeStone(r, c);
                    return result;
                }
            }

            cells[idx] = .empty;
            bitboard.removeStone(r, c);
        }
    }

    return result;
}

/// 三防御位置（メインのT以外）の VCF 手順を branches に格納する
///
/// 前提: ノリ手チェックを通過しているので各三防御位置で VCF は成立している。
/// findVCFSequence で実際の手順を取得して [D, VCF...] を branches.continuation に格納する。
fn collectMiseVCFBranches(
    cells: []Cell,
    color: Cell,
    main_target: Position,
    three_defenses: *const threats.PositionList,
    time_limit_ms: u32,
    max_nodes: u32,
    result: *MiseVCFSequenceResult,
) void {
    const opponent = color.opposite();

    for (0..three_defenses.len) |i| {
        const defense = three_defenses.items[i];
        // メインPVの T と一致する三防御は分岐対象外
        if (defense.row == main_target.row and defense.col == main_target.col) continue;

        if (result.branch_count >= MAX_MISE_VCF_BRANCHES) break;

        const def_idx = @as(u16, defense.row) * BOARD_SIZE + defense.col;
        cells[def_idx] = opponent;
        bitboard.placeStone(defense.row, defense.col, opponent);

        const vcf_result = vcf.findVCFSequence(cells, color, MISE_VCF_DEPTH, time_limit_ms, max_nodes);

        cells[def_idx] = .empty;
        bitboard.removeStone(defense.row, defense.col);

        if (!vcf_result.found) continue;

        // [D, VCF...] を continuation に格納
        var branch = MiseVCFBranch{
            .defense_index = 1,
            .defense_move = defense,
            .continuation = undefined,
            .continuation_len = 0,
        };
        branch.continuation[0] = defense;
        branch.continuation_len = 1;
        var j: u8 = 0;
        while (j < vcf_result.len and branch.continuation_len < MAX_MISE_VCF_BRANCH_LEN) : (j += 1) {
            branch.continuation[branch.continuation_len] = vcf_result.sequence[j];
            branch.continuation_len += 1;
        }
        result.branches[result.branch_count] = branch;
        result.branch_count += 1;
    }
}

/// hasPotentialMiseTarget: ミセの可能性をチェック（position_eval.zig と同一ロジック）
fn hasPotentialMiseTarget(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    _ = cells;
    for (0..4) |i| {
        const result = ll.queryPatternByCell(row, col, i, color);
        if (result.count >= 2 and (result.end1 == 0 or result.end2 == 0)) {
            return true;
        }
    }
    return false;
}

// =============================================================================
// Tests
// =============================================================================

const testing = std.testing;

test "findMiseVCFMove: 12手目局面でG7がMise-VCF手として検出される" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10
    // H8: row=7, col=7, black
    cells[7 * BOARD_SIZE + 7] = .black;
    // I9: row=6, col=8, white
    cells[6 * BOARD_SIZE + 8] = .white;
    // I7: row=8, col=8, black
    cells[8 * BOARD_SIZE + 8] = .black;
    // G9: row=6, col=6, white
    cells[6 * BOARD_SIZE + 6] = .white;
    // J8: row=7, col=9, black
    cells[7 * BOARD_SIZE + 9] = .black;
    // H10: row=5, col=7, white
    cells[5 * BOARD_SIZE + 7] = .white;
    // H6: row=9, col=7, black
    cells[9 * BOARD_SIZE + 7] = .black;
    // K9: row=6, col=10, white
    cells[6 * BOARD_SIZE + 10] = .white;
    // H7: row=8, col=7, black
    cells[8 * BOARD_SIZE + 7] = .black;
    // H9: row=6, col=7, white
    cells[6 * BOARD_SIZE + 7] = .white;
    // J9: row=6, col=9, black
    cells[6 * BOARD_SIZE + 9] = .black;
    // I10: row=5, col=8, white
    cells[5 * BOARD_SIZE + 8] = .white;

    const move = findMiseVCFMove(&cells, .black);
    try testing.expect(move != null);
    // G7: row=8, col=6
    try testing.expectEqual(move.?.row, 8);
    try testing.expectEqual(move.?.col, 6);
}

test "findMiseVCFMove: 初期局面ではnull" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 I9
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;

    const move = findMiseVCFMove(&cells, .black);
    try testing.expect(move == null);
}

test "findMiseVCFMove: 空盤面ではnull" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const move = findMiseVCFMove(&cells, .black);
    try testing.expect(move == null);
}

test "findMiseVCFMove: 相手に活三がある場合スキップ" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 G7 I8 H7 I7 G8 I5 I6 J5 J6 K6 J7 J8 G6
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[8 * BOARD_SIZE + 6] = .white; // G7
    cells[7 * BOARD_SIZE + 8] = .black; // I8
    cells[8 * BOARD_SIZE + 7] = .white; // H7
    cells[8 * BOARD_SIZE + 8] = .black; // I7
    cells[7 * BOARD_SIZE + 6] = .white; // G8
    cells[10 * BOARD_SIZE + 8] = .black; // I5
    cells[9 * BOARD_SIZE + 8] = .white; // I6
    cells[10 * BOARD_SIZE + 9] = .black; // J5
    cells[9 * BOARD_SIZE + 9] = .white; // J6
    cells[9 * BOARD_SIZE + 10] = .black; // K6
    cells[8 * BOARD_SIZE + 9] = .white; // J7
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[9 * BOARD_SIZE + 6] = .white; // G6

    const result = findMiseVCFMove(&cells, .black);
    try testing.expect(result == null);
}

test "hasPotentialMiseTarget: basic" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black; // 実際の使用時と同様、石を配置済み
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    // 石が配置済みの状態で可能性あり
    try testing.expect(hasPotentialMiseTarget(&cells, 7, 5, .black));
}

test "findMiseVCFSequence: 12手目局面でG7がMise-VCF手順として検出される" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 8] = .black; // I7
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[5 * BOARD_SIZE + 7] = .white; // H10
    cells[9 * BOARD_SIZE + 7] = .black; // H6
    cells[6 * BOARD_SIZE + 10] = .white; // K9
    cells[8 * BOARD_SIZE + 7] = .black; // H7
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[6 * BOARD_SIZE + 9] = .black; // J9
    cells[5 * BOARD_SIZE + 8] = .white; // I10

    const result = findMiseVCFSequence(&cells, .black, 0, 5000, false);
    try testing.expect(result.found);
    // 最初の手はG7: row=8, col=6
    try testing.expectEqual(result.sequence[0].row, 8);
    try testing.expectEqual(result.sequence[0].col, 6);
    // 手順長は最低3手（ミセ手 + 防御手 + VCF手順1手以上）
    try testing.expect(result.len >= 3);
    // collect_branches=false なので branches は空
    try testing.expectEqual(@as(u8, 0), result.branch_count);
}

test "findMiseVCFSequence: 初期局面では不成立" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;

    const result = findMiseVCFSequence(&cells, .black, 0, 5000, false);
    try testing.expect(!result.found);
}

test "findMiseVCFSequence: 空盤面では不成立" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const result = findMiseVCFSequence(&cells, .black, 0, 5000, false);
    try testing.expect(!result.found);
}

test "findMiseVCFSequence: collect_branches=true で三防御の代替分岐が収集される (issue #18)" {
    // 棋譜 (43手目まで):
    // H8 H9 I9 I8 G7 F6 G10 G9 F9 H11 H7 F7 F10 G8 I10 H10 K11 J10 F8 K9 I11 I13
    // H6 E9 F11 F12 I5 J4 G5 H5 I7 J8 J6 J7 K7 L8 F4 E3 G3 H4 I6 K6 L5
    // 44手目（白番）の最善手 G6 がMise-VCFで、I4以外の三防御分岐があるはず
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Black stones (odd moves)
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 8] = .black; // I9
    cells[8 * BOARD_SIZE + 6] = .black; // G7
    cells[5 * BOARD_SIZE + 6] = .black; // G10
    cells[6 * BOARD_SIZE + 5] = .black; // F9
    cells[8 * BOARD_SIZE + 7] = .black; // H7
    cells[5 * BOARD_SIZE + 5] = .black; // F10
    cells[5 * BOARD_SIZE + 8] = .black; // I10
    cells[4 * BOARD_SIZE + 10] = .black; // K11
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    cells[4 * BOARD_SIZE + 8] = .black; // I11
    cells[9 * BOARD_SIZE + 7] = .black; // H6
    cells[4 * BOARD_SIZE + 5] = .black; // F11
    cells[10 * BOARD_SIZE + 8] = .black; // I5
    cells[10 * BOARD_SIZE + 6] = .black; // G5
    cells[8 * BOARD_SIZE + 8] = .black; // I7
    cells[9 * BOARD_SIZE + 9] = .black; // J6
    cells[8 * BOARD_SIZE + 10] = .black; // K7
    cells[11 * BOARD_SIZE + 5] = .black; // F4
    cells[12 * BOARD_SIZE + 6] = .black; // G3
    cells[9 * BOARD_SIZE + 8] = .black; // I6
    cells[10 * BOARD_SIZE + 11] = .black; // L5
    // White stones (even moves)
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[7 * BOARD_SIZE + 8] = .white; // I8
    cells[9 * BOARD_SIZE + 5] = .white; // F6
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[4 * BOARD_SIZE + 7] = .white; // H11
    cells[8 * BOARD_SIZE + 5] = .white; // F7
    cells[7 * BOARD_SIZE + 6] = .white; // G8
    cells[5 * BOARD_SIZE + 7] = .white; // H10
    cells[5 * BOARD_SIZE + 9] = .white; // J10
    cells[6 * BOARD_SIZE + 10] = .white; // K9
    cells[2 * BOARD_SIZE + 8] = .white; // I13
    cells[6 * BOARD_SIZE + 4] = .white; // E9
    cells[3 * BOARD_SIZE + 5] = .white; // F12
    cells[11 * BOARD_SIZE + 9] = .white; // J4
    cells[10 * BOARD_SIZE + 7] = .white; // H5
    cells[7 * BOARD_SIZE + 9] = .white; // J8
    cells[8 * BOARD_SIZE + 9] = .white; // J7
    cells[7 * BOARD_SIZE + 11] = .white; // L8
    cells[12 * BOARD_SIZE + 4] = .white; // E3
    cells[11 * BOARD_SIZE + 7] = .white; // H4
    cells[9 * BOARD_SIZE + 10] = .white; // K6

    const result = findMiseVCFSequence(&cells, .white, 0, 50_000, true);
    try testing.expect(result.found);
    // 最初の手はG6（白のミセ手）: col=6, row=15-6=9
    try testing.expectEqual(@as(u8, 9), result.sequence[0].row);
    try testing.expectEqual(@as(u8, 6), result.sequence[0].col);
    // メイン防御は I4（黒の四三防御）: col=8, row=11
    try testing.expectEqual(@as(u8, 11), result.sequence[1].row);
    try testing.expectEqual(@as(u8, 8), result.sequence[1].col);
    // 三防御の代替分岐が少なくとも1つ収集されている
    try testing.expect(result.branch_count >= 1);
    // 代替分岐の防御手は I4 以外
    for (0..result.branch_count) |i| {
        const branch = result.branches[i];
        const is_i4 = branch.defense_move.row == 11 and branch.defense_move.col == 8;
        try testing.expect(!is_i4);
        // 各分岐は防御手 + VCF手順 (>=2手)
        try testing.expect(branch.continuation_len >= 2);
        try testing.expectEqual(@as(u8, 1), branch.defense_index);
    }
}

test "findMiseVCFSequence: collect_branches=false なら branches が空" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 12手目局面（既存テストと同じ）
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 8] = .black; // I7
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[5 * BOARD_SIZE + 7] = .white; // H10
    cells[9 * BOARD_SIZE + 7] = .black; // H6
    cells[6 * BOARD_SIZE + 10] = .white; // K9
    cells[8 * BOARD_SIZE + 7] = .black; // H7
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[6 * BOARD_SIZE + 9] = .black; // J9
    cells[5 * BOARD_SIZE + 8] = .white; // I10

    const result = findMiseVCFSequence(&cells, .black, 0, 5000, false);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 0), result.branch_count);
}

test "findMiseVCFMove: ノリ手で無効なH7をMise-VCF手として返さない" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 I9 G7 I7 G8 I6 I8 J8 G9 G10 F8 E8 H10 I11
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 6] = .black; // G7
    cells[8 * BOARD_SIZE + 8] = .white; // I7
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[9 * BOARD_SIZE + 8] = .white; // I6
    cells[7 * BOARD_SIZE + 8] = .black; // I8
    cells[7 * BOARD_SIZE + 9] = .white; // J8
    cells[6 * BOARD_SIZE + 6] = .black; // G9
    cells[5 * BOARD_SIZE + 6] = .white; // G10
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    cells[7 * BOARD_SIZE + 4] = .white; // E8
    cells[5 * BOARD_SIZE + 7] = .black; // H10
    cells[4 * BOARD_SIZE + 8] = .white; // I11

    const move = findMiseVCFMove(&cells, .black);
    // H7(row=8, col=7)がMise-VCF手として返されないこと
    if (move) |m| {
        const is_h7 = m.row == 8 and m.col == 7;
        try testing.expect(!is_h7);
    }
}
