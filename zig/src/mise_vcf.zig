/// Mise-VCF探索
///
/// ミセ手（四三を狙う手）→ 相手の強制応手（四三点を防御）→ VCF勝ちの
/// 手順を探索する。通常のVCF探索では検出できない勝ち筋を発見する。
///
/// TS版 miseVcf.ts に対応
const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const deadline = @import("deadline.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const ft = @import("forced_win_tree.zig");
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

        // 連続活三（本物の四の一部は除外、黒の場合はウソの三を除外）
        //
        // issue #121: 除外条件は LUT の has_jump_four ではなく盤面を見る
        // `threats.isFourInDirection`（五点の列挙）に委ねる。黒の「ギャップ埋めが長連」
        // の形は四ではないので、三の受けを握り潰してはいけない。
        // （TS 版 vctHelpers.isConsecutiveOpenThree と同じ基準）
        if (analysis.count == 3 and analysis.end1 == 0 and analysis.end2 == 0 and
            !threats.isFourInDirectionWithPattern(cells, row, col, i, color, analysis) and
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
    parent: *vcf.TimeLimiter,
) NoriTeResult {
    const opponent = color.opposite();

    for (0..three_defenses.len) |i| {
        const defense = three_defenses.items[i];
        const def_idx = @as(u16, defense.row) * BOARD_SIZE + defense.col;

        cells[def_idx] = opponent;
        bitboard.placeStone(defense.row, defense.col, opponent);

        // 親の残り壁時計予算を継承（issue #147 B。従来は time_limit=0＝壁時計無制限）
        var limiter = parent.child(0, NORI_TE_VCF_NODES);
        const vcf_ok = vcf.hasVCF(cells, color, 0, &limiter, MISE_VCF_DEPTH);
        parent.charge(limiter.nodes);

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
///
/// 親 limiter を持たない呼び出し（テスト・解析）用のエントリ。壁時計は無制限で、
/// 内部 VCF はノード数上限のみで縛られる（従来どおり）。
pub fn findMiseVCFMove(cells: []Cell, color: Cell) ?Position {
    var unlimited = vcf.TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    return findMiseVCFMoveWithParent(cells, color, &unlimited);
}

/// `findMiseVCFMove` の親 limiter 付き版（issue #147 B）
///
/// 内部の VCF 判定はすべて `parent.child(...)` で作った limiter で回るので、
/// 親（pre-search）の残り壁時計予算を超えて走らない。
pub fn findMiseVCFMoveWithParent(cells: []Cell, color: Cell, parent: *vcf.TimeLimiter) ?Position {
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

            // 親のノード予算が尽きたら打ち切る（決定的モード。設計メモ bench-fixed-nodes §2.2）。
            // 親にノード予算があるとき（`max_nodes != 0`）だけ見るので、時間モード
            // （pre-search の親は `max_nodes = 0`）では評価されず時計も読まない＝挙動不変。
            // 時間モードで親の時間が尽きた場合は各 child が exhausted になり全経路 null で同じ結果。
            if (parent.max_nodes != 0 and parent.exceeded()) return null;

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
            const nori_result = isInvalidatedByNoriTe(cells, color, &three_defenses, parent);
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
                // 親の残り壁時計予算を継承（issue #147 B。従来は time_limit=0＝壁時計無制限）
                var limiter = parent.child(0, MISE_VCF_NODES);
                const vcf_ok = vcf.hasVCF(cells, color, 0, &limiter, MISE_VCF_DEPTH);
                parent.charge(limiter.nodes);

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

/// 分岐の最大数（1ミセ手が作る三の防御点の数。活三2点×複数方向＋飛三）
pub const MAX_MISE_BRANCHES = 16;
/// 分岐continuationの最大手数（VCF手順。表示用途のため固定長で切り捨て）
pub const MISE_BRANCH_CONT = 32;

/// Mise-VCF分岐: 主筋以外の三防御手と、その後のVCF継続手順
///
/// VCTのVCTBranchと同じ役割だが、continuationがVCF手順で長くなり得るため
/// 専用に [MISE_BRANCH_CONT] を持つ（VCTBranchの [16] では不足）。
pub const MiseVCFBranch = struct {
    /// 主筋sequenceのどのindexで分岐するか（ミセ手の次=常に1）
    defense_index: u8,
    /// 代替の三防御手
    defense_move: Position,
    continuation: [MISE_BRANCH_CONT]Position,
    continuation_len: u8,
};

/// Mise-VCF手順の結果
pub const MiseVCFSequenceResult = struct {
    /// [ミセ手, 防御手, VCF手順...]
    sequence: [64]Position,
    len: u8,
    is_forbidden_trap: bool,
    found: bool,
    /// 三の代替防御の分岐（collect_branches有効時のみ）
    branches: [MAX_MISE_BRANCHES]MiseVCFBranch = undefined,
    branch_count: u8 = 0,
    /// 詰み木の root node index（collect_branches 有効時のみ構築。g_tree_arena 参照）
    tree_root: u16 = ft.TREE_TERMINAL,
};

/// 詰み木アリーナ（review 専用・collect_branches 時のみ構築）。
/// findMiseVCFSequence の結果 tree_root が指す木の格納先。main.zig が直列化に使う。
pub var g_tree_arena: ft.Arena = .{};

/// Mise-VCF手順を探索
///
/// findMiseVCFMoveと同じロジックだが、VCF成立時にfindVCFSequenceで手順を取得して返す。
/// sequence = [ミセ手, 防御手(相手がミセを受ける手), VCF手順...] の形で返す。
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

    // 振り返り経路（親 limiter なし）。ノリ手チェックの予算は従来どおり
    // ノード数上限のみ（issue #147 B で挙動を変えない）。
    var review_limiter = vcf.TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };

    var result = MiseVCFSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
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
            const nori_result = isInvalidatedByNoriTe(cells, color, &three_defenses, &review_limiter);
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

                    // 三の代替防御を分岐収集（ミセ手 M は盤上のまま）。
                    // 主筋防御 target 以外の各三防御点で VCF 手順を取得する。
                    // ノリ手チェック (isInvalidatedByNoriTe) が全 three_defense で
                    // VCF 成立を既に保証しているため found 前提だが、手順取得のため再探索する。
                    if (collect_branches) {
                        for (0..three_defenses.len) |di| {
                            const d = three_defenses.items[di];
                            // 主筋に採用済みの防御は除外
                            if (d.row == target.row and d.col == target.col) continue;
                            if (result.branch_count >= MAX_MISE_BRANCHES) break;

                            const d_idx = @as(u16, d.row) * BOARD_SIZE + d.col;
                            cells[d_idx] = opponent;
                            bitboard.placeStone(d.row, d.col, opponent);
                            const br = vcf.findVCFSequence(cells, color, MISE_VCF_DEPTH, time_limit_ms, max_nodes);
                            cells[d_idx] = .empty;
                            bitboard.removeStone(d.row, d.col);

                            if (br.found) {
                                var branch = MiseVCFBranch{
                                    .defense_index = 1,
                                    .defense_move = d,
                                    .continuation = undefined,
                                    .continuation_len = @min(br.len, MISE_BRANCH_CONT),
                                };
                                var ci: u8 = 0;
                                while (ci < branch.continuation_len) : (ci += 1) {
                                    branch.continuation[ci] = br.sequence[ci];
                                }
                                result.branches[result.branch_count] = branch;
                                result.branch_count += 1;
                            }
                        }
                    }

                    // 詰み木を構築（review 表示用）。
                    // root = ミセ手(sequence[0])、
                    // defenses[0] = 主筋防御(sequence[1]) → VCF 手順(sequence[2..]) の線形チェイン、
                    // defenses[1..] = 代替三防御(branches) → 各 VCF 継続の線形チェイン。
                    // これにより「defenses[0] 連鎖 == sequence」の不変条件が成り立つ。
                    if (collect_branches) {
                        g_tree_arena.reset();
                        // 子ノードを先に全て構築（defenses を contiguous に積むため）
                        var child_nodes: [1 + MAX_MISE_BRANCHES]u16 = undefined;
                        const main_len: u8 = if (result.len >= 2) result.len - 2 else 0;
                        child_nodes[0] = g_tree_arena.buildLinearChain(result.sequence[2..result.len], main_len);
                        var di: u8 = 0;
                        while (di < result.branch_count) : (di += 1) {
                            const br = result.branches[di];
                            child_nodes[1 + di] = g_tree_arena.buildLinearChain(
                                br.continuation[0..br.continuation_len],
                                br.continuation_len,
                            );
                        }
                        // 受け一覧（メインライン = index 0）を組んでノードを構築
                        var node_defenses: [1 + MAX_MISE_BRANCHES]ft.TreeDefense = undefined;
                        node_defenses[0] = .{ .defender = result.sequence[1], .child_node = child_nodes[0] };
                        di = 0;
                        while (di < result.branch_count) : (di += 1) {
                            node_defenses[1 + di] = .{
                                .defender = result.branches[di].defense_move,
                                .child_node = child_nodes[1 + di],
                            };
                        }
                        const total_def: usize = 1 + @as(usize, result.branch_count);
                        result.tree_root = g_tree_arena.addNodeMainFirst(result.sequence[0], node_defenses[0..total_def], 0);
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

test "findMiseVCFMove: グローバル絶対デッドライン超過で打ち切られる（#147）" {
    // ここの VCF limiter は `time_limit = 0`（壁時計無制限・ノード上限のみ）だが、
    // グローバル絶対デッドラインの網で止まることを確認する（設計メモ C）。
    // 盤面は「12手目局面でG7がMise-VCF手として検出される」と同じ。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 8] = .black;
    cells[6 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 9] = .black;
    cells[5 * BOARD_SIZE + 7] = .white;
    cells[9 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 10] = .white;
    cells[8 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .white;
    cells[6 * BOARD_SIZE + 9] = .black;
    cells[5 * BOARD_SIZE + 8] = .white;

    try testing.expect(findMiseVCFMove(&cells, .black) != null);

    deadline.test_now_ms = 5000;
    defer deadline.test_now_ms = 0;
    deadline.set(1000);
    defer deadline.clear();

    try testing.expect(findMiseVCFMove(&cells, .black) == null);
}

test "findMiseVCFMoveWithParent: 親のノード予算が尽きていれば候補ループ先頭で打ち切る（bench-fixed-nodes §2.2）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 上のテストと同じ 12 手目局面（G7 がミセ VCF 手）
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 8] = .black;
    cells[6 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 9] = .black;
    cells[5 * BOARD_SIZE + 7] = .white;
    cells[9 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 10] = .white;
    cells[8 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .white;
    cells[6 * BOARD_SIZE + 9] = .black;
    cells[5 * BOARD_SIZE + 8] = .white;

    // 親がノード予算を使い切っている → 何も探索せず null
    var spent = vcf.TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 10, .max_nodes = 10 };
    try testing.expect(findMiseVCFMoveWithParent(&cells, .black, &spent) == null);
    try testing.expectEqual(@as(u32, 10), spent.nodes);

    // 親にノード予算がない（時間モードの pre-search 親）→ 従来どおり見つかる
    var unlimited = vcf.TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    const move = findMiseVCFMoveWithParent(&cells, .black, &unlimited);
    try testing.expect(move != null);
    try testing.expectEqual(@as(u8, 8), move.?.row);
    try testing.expectEqual(@as(u8, 6), move.?.col);
    try testing.expect(unlimited.nodes > 0);

    // 親に十分なノード予算がある → 見つかり、消費が親へ計上される
    var ample = vcf.TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 1_000_000 };
    try testing.expect(findMiseVCFMoveWithParent(&cells, .black, &ample) != null);
    try testing.expectEqual(unlimited.nodes, ample.nodes);
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

test "findMiseVCFSequence: collect_branches で三の代替防御を分岐収集 (issue #18)" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const P = struct {
        fn place(c: []Cell, col_letter: u8, disp_row: u8, color: Cell) void {
            const col: u16 = col_letter - 'A';
            const irow: u16 = 15 - @as(u16, disp_row);
            c[irow * BOARD_SIZE + col] = color;
        }
    };
    const B = Cell.black;
    const W = Cell.white;
    // issue #18 の棋譜 43手目まで（黒=奇数, 白=偶数）。44手目は白番、最善 G6（ミセ手）。
    P.place(&cells, 'H', 8, B);
    P.place(&cells, 'H', 9, W);
    P.place(&cells, 'I', 9, B);
    P.place(&cells, 'I', 8, W);
    P.place(&cells, 'G', 7, B);
    P.place(&cells, 'F', 6, W);
    P.place(&cells, 'G', 10, B);
    P.place(&cells, 'G', 9, W);
    P.place(&cells, 'F', 9, B);
    P.place(&cells, 'H', 11, W);
    P.place(&cells, 'H', 7, B);
    P.place(&cells, 'F', 7, W);
    P.place(&cells, 'F', 10, B);
    P.place(&cells, 'G', 8, W);
    P.place(&cells, 'I', 10, B);
    P.place(&cells, 'H', 10, W);
    P.place(&cells, 'K', 11, B);
    P.place(&cells, 'J', 10, W);
    P.place(&cells, 'F', 8, B);
    P.place(&cells, 'K', 9, W);
    P.place(&cells, 'I', 11, B);
    P.place(&cells, 'I', 13, W);
    P.place(&cells, 'H', 6, B);
    P.place(&cells, 'E', 9, W);
    P.place(&cells, 'F', 11, B);
    P.place(&cells, 'F', 12, W);
    P.place(&cells, 'I', 5, B);
    P.place(&cells, 'J', 4, W);
    P.place(&cells, 'G', 5, B);
    P.place(&cells, 'H', 5, W);
    P.place(&cells, 'I', 7, B);
    P.place(&cells, 'J', 8, W);
    P.place(&cells, 'J', 6, B);
    P.place(&cells, 'J', 7, W);
    P.place(&cells, 'K', 7, B);
    P.place(&cells, 'L', 8, W);
    P.place(&cells, 'F', 4, B);
    P.place(&cells, 'E', 3, W);
    P.place(&cells, 'G', 3, B);
    P.place(&cells, 'H', 4, W);
    P.place(&cells, 'I', 6, B);
    P.place(&cells, 'K', 6, W);
    P.place(&cells, 'L', 5, B);
    bitboard.initFromCells(&cells);

    const result = findMiseVCFSequence(&cells, W, 0, 5000, true);
    try testing.expect(result.found);
    // 主筋防御は I4 (col='I'-'A'=8, row=15-4=11)
    try testing.expectEqual(@as(u8, 8), result.sequence[1].col);
    try testing.expectEqual(@as(u8, 11), result.sequence[1].row);
    // 三の代替防御 E8 (col='E'-'A'=4, row=15-8=7) が分岐に含まれること
    try testing.expect(result.branch_count >= 1);
    var found_e8 = false;
    for (0..result.branch_count) |i| {
        const d = result.branches[i].defense_move;
        if (d.row == 7 and d.col == 4) {
            found_e8 = true;
            // 分岐は M の次手なので defense_index は 1、continuation が存在する
            try testing.expectEqual(@as(u8, 1), result.branches[i].defense_index);
            try testing.expect(result.branches[i].continuation_len >= 1);
        }
    }
    try testing.expect(found_e8);

    // 詰み木の検証（#22）
    try testing.expect(result.tree_root != ft.TREE_TERMINAL);
    const root = g_tree_arena.nodes[result.tree_root];
    // root の攻め手 == sequence[0]（ミセ手）
    try testing.expectEqual(result.sequence[0].row, root.attacker.row);
    try testing.expectEqual(result.sequence[0].col, root.attacker.col);
    // defenses[0] == 主筋防御 sequence[1]、かつその連鎖が sequence と一致
    try testing.expect(root.defense_count >= 1);
    const d0 = g_tree_arena.defenses[root.defense_start];
    try testing.expectEqual(result.sequence[1].row, d0.defender.row);
    try testing.expectEqual(result.sequence[1].col, d0.defender.col);
    // defenses[0] 連鎖（攻め始まり交互）== sequence
    var k: u8 = 0;
    var node_idx: u16 = result.tree_root;
    while (node_idx != ft.TREE_TERMINAL and node_idx < g_tree_arena.node_count and k < result.len) {
        const node = g_tree_arena.nodes[node_idx];
        try testing.expectEqual(result.sequence[k].row, node.attacker.row);
        try testing.expectEqual(result.sequence[k].col, node.attacker.col);
        k += 1;
        if (node.defense_count == 0) break;
        const d = g_tree_arena.defenses[node.defense_start];
        try testing.expectEqual(result.sequence[k].row, d.defender.row);
        try testing.expectEqual(result.sequence[k].col, d.defender.col);
        k += 1;
        node_idx = d.child_node;
    }
    try testing.expectEqual(result.len, k);
    // E8 が root の代替防御(defenses[1..])として木に存在する
    var tree_has_e8 = false;
    var di: u16 = 1;
    while (di < root.defense_count) : (di += 1) {
        const d = g_tree_arena.defenses[root.defense_start + di];
        if (d.defender.row == 7 and d.defender.col == 4) tree_has_e8 = true;
    }
    try testing.expect(tree_has_e8);
}

test "findMiseVCFSequence: collect_branches=false では分岐を収集しない" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10（既存テストと同じ局面）
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

test "getCreatedOpenThreeDefenses: 偽跳び四の裏はウソ三なので受けを返さない（issue #121）" {
    ll.init();
    // 8 行目に黒 C8 D8 _ F8 G8 H8（col = 2,3,[4],5,6,7）。
    // LUT は跳び四と報告するが E8 埋めは 6 連＝長連で四ではなく、
    // F8 G8 H8 も達四にできないウソ三。よってどの方向にも受けは無い。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    for ([_]u8{ 2, 3, 5, 6, 7 }) |c| {
        cells[7 * BOARD_SIZE + c] = .black;
    }
    bitboard.initFromCells(&cells);

    const defenses = getCreatedOpenThreeDefenses(&cells, 7, 6, .black);
    try testing.expectEqual(@as(u8, 0), defenses.len);
}

test "getCreatedOpenThreeDefenses: 窓外の石が無ければ本物の活三の受けを返す（対比・issue #121）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    for ([_]u8{ 5, 6, 7 }) |c| {
        cells[7 * BOARD_SIZE + c] = .black;
    }
    bitboard.initFromCells(&cells);

    const defenses = getCreatedOpenThreeDefenses(&cells, 7, 6, .black);
    try testing.expect(defenses.contains(7, 4));
    try testing.expect(defenses.contains(7, 8));
}
