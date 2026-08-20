/// VCT（Victory by Continuous Threats）探索
///
/// 四と活三を含む脅威手を連続して打つことで勝利する手順を探索する。
/// VCFより広い脅威（活三を含む）を扱う。
/// TS版 vct.ts + vctHelpers.ts + threatMoves.ts + threatPatterns.ts に対応

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const ft = @import("forced_win_tree.zig");
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
        const result = ll.queryPatternByCell(row, col, i, color);

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
        // 夏止め済み（両外側ブロックで活四にできない三）は脅威でないため除外。
        // 受け点の基準（getOpenThreeDefensePositions: 空リスト=夏止め済み）と揃え、
        // 「受けが要る三＝本物の脅威」で意味を一致させる（SSoT）。
        if (!has_open_three and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const open_three_def = threats.getOpenThreeDefensePositions(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, color);
            has_open_three = open_three_def.len > 0;
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
    _ = cells;
    for (0..4) |i| {
        const result = ll.queryPatternByCell(row, col, i, color);

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
                const result = ll.queryPatternByCell(row, col, i, color);

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

            // 先に四三判定 → 成立した点だけ禁手確認（意味論は同値、黒での全空点
            // checkForbiddenMove を避けて 16〜22µs → 数µs に短縮）
            if (!evaluate.createsFourThree(cells, row, col, color)) continue;

            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, row, col);
                if (fr != .none) continue;
            }

            return true;
        }
    }
    return false;
}

// =============================================================================
// opponentBlocksThreePursuit
// =============================================================================

/// 相手が「三の追いを許さない脅威」（活三 or 1手四三＝ミセ手）を持つか
///
/// これが真なら、攻撃側の次の一手は四/五でなければならない。三で追っても
/// 相手は受けずに活四・四三を先行させられるため、手順が崩壊する。
/// 安いほうの hasOpenThree を先に評価して短絡する。
pub fn opponentBlocksThreePursuit(cells: []Cell, opponent: Cell) bool {
    return hasOpenThree(cells, opponent) or hasFourThreeAvailable(cells, opponent);
}

// =============================================================================
// findThreatMoves（TS版 vctHelpers.ts に対応）
// =============================================================================

/// findThreatMovesCounted の結果（四の本数と総数）
pub const ThreatMoveCounts = struct {
    /// 列挙された脅威手の総数
    total: u16,
    /// うち四を作る手の本数。buf の先頭 four_count 個が四、残りが活三。
    four_count: u16,
};

/// 脅威（四・活三）を作れる位置を列挙（四を優先）
pub fn findThreatMoves(cells: []Cell, color: Cell, buf: *[225]Position) u16 {
    return findThreatMovesCounted(cells, color, buf).total;
}

/// findThreatMoves の四/活三の内訳付き版
///
/// buf は「四 → 活三」の順に詰められる。四の本数を返すことで、呼び出し側は
/// 「三の攻め手に入る直前」を検出できる（opponentBlocksThreePursuit の遅延評価用）。
pub fn findThreatMovesCounted(cells: []Cell, color: Cell, buf: *[225]Position) ThreatMoveCounts {
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

            // インプレースで仮配置（bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);

            // 五連が作れる場合は最優先
            if (forbidden.checkFive(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                buf[four_count] = .{ .row = r, .col = c };
                four_count += 1;
                continue;
            }

            // 四と活三を1パスで判定
            const threat = classifyThreat(cells, r, c, color);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

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

    return .{ .total = four_count + three_count, .four_count = four_count };
}

// =============================================================================
// getThreatDefensePositions（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 脅威に対する防御位置を取得
pub fn getThreatDefensePositions(cells: []const Cell, row: u8, col: u8, color: Cell) PositionList {
    var defense_positions = PositionList.init();

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

        // 跳び四をチェック（黒はオーバーライン補正）
        // ギャップを埋めると長連になる跳び四は五にできない＝四ではないので、
        // 受けをギャップ 1 点に絞ってはならない。分類側（classifyThreat /
        // checkDefenseCounterThreat）と同基準に揃える（SSoT）。
        var has_jump_four = false;
        if (result.count != 4 and result.has_jump_four and
            !isJumpFourOverline(cells, row, col, dir.dr, dir.dc, color))
        {
            has_jump_four = true;
            if (threats.findJumpGapPosition(cells, row, col, dir.dr, dir.dc, color)) |gap| {
                defense_positions.addUnique(gap);
            }
        }

        // 活三をチェック（同方向に跳び四がある場合は不要：跳び四の防御が優先）
        // 両端＋夏止め位置を返す getOpenThreeDefensePositions を使用（getLineEnds は両端のみで不足）
        if (!has_jump_four and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const open_three_def = threats.getOpenThreeDefensePositions(cells, row, col, dir.dr, dir.dc, color);
            for (0..open_three_def.len) |j| {
                defense_positions.addUnique(open_three_def.items[j]);
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
        const result = ll.queryPatternByCell(row, col, i, opponent_color);

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
        // 夏止め済み（両外側ブロックで活四にできない三）は本物のカウンター脅威でないため除外。
        // 受け点の基準（getOpenThreeDefensePositions: 空リスト=夏止め済み）と揃える（classifyThreat と同基準）。
        if (!has_three and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const open_three_def = threats.getOpenThreeDefensePositions(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, opponent_color);
            has_three = open_three_def.len > 0;
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
// カウンターフォー耐性検証（TS版 vctValidation.ts に対応）
//
// VCT手順を見つけても、相手は防御位置ではなくカウンターフォー（任意の四を作る手）
// で応じる可能性がある。我々の活三を打った後で相手にカウンターフォーがあると、
// 速度負けで手順が崩壊する（活三＝5を作るのに2手 vs カウンターフォー＝5を作るのに1手）。
//
// この検証は findVCTSequence の事後処理として実行する。
// =============================================================================

/// 白に三三または四四の勝ち手があるかスキャン（CF+ブロック後の脅威判定用）
fn hasDoubleThreeForWhite(cells: []Cell) bool {
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            cells[idx] = .white;
            bitboard.placeStone(r, c, .white);
            const winning = threats.checkWhiteWinningPattern(cells, r, c);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (winning) return true;
        }
    }
    return false;
}

/// CF+ブロック配置下で残りの手順の防御 ct 値が破壊的に変化するか検査
///
/// TS版 checkSequenceBreaksByCF を拡張: 防御配置後に相手が活三/ミセ手を持つ場合、
/// 次の攻撃手が四/五でなければ手順が崩壊する。
/// （カウンターフォーで相手に間接的に活三/ミセ手が生まれるケースを検出する）
fn checkSequenceBreaksByCF(
    cells: []Cell,
    color: Cell,
    sequence: []const Position,
    start_index: usize,
) bool {
    const opponent = color.opposite();

    var placed_buf: [64]Position = undefined;
    var placed_len: usize = 0;

    var breaks = false;
    var i: usize = start_index;
    while (i < sequence.len) : (i += 1) {
        const pos = sequence[i];
        const idx = @as(u16, pos.row) * BOARD_SIZE + pos.col;

        // CF/ブロックが占有済みの位置はスキップ（lenient方向）
        if (cells[idx] != .empty) continue;

        const is_defense = (i % 2) == 1;
        const stone_color: Cell = if (is_defense) opponent else color;

        cells[idx] = stone_color;
        bitboard.placeStone(pos.row, pos.col, stone_color);
        placed_buf[placed_len] = pos;
        placed_len += 1;

        if (is_defense) {
            const ct = checkDefenseCounterThreat(cells, pos.row, pos.col, opponent);
            if (ct == .win) {
                breaks = true;
                break;
            }
            if (ct == .four) {
                const four_block_pos = quiescence.getFourDefensePosition(cells, pos.row, pos.col, opponent);
                if (four_block_pos == null) {
                    breaks = true;
                    break;
                }
                const fbp = four_block_pos.?;
                const next_idx = i + 1;
                if (next_idx >= sequence.len) {
                    breaks = true;
                    break;
                }
                const next_pos = sequence[next_idx];
                if (next_pos.row != fbp.row or next_pos.col != fbp.col) {
                    breaks = true;
                    break;
                }
                continue;
            }

            // 相手の活三/ミセ手チェック: 次の攻撃手が四/五でなければ手順崩壊
            if (opponentBlocksThreePursuit(cells, opponent)) {
                const next_idx = i + 1;
                if (next_idx >= sequence.len) {
                    breaks = true;
                    break;
                }
                const next_pos = sequence[next_idx];
                const n_idx = @as(u16, next_pos.row) * BOARD_SIZE + next_pos.col;
                if (cells[n_idx] != .empty) {
                    // CF/ブロックと衝突 → 手順崩壊
                    breaks = true;
                    break;
                }
                cells[n_idx] = color;
                bitboard.placeStone(next_pos.row, next_pos.col, color);
                const makes_five = forbidden.checkFive(cells, next_pos.row, next_pos.col, color);
                const makes_four = quiescence.createsFour(cells, next_pos.row, next_pos.col, color);
                cells[n_idx] = .empty;
                bitboard.removeStone(next_pos.row, next_pos.col);
                if (!makes_five and !makes_four) {
                    breaks = true;
                    break;
                }
            }
        }
    }

    // 盤面を元に戻す
    var j: usize = placed_len;
    while (j > 0) {
        j -= 1;
        const p = placed_buf[j];
        const idx = @as(u16, p.row) * BOARD_SIZE + p.col;
        cells[idx] = .empty;
        bitboard.removeStone(p.row, p.col);
    }

    return breaks;
}

/// カウンターフォー耐性検証の厳格度。
/// - lenient: main 既定。攻めの追い詰め探索で使用（真正VCTを取りこぼさない）。
/// - strict: 防御側の被詰み判定で使用。相手の四(Tier1)がノリ手で先手を奪い
///   ブロック自体が四以上の先手にならない場合も手順崩壊として棄却する。
///   攻守両用パスに strict を流すと真正VCTまで棄却され弱体化するため、
///   minimax の防御ノード(!is_maximizing)経由でのみ strict を渡すこと。
pub const ResilienceMode = enum { lenient, strict };

/// 攻撃手（活三のみ）の段階で、相手のカウンターフォーが残り手順を破壊するか検査
///
/// TS版 hasBreakingCounterFour を移植・拡張。
/// CF を仮置きしてその場での五連完成 / 防御不可（活四）/ ブロック後の即時勝ち手段（VCF/4-3）/
/// ブロック後の手順崩壊を順に判定。
fn hasBreakingCounterFour(
    cells: []Cell,
    color: Cell,
    sequence: []const Position,
    attack_index: usize,
    mode: ResilienceMode,
) bool {
    const opponent = color.opposite();

    var four_buf: [225]Position = undefined;
    const four_count = vcf_mod.findFourMoves(cells, opponent, &four_buf);

    for (0..four_count) |i| {
        const cf = four_buf[i];
        const cf_idx = @as(u16, cf.row) * BOARD_SIZE + cf.col;

        cells[cf_idx] = opponent;
        bitboard.placeStone(cf.row, cf.col, opponent);

        // CF が五連を作るならその場で勝ち（手順崩壊）
        if (forbidden.checkFive(cells, cf.row, cf.col, opponent)) {
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            return true;
        }

        // ブロック位置取得（null = 活四 → 防御不可）
        const block_pos_opt = quiescence.getFourDefensePosition(cells, cf.row, cf.col, opponent);
        if (block_pos_opt == null) {
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            return true;
        }
        const bp = block_pos_opt.?;
        const bp_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;

        cells[bp_idx] = color;
        bitboard.placeStone(bp.row, bp.col, color);

        // ノリ手Tierゲート（strict時のみ・連珠テンポ理論）:
        // この攻撃手は三(Tier2)のみ（呼び出し元 isResilientToCounterFours が
        // 四/五の攻撃手を除外済み）。相手の四(Tier1)はノリ手で先手を奪い、
        // 攻撃側は四をブロックさせられる。そのブロック自体が四以上の先手
        // （= 再逆転のノリ手）でなければテンポは相手に渡り手順は崩壊する。
        // 攻めの探索(lenient)ではこのゲートで真正VCTまで棄却され弱体化するため、
        // 防御側の被詰み判定(strict)でのみ発火させる。
        if (mode == .strict) {
            const block_makes_five = forbidden.checkFive(cells, bp.row, bp.col, color);
            const block_makes_four = quiescence.createsFour(cells, bp.row, bp.col, color);
            if (!block_makes_five and !block_makes_four) {
                cells[bp_idx] = .empty;
                bitboard.removeStone(bp.row, bp.col);
                cells[cf_idx] = .empty;
                bitboard.removeStone(cf.row, cf.col);
                return true;
            }
        }

        // CF+ブロック後に相手が即時勝ち手段を持つか（4-3/活四/VCF/白の三三）
        // 元手順は相手が "受け身の防御" を打つ前提だが、CF後に強力な攻撃が生まれるなら
        // 相手は防御せずその攻撃を選ぶ → 元手順は崩壊
        const opp_has_threat = blk: {
            if (hasFourThreeAvailable(cells, opponent)) break :blk true;
            // 白相手の場合、三三・四四も即勝ち
            if (opponent == .white and hasDoubleThreeForWhite(cells)) break :blk true;
            var probe_limiter = TimeLimiter{
                .start_time = 0,
                .time_limit = 0,
                .nodes = 0,
                .max_nodes = 3000,
            };
            if (vcf_mod.hasVCF(cells, opponent, 0, &probe_limiter, vcf_mod.VCF_MAX_DEPTH)) break :blk true;
            break :blk false;
        };
        if (opp_has_threat) {
            cells[bp_idx] = .empty;
            bitboard.removeStone(bp.row, bp.col);
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            return true;
        }

        const breaks = checkSequenceBreaksByCF(cells, color, sequence, attack_index + 1);

        // Undo
        cells[bp_idx] = .empty;
        bitboard.removeStone(bp.row, bp.col);
        cells[cf_idx] = .empty;
        bitboard.removeStone(cf.row, cf.col);

        if (breaks) return true;
    }

    return false;
}

/// VCT手順がカウンターフォー耐性を持つか検証
///
/// TS版 isResilientToCounterFours を移植。
/// 各攻撃手（活三）の段階で、相手のカウンターフォーが手順を破壊しないことを確認する。
/// 四・五を作る攻撃手はチェック対象外（相手は必ず防御を強いられるため）。
pub fn isResilientToCounterFours(
    cells: []Cell,
    color: Cell,
    sequence: []const Position,
    mode: ResilienceMode,
) bool {
    const opponent = color.opposite();

    var placed_buf: [64]Position = undefined;
    var placed_len: usize = 0;

    var resilient = true;
    var i: usize = 0;
    while (i < sequence.len) : (i += 1) {
        const pos = sequence[i];
        const idx = @as(u16, pos.row) * BOARD_SIZE + pos.col;
        if (cells[idx] != .empty) {
            // sequence上のpositionが既存石と衝突するケース：lenient方向でスキップ
            continue;
        }

        const is_attack = (i % 2) == 0;
        const stone_color: Cell = if (is_attack) color else opponent;

        cells[idx] = stone_color;
        bitboard.placeStone(pos.row, pos.col, stone_color);
        placed_buf[placed_len] = pos;
        placed_len += 1;

        // 攻撃手かつ五・四でない（=活三のみ）の場合のみカウンターフォーをチェック
        if (is_attack) {
            const is_five = forbidden.checkFive(cells, pos.row, pos.col, color);
            const is_four = quiescence.createsFour(cells, pos.row, pos.col, color);
            if (!is_five and !is_four) {
                if (hasBreakingCounterFour(cells, color, sequence, i, mode)) {
                    resilient = false;
                    break;
                }
            }
        }
    }

    // 盤面を元に戻す
    var j: usize = placed_len;
    while (j > 0) {
        j -= 1;
        const p = placed_buf[j];
        const idx = @as(u16, p.row) * BOARD_SIZE + p.col;
        cells[idx] = .empty;
        bitboard.removeStone(p.row, p.col);
    }

    return resilient;
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

            // ブロック配置（bitboard も同期）
            const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
            cells[block_idx] = color;
            bitboard.placeStone(bp.row, bp.col, color);

            // ブロック石が攻撃側の脅威を作らなければVCT不成立
            const block_ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
            if (!blockHasThreat(block_ct)) {
                cells[block_idx] = .empty;
                bitboard.removeStone(bp.row, bp.col);
                return false;
            }

            // ブロックの脅威に対する防御をチェック
            const block_ok = processBlockDefenses(cells, bp, color, depth, max_depth, limiter);

            cells[block_idx] = .empty;
            bitboard.removeStone(bp.row, bp.col);
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
        bitboard.placeStone(bd_pos.row, bd_pos.col, opponent);

        const bd_ct = checkDefenseCounterThreat(cells, bd_pos.row, bd_pos.col, opponent);

        if (bd_ct == .win) {
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
            return false;
        }

        const vct_ok = evaluateCounterThreat(bd_ct, cells, color, bd_pos, depth, limiter, max_depth);

        cells[bd_idx] = .empty;
        bitboard.removeStone(bd_pos.row, bd_pos.col);

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

    var threat_buf: [225]Position = undefined;
    const threat_moves = findThreatMovesCounted(cells, color, &threat_buf);
    const threat_count = threat_moves.total;
    if (threat_count == 0) return false;

    for (0..threat_count) |i| {
        // 三の攻め手に入る直前で一度だけ判定（buf は四→活三の順）。
        // 相手が活三/ミセ手を持つなら三で追っても手順が崩壊するため、
        // 残り（すべて三）は打ち切る。四で受けを強制して相手の脅威を
        // 潰してから三で追う手順は、四を先に試すことで保存される。
        if (i == @as(usize, threat_moves.four_count) and
            opponentBlocksThreePursuit(cells, opponent)) break;

        const move = threat_buf[i];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連チェック
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            return true;
        }

        const defense_positions = getThreatDefensePositions(cells, move.row, move.col, color);

        if (defense_positions.len == 0) {
            // 防御不可 → 脅威が成立していれば勝ち
            if (isThreat(cells, move.row, move.col, color)) {
                cells[move_idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                return true;
            }
            cells[move_idx] = .empty;
            bitboard.removeStone(move.row, move.col);
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
            bitboard.placeStone(dp.row, dp.col, opponent);

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);
            const vct_ok = evaluateCounterThreat(ct, cells, color, dp, depth, limiter, max_depth);

            cells[def_idx] = .empty;
            bitboard.removeStone(dp.row, dp.col);

            if (!vct_ok) {
                all_defense_leads_to_vct = false;
                break;
            }
        }

        cells[move_idx] = .empty;
        bitboard.removeStone(move.row, move.col);

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
///
/// 内部で findVCTSequence を呼び出し、その手順の先頭手を返す。
/// findVCTSequence にはカウンターフォー耐性検証が含まれるため、
/// VCT手順が相手のカウンターフォーで崩壊するケースを除外できる。
pub fn findVCTMoveWithBudget(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32, max_nodes: u32) ?Position {
    const seq_result = findVCTSequence(cells, color, max_depth, time_limit, max_nodes, false, .lenient);
    if (seq_result.found and seq_result.len > 0) {
        return seq_result.sequence[0];
    }
    return null;
}

/// 防御側（被詰み判定）専用の VCT 探索。strict 耐性検証で相手のノリ手による
/// 手順崩壊（偽の追い詰め＝幻の被詰み）を棄却する。攻めには使わないこと。
/// findVCTSequence 内部の耐性検証を strict で一度だけ実行するため二重検証は無い。
pub fn findVCTMoveWithBudgetStrict(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32, max_nodes: u32) ?Position {
    const seq_result = findVCTSequence(cells, color, max_depth, time_limit, max_nodes, false, .strict);
    if (seq_result.found and seq_result.len > 0) {
        return seq_result.sequence[0];
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
    /// 詰み木 root node index（g_tree_arena 内）。TREE_TERMINAL = 木なし。
    /// collect_branches 有効時のみ構築される。
    tree_root: u16 = ft.TREE_TERMINAL,
};

/// 詰み木アリーナ（review 専用・collect_branches 時のみ構築）。
/// 単一スレッド WASM 前提でグローバル保持しスタック肥大を避ける。
pub var g_tree_arena: ft.Arena = .{};

/// 再帰コンテキスト（分岐収集用）
const VCTRecursiveContext = struct {
    is_forbidden_trap: bool,
    collect_branches: bool,
    branches: [20]VCTBranch,
    branch_count: u8,
    /// この部分木の root node index（collect_branches 時のみ設定）
    out_node: u16 = ft.TREE_TERMINAL,
};

/// 防御ごとの手順エントリ
const DefenseSeqEntry = struct {
    defense: Position,
    seq: [64]Position,
    seq_len: u8,
    child_branches: [20]VCTBranch,
    child_branch_count: u8,
    is_forbidden_trap: bool,
    /// この防御後の継続ノード index（collect_branches 時のみ設定）
    child_node: u16 = ft.TREE_TERMINAL,
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
    mode: ResilienceMode,
) VCTSequenceResult {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

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

    // 詰み木アリーナを初期化（collect_branches 時のみ構築する）
    if (collect_branches) g_tree_arena.reset();

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT不成立（四追いでしか勝てない）
    if (opponentBlocksThreePursuit(cells, opponent)) return tryVCFOnly(cells, color, &limiter, &result, collect_branches);
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return tryVCFOnly(cells, color, &limiter, &result, collect_branches);

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
        // VCF は受け一意の線形手順 → 線形チェイン木
        if (collect_branches) result.tree_root = g_tree_arena.buildLinearChain(result.sequence[0..], result.len);
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
            // カウンターフォー耐性検証: 活三を打つ段階で相手のカウンターフォーが
            // 残り手順を破壊するならVCT不成立扱い → VCF-onlyにフォールバック
            //
            // 深い反復に進んでも先頭の活三は同じで再度棄却されるため早期終了する。
            if (!isResilientToCounterFours(cells, color, result.sequence[0..seq_len], mode)) {
                var fallback = VCTSequenceResult{
                    .sequence = undefined,
                    .len = 0,
                    .is_forbidden_trap = false,
                    .found = false,
                    .branches = undefined,
                    .branch_count = 0,
                };
                return tryVCFOnly(cells, color, &limiter, &fallback, collect_branches);
            }
            result.len = seq_len;
            result.is_forbidden_trap = context.is_forbidden_trap;
            result.found = true;
            result.branch_count = context.branch_count;
            var bi: u8 = 0;
            while (bi < context.branch_count) : (bi += 1) {
                result.branches[bi] = context.branches[bi];
            }
            // 再帰で構築した詰み木の root（collect_branches 時のみ）
            result.tree_root = context.out_node;
            return result;
        }
    }
    return result;
}

/// VCF-onlyフォールバック: 相手にVCT阻害要因があるとき
fn tryVCFOnly(cells: []Cell, color: Cell, limiter: *TimeLimiter, result: *VCTSequenceResult, collect_branches: bool) VCTSequenceResult {
    const vcf_seq = vcf_mod.findVCFSequence(cells, color, vcf_mod.VCF_MAX_DEPTH, limiter.time_limit, if (limiter.max_nodes > 0) limiter.max_nodes else 0);
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            result.sequence[i] = vcf_seq.sequence[i];
        }
        result.len = vcf_seq.len;
        result.is_forbidden_trap = vcf_seq.is_forbidden_trap;
        result.found = true;
        // VCF-only は線形手順 → 線形チェイン木
        if (collect_branches) result.tree_root = g_tree_arena.buildLinearChain(result.sequence[0..], result.len);
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
        // VCF は受け一意の線形手順 → 線形チェイン木
        if (context.collect_branches) context.out_node = g_tree_arena.buildLinearChain(vcf_seq.sequence[0..], vcf_seq.len);
        return true;
    }

    const opponent = color.opposite();

    var threat_buf: [225]Position = undefined;
    const threat_moves = findThreatMovesCounted(cells, color, &threat_buf);
    const threat_count = threat_moves.total;
    if (threat_count == 0) return false;

    // 最短手順の候補を保持（全脅威手を試して最短を選ぶ）
    var best_seq: [64]Position = undefined;
    var best_seq_len: u8 = 64; // 最短を見つけるため最大値で初期化
    var best_root: u16 = ft.TREE_TERMINAL;
    var best_context = VCTRecursiveContext{
        .is_forbidden_trap = false,
        .collect_branches = context.collect_branches,
        .branches = undefined,
        .branch_count = 0,
    };
    var has_best = false;

    for (0..threat_count) |ti| {
        // 三の攻め手に入る直前で一度だけ判定（buf は四→活三の順）。
        // 相手が活三/ミセ手を持つなら三で追っても手順が崩壊するため、
        // 残り（すべて三）は打ち切る。四で受けを強制して相手の脅威を
        // 潰してから三で追う手順は、四を先に試すことで保存される。
        // 石は未配置・アリーナも未取得の位置なので break して安全。
        if (ti == @as(usize, threat_moves.four_count) and
            opponentBlocksThreePursuit(cells, opponent)) break;

        // この脅威手の探索でアリーナへ積むノードの起点。採用されなければ巻き戻す。
        const threat_snap = g_tree_arena.snapshot();
        const move = threat_buf[ti];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連チェック — 1手で終わるので即返却（これ以上短い手順はない）
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            sequence[seq_len.*] = move;
            seq_len.* += 1;
            // 五連で終端（受けなし）
            if (context.collect_branches) context.out_node = g_tree_arena.addNode(move, 0, 0);
            return true;
        }

        const defense_positions = getThreatDefensePositions(cells, move.row, move.col, color);

        if (defense_positions.len == 0) {
            if (isThreat(cells, move.row, move.col, color)) {
                cells[move_idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                // 1手で終わるので即返却
                sequence[seq_len.*] = move;
                seq_len.* += 1;
                // 受け不能の脅威で終端
                if (context.collect_branches) context.out_node = g_tree_arena.addNode(move, 0, 0);
                return true;
            }
            cells[move_idx] = .empty;
            bitboard.removeStone(move.row, move.col);
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
            bitboard.placeStone(dp.row, dp.col, opponent);

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

            if (ct == .win) {
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);
                all_defense_leads_to_vct = false;
                break;
            }

            // ct=four: ブロック配置
            if (ct == .four) {
                const block_pos = quiescence.getFourDefensePosition(cells, dp.row, dp.col, opponent);
                if (block_pos == null) {
                    cells[def_idx] = .empty;
                    bitboard.removeStone(dp.row, dp.col);
                    all_defense_leads_to_vct = false;
                    break;
                }
                const bp = block_pos.?;
                const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
                cells[block_idx] = color;
                bitboard.placeStone(bp.row, bp.col, color);

                const block_ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
                if (!blockHasThreat(block_ct)) {
                    cells[block_idx] = .empty;
                    bitboard.removeStone(bp.row, bp.col);
                    cells[def_idx] = .empty;
                    bitboard.removeStone(dp.row, dp.col);
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
                        // ブロック四追いは受け一意の線形手順 → 線形チェイン木
                        entry.child_node = g_tree_arena.buildLinearChain(entry.seq[0..], entry.seq_len);
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
                bitboard.removeStone(bp.row, bp.col);
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);

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
                        bitboard.removeStone(dp.row, dp.col);
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
                        // 三防御後の VCF は受け一意の線形手順 → 線形チェイン木
                        entry.child_node = g_tree_arena.buildLinearChain(entry.seq[0..], entry.seq_len);
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
                        bitboard.removeStone(dp.row, dp.col);
                        all_defense_leads_to_vct = false;
                        break;
                    }
                }
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);
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
                bitboard.removeStone(dp.row, dp.col);

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
                    // ct=none: 子は再帰で構築した部分木
                    entry.child_node = sub_context.out_node;
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
                bitboard.removeStone(dp.row, dp.col);
                if (!vct_ok) {
                    all_defense_leads_to_vct = false;
                    break;
                }
            }
        }

        cells[move_idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        var kept = false;
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
            var candidate_root: u16 = ft.TREE_TERMINAL;

            if (context.collect_branches and defense_entry_count > 0) {
                const shortest_idx = selectShortestDefense(&defense_entries, defense_entry_count);
                buildBranches(&defense_entries, defense_entry_count, shortest_idx, &candidate_seq, &candidate_len, move, &candidate_context);

                // アリーナ: この攻め手ノードを構築。defenses[0] = 最短防御（前出し）。
                const def_start = g_tree_arena.defense_count;
                g_tree_arena.addDefense(defense_entries[shortest_idx].defense, defense_entries[shortest_idx].child_node);
                var ei: u8 = 0;
                while (ei < defense_entry_count) : (ei += 1) {
                    if (ei == shortest_idx) continue;
                    g_tree_arena.addDefense(defense_entries[ei].defense, defense_entries[ei].child_node);
                }
                candidate_root = g_tree_arena.addNode(move, def_start, defense_entry_count);
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
                best_root = candidate_root;
                has_best = true;
                kept = true;
            }
        }
        // 採用しなかった脅威手のアリーナノードは破棄（superseded best は dead node として残り
        // シリアライズ時の compact で除外される）
        if (context.collect_branches and !kept) {
            g_tree_arena.rollback(threat_snap);
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
        context.out_node = best_root;
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
        bitboard.placeStone(bd_pos.row, bd_pos.col, opponent);

        const bd_ct = checkDefenseCounterThreat(cells, bd_pos.row, bd_pos.col, opponent);

        if (bd_ct == .win) {
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
            return result; // found=false
        }

        if (need_sequence) {
            const sub = buildBlockDefSubSequence(bd_ct, cells, color, bd_pos, depth, max_depth, limiter);
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
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
            bitboard.removeStone(bd_pos.row, bd_pos.col);
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
            bitboard.placeStone(nb.row, nb.col, color);

            const nb_threat = checkDefenseCounterThreat(cells, nb.row, nb.col, color);
            if (!blockHasThreat(nb_threat)) {
                cells[nb_idx] = .empty;
                bitboard.removeStone(nb.row, nb.col);
                return result;
            }

            const nested = processBlockDefensesSeq(cells, nb, color, depth + 1, max_depth, limiter, true);
            cells[nb_idx] = .empty;
            bitboard.removeStone(nb.row, nb.col);
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

    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT開始手として無効
    if (opponentBlocksThreePursuit(cells, opponent)) return result;
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return result;

    // 仮配置（bitboard も同期）
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

    // 脅威かチェック
    if (!isThreat(cells, first_move.row, first_move.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(first_move.row, first_move.col);
        return result;
    }

    // 防御位置を列挙
    const defense_positions = getThreatDefensePositions(cells, first_move.row, first_move.col, color);

    if (defense_positions.len == 0) {
        cells[idx] = .empty;
        bitboard.removeStone(first_move.row, first_move.col);
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
        bitboard.placeStone(dp.row, dp.col, opponent);

        const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

        if (ct == .win) {
            cells[def_idx] = .empty;
            bitboard.removeStone(dp.row, dp.col);
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
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
                bitboard.removeStone(dp.row, dp.col);
                cells[idx] = .empty;
                bitboard.removeStone(first_move.row, first_move.col);
                return result;
            }
            const bp = block_pos.?;
            const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
            cells[block_idx] = color;
            bitboard.placeStone(bp.row, bp.col, color);

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
            bitboard.removeStone(bp.row, bp.col);
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
            const sub = findVCTSequence(cells, color, max_depth, time_limit, max_nodes, false, .lenient);
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
        bitboard.removeStone(dp.row, dp.col);

        if (!continuation_found) {
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
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
    bitboard.removeStone(first_move.row, first_move.col);

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

    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT開始手として無効
    if (opponentBlocksThreePursuit(cells, opponent)) return false;
    if (vcf_mod.hasVCF(cells, opponent, 0, &limiter, vcf_mod.VCF_MAX_DEPTH)) return false;

    // 仮配置（bitboard も同期）
    cells[idx] = color;
    bitboard.placeStone(move_pos.row, move_pos.col, color);

    // 五連チェック
    if (forbidden.checkFive(cells, move_pos.row, move_pos.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(move_pos.row, move_pos.col);
        return true;
    }

    // 脅威かチェック
    if (!isThreat(cells, move_pos.row, move_pos.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(move_pos.row, move_pos.col);
        return false;
    }

    // 防御位置を列挙
    const defense_positions = getThreatDefensePositions(cells, move_pos.row, move_pos.col, color);

    if (defense_positions.len == 0) {
        cells[idx] = .empty;
        bitboard.removeStone(move_pos.row, move_pos.col);
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
        bitboard.placeStone(dp.row, dp.col, opponent);

        const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);
        const vct_ok = evaluateCounterThreat(ct, cells, color, dp, 1, &limiter, max_depth);

        cells[def_idx] = .empty;
        bitboard.removeStone(dp.row, dp.col);

        if (!vct_ok) {
            cells[idx] = .empty;
            bitboard.removeStone(move_pos.row, move_pos.col);
            return false;
        }
    }

    cells[idx] = .empty;
    bitboard.removeStone(move_pos.row, move_pos.col);
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
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連: (7,5),(7,6),(7,7) + 仮配置 (7,8)
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み
    bitboard.initFromCells(&cells);

    const result = classifyThreat(&cells, 7, 8, .black);
    try testing.expect(result.creates_four);
}

test "classifyThreat: open three detection" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒2連 + 仮配置で3連: (7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み
    bitboard.initFromCells(&cells);

    const result = classifyThreat(&cells, 7, 8, .black);
    try testing.expect(result.creates_open_three);
}

test "hasOpenThree: basic" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活三: (7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    try testing.expect(hasOpenThree(&cells, .black));
    try testing.expect(!hasOpenThree(&cells, .white));
}

test "getThreatDefensePositions: four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,5),(7,6),(7,7),(7,8) 片端ブロック
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getThreatDefensePositions(&cells, 7, 8, .black);
    // 止め四: (7,9) の1点で防御
    try testing.expect(defense.len == 1);
    try testing.expectEqual(defense.items[0].col, 9);
}

test "getThreatDefensePositions: open four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活四: (7,5),(7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getThreatDefensePositions(&cells, 7, 8, .black);
    // 活四: 防御不可
    try testing.expectEqual(defense.len, 0);
}

test "checkDefenseCounterThreat: basic" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白が3連 → 防御の仮配置で4連に
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 8] = .white; // 防御石配置
    bitboard.initFromCells(&cells);

    const ct = checkDefenseCounterThreat(&cells, 7, 8, .white);
    try testing.expect(ct == .four);
}

test "hasVCT: immediate five via VCF" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: VCFで即勝ち
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

    const result = hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH);
    try testing.expect(result);
}

test "hasVCT: no threat" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

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
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連 → 四を作れる
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

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

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(result.found);
    try testing.expect(result.len >= 1);
}

test "findVCTSequence: no VCT" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
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

    const result = findVCTSequence(&cells, .white, VCT_MAX_DEPTH, 5000, 500000, false, .lenient);
    try testing.expect(!result.found);
}

test "getThreatDefensePositions: black four with overline should not be undefendable" {
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

    // E8を基準に脅威防御判定: G8方向はoverlineで塞がり
    // → 防御不可（空リスト）ではなく、B8を含む防御位置を返すべき
    const defense = getThreatDefensePositions(&cells, 7, 4, .black);
    try testing.expect(defense.len > 0); // 防御可能
    try testing.expectEqual(defense.items[0].row, 7);
    try testing.expectEqual(defense.items[0].col, 1); // B8
}

/// Issue #27 局面（10手目まで）をセットアップする共通ヘルパ
fn setupIssue27Position(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[7 * BOARD_SIZE + 5] = .white; // F8
    cells[5 * BOARD_SIZE + 7] = .black; // H10
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[6 * BOARD_SIZE + 8] = .black; // I9
    cells[6 * BOARD_SIZE + 5] = .white; // F9
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[4 * BOARD_SIZE + 6] = .white; // G11
}

test "findVCTMove: open three rejected when opponent has counter-four (issue #27)" {
    // 棋譜: H8 G9 G8 F8 H10 H9 I9 F9 J8 G11 (10手目まで)
    // 11手目の黒に勝ちVCTはない (J10活三は白E9のカウンターフォーで速度負けする)
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);
    bitboard.initFromCells(&cells);

    // 黒の勝ちVCTは存在しない（活三・四追いとも成立しない）
    const move = findVCTMoveWithBudget(&cells, .black, VCT_MAX_DEPTH, 0, 50000);
    try testing.expect(move == null);
}

test "findVCTSequence: rejects sequence broken by counter-four (issue #27)" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);
    bitboard.initFromCells(&cells);

    // 手順自体が見つからないこと（VCF-onlyフォールバック含めて勝ち手順なし）
    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 50000, false, .lenient);
    try testing.expect(!result.found);
}

test "isResilientToCounterFours: J10 sequence rejected by counter-four (issue #27)" {
    // 修正前にVCT探索が返していた手順 (J10で始まる活三起点)
    // 単独でカウンターフォー耐性検証関数を呼び、Resilientでないこと（false）を確認する
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);
    bitboard.initFromCells(&cells);

    // 旧VCT探索が誤って返していたシーケンス
    const seq = [_]Position{
        .{ .row = 5, .col = 9 }, // J10 (黒活三)
        .{ .row = 8, .col = 6 }, // G7 (白の "防御"想定)
        .{ .row = 4, .col = 10 }, // K11 (黒)
        .{ .row = 3, .col = 11 }, // L12 (白)
        .{ .row = 7, .col = 10 }, // K8 (黒)
        .{ .row = 7, .col = 8 }, // I8 (白)
        .{ .row = 8, .col = 10 }, // K7 (黒)
        .{ .row = 9, .col = 11 }, // L6 (白)
        .{ .row = 5, .col = 10 }, // K10 (黒)
        .{ .row = 6, .col = 10 }, // K9 (白)
        .{ .row = 5, .col = 8 }, // I10 (黒)
    };

    try testing.expect(!isResilientToCounterFours(&cells, .black, &seq, .lenient));
}

test "isResilientToCounterFours: empty sequence is trivially resilient" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    bitboard.initFromCells(&cells);

    const seq = [_]Position{};
    try testing.expect(isResilientToCounterFours(&cells, .black, &seq, .lenient));
}

test "isResilientToCounterFours: VCF (four-only) sequence is resilient" {
    // 全ての攻撃手が四ならカウンターフォー耐性チェックの対象外（trivially resilient）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    bitboard.initFromCells(&cells);

    // I8 は四+五連完成手（VCF）。攻撃手はすべて四以上なら resilient
    const seq = [_]Position{
        .{ .row = 7, .col = 8 }, // I8 (五連完成)
    };

    try testing.expect(isResilientToCounterFours(&cells, .black, &seq, .lenient));
}

test "phantom: 偽の追い詰め(VCT)を防御側strictのみ棄却・攻めlenientは検出（非対称ゲート）" {
    // 実コーパス局面（hard★4 game4 ply13 相当）。黒の追い詰めは白のカウンター四
    // （ノリ手＝先手を奪う四）でテンポを奪われ崩壊する＝偽の追い詰め。
    // Rapfi-15s では白 -269〜-413（詰まない）ため我々の被詰み判定は偽陽性。
    //
    // 非対称の核心:
    //   lenient（攻めの探索）= 従来どおり検出（真正VCTを取りこぼさないため改変しない）
    //   strict（防御の被詰み判定）= ノリ手Tierゲートで棄却（幻の被詰みを解消）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const blacks = [_][2]u8{ .{ 6, 9 }, .{ 5, 8 }, .{ 7, 10 }, .{ 7, 9 }, .{ 9, 7 }, .{ 5, 9 }, .{ 7, 7 } };
    const whites = [_][2]u8{ .{ 9, 6 }, .{ 9, 5 }, .{ 4, 7 }, .{ 9, 4 }, .{ 10, 4 }, .{ 8, 9 }, .{ 7, 8 } };
    for (blacks) |b| cells[@as(usize, b[0]) * BOARD_SIZE + b[1]] = .black;
    for (whites) |w| cells[@as(usize, w[0]) * BOARD_SIZE + w[1]] = .white;
    bitboard.initFromCells(&cells);

    // lenient（攻め）は手を返す＝攻めの探索力は不変
    try testing.expect(findVCTMoveWithBudget(&cells, .black, 4, 0, 500) != null);
    // strict（防御）は null ＝幻の被詰みを棄却
    try testing.expect(findVCTMoveWithBudgetStrict(&cells, .black, 4, 0, 500) == null);
}

test "getThreatDefensePositions: 活三の受けに夏止め位置を含む（片側ブロック）" {
    // 盤面: (7,5)(7,6)(7,7) 横並び活三（方向 dr=0,dc=+1: 正方向=col増加）
    // 負方向外側(7,3)に白石でブロック → 夏止めは正方向(7,9)側のみ
    // 受け点は: 端(7,4)、端(7,8)、夏止め(7,9) の3点
    // （旧 getLineEnds 使用時は端の2点しか返らなかった）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 3] = .white; // 負方向外側をブロック → 正方向(7,9)に夏止めが発生
    bitboard.initFromCells(&cells);

    const defense = getThreatDefensePositions(&cells, 7, 6, .black);
    // 端 (7,4) と (7,8) は必ず含む
    var has_end1 = false;
    var has_end2 = false;
    // 夏止め (7,9) を含む（負方向外側がブロックされたため正方向に夏止め）
    var has_natsudome = false;
    for (0..defense.len) |i| {
        const p = defense.items[i];
        if (p.row == 7 and p.col == 4) has_end1 = true;
        if (p.row == 7 and p.col == 8) has_end2 = true;
        if (p.row == 7 and p.col == 9) has_natsudome = true;
    }
    try testing.expect(has_end1);
    try testing.expect(has_end2);
    try testing.expect(has_natsudome);
}

test "getThreatDefensePositions: 夏止め済みの活三は緊急の受け不要" {
    // 盤面: 両外側(7,3)(7,9)に白石を置いた形（X_●●●_X）
    // 活三は活四にできないため、この方向からの受け点が追加されない
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 3] = .white; // 正方向の夏止め済み
    cells[7 * BOARD_SIZE + 9] = .white; // 負方向の夏止め済み
    bitboard.initFromCells(&cells);

    // getOpenThreeDefensePositions は空リストを返す（夏止め済み）
    // → この方向から受け点が追加されないことを確認
    // 他方向（縦・斜め）に活三がないため defense.len == 0
    const defense = getThreatDefensePositions(&cells, 7, 6, .black);
    try testing.expectEqual(@as(u8, 0), defense.len);
}

test "checkDefenseCounterThreat: 夏止め済みの三のみを作る石は .none" {
    // 盤面: X_●●●_X（白(7,3)(7,9)、黒(7,5)(7,6)(7,7)）
    // ブロック石が「夏止め済みの三」のみを作る場合、活四にできない＝本物の
    // カウンター脅威でないため .three でなく .none を返すべき。
    // .three のままだと processBlockDefenses で受け点空リスト→偽勝ちの残存経路になる。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black; // ブロック石（夏止め済み三のみを作る）
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&cells);

    const ct = checkDefenseCounterThreat(&cells, 7, 7, .black);
    try testing.expect(ct == .none);
}

test "classifyThreat: 夏止め済みの三は活三でない（脅威手に含まれない）" {
    // 盤面: X_●●●_X（白(7,3)(7,9)、黒(7,5)(7,6)(7,7)）
    // 両外側がブロックされた三は活四にできないため脅威ではない。
    // creates_open_three=true のままだと受け点が空リスト（夏止め済み）と組み合わさり
    // 「防御不能＝VCT成立」と誤断定される（偽VCT）。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black; // 黒が最後の1石を置いた形
    cells[7 * BOARD_SIZE + 3] = .white; // 負方向外側ブロック
    cells[7 * BOARD_SIZE + 9] = .white; // 正方向外側ブロック
    bitboard.initFromCells(&cells);

    const result = classifyThreat(&cells, 7, 7, .black);
    try testing.expect(!result.creates_open_three);
    try testing.expect(!result.creates_four);
}

test "hasVCT: 夏止め済みの三しか作れない局面で偽VCTが成立しない" {
    // 盤面: X_●●_._X（白(7,3)(7,9)、黒(7,5)(7,6)）
    // 黒の唯一の「三を作る手」は(7,7)だが、できる三は夏止め済み（X_●●●_X）で
    // 活四にできない＝脅威でない。受け点が空リストでも「防御不能＝勝ち」と
    // 誤断定してはならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH));
}

/// issue #116 の実戦棋譜の 17 石局面（左下原点・黒先手・白番）
///
/// "H8 H9 J10 I9 G9 I7 I8 J8 H10 K9 L10 K7 K10 I10 J9 H7 J7"
fn setupIssue116Position(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // 1. H8
    cells[6 * BOARD_SIZE + 7] = .white; // 2. H9
    cells[5 * BOARD_SIZE + 9] = .black; // 3. J10
    cells[6 * BOARD_SIZE + 8] = .white; // 4. I9
    cells[6 * BOARD_SIZE + 6] = .black; // 5. G9
    cells[8 * BOARD_SIZE + 8] = .white; // 6. I7
    cells[7 * BOARD_SIZE + 8] = .black; // 7. I8
    cells[7 * BOARD_SIZE + 9] = .white; // 8. J8
    cells[5 * BOARD_SIZE + 7] = .black; // 9. H10
    cells[6 * BOARD_SIZE + 10] = .white; // 10. K9
    cells[5 * BOARD_SIZE + 11] = .black; // 11. L10
    cells[8 * BOARD_SIZE + 10] = .white; // 12. K7
    cells[5 * BOARD_SIZE + 10] = .black; // 13. K10
    cells[5 * BOARD_SIZE + 8] = .white; // 14. I10
    cells[6 * BOARD_SIZE + 9] = .black; // 15. J9
    cells[8 * BOARD_SIZE + 7] = .white; // 16. H7
    cells[8 * BOARD_SIZE + 9] = .black; // 17. J7
}

test "hasVCT: 相手にミセ手がある局面で三の追いでは偽VCTが成立しない（issue #116）" {
    // 上記17石局面に、偽VCT手順の分岐 18.白M5 19.黒L6 20.白G8 21.黒J11 を
    // 進めた局面（白番）。この局面で黒は四三点 J12 を持つ（ミセ手）。
    // 白は四追いで勝てないため、三で追う手順は黒の四三に先行されて崩れる
    // ＝VCTは不成立でなければならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue116Position(&cells);
    cells[10 * BOARD_SIZE + 12] = .white; // 18. M5
    cells[9 * BOARD_SIZE + 11] = .black; // 19. L6
    cells[7 * BOARD_SIZE + 6] = .white; // 20. G8
    cells[4 * BOARD_SIZE + 9] = .black; // 21. J11
    bitboard.initFromCells(&cells);

    // 前提: 黒に活三はないがミセ手はある（＝活三チェックだけでは弾けない）
    try testing.expect(!hasOpenThree(&cells, .black));
    try testing.expect(hasFourThreeAvailable(&cells, .black));

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasVCT(&cells, .white, 0, &limiter, VCT_MAX_DEPTH));
}

test "findVCTSequence: 途中でミセ手を持たれる三の手順をVCTとして返さない（issue #116）" {
    // 17石局面（白番）。開始局面では黒に活三・ミセ手・VCFがないため
    // エントリのガードは通過するが、手順の途中（21.黒J11 の後）で黒がミセ手を得る。
    // 白にVCFはないので、VCTとしても成立してはならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue116Position(&cells);
    // bitboard は findVCTSequence がトップレベルエントリで initFromCells する

    const result = findVCTSequence(&cells, .white, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
}

test "hasVCT: 四で相手の活三を潰してから三で追う手順は成立する（issue #116 の意味論）" {
    // 1. の意味論（ノード単位の棄却ではなく「三の攻め手のみ不可」）の正当化。
    // 修正前（相手に活三があれば即 return false）ではこの局面は VCT なしと判定される。
    //
    // 白（攻め）: 行7に (7,4)(7,5)(7,6)。(7,3) は黒石なので夏止めの三＝活三ではない。
    //             (7,7) に打つと四（受けは (7,8) の一点）。
    //             さらに (7,7) は黒の斜め活三の伸び先でもあるので、この四で黒の活三が消える。
    // 黒（受け）: 斜めに (4,4)(5,5)(6,6) の活三（伸び先 (3,3)/(7,7)）。
    // 受けを強制したあと、白は (10,7) の三三で勝つ。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の四の種（行7）
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    // 白の三三の種: 行10 と 列7 が (10,7) で交差
    cells[10 * BOARD_SIZE + 5] = .white;
    cells[10 * BOARD_SIZE + 6] = .white;
    cells[11 * BOARD_SIZE + 7] = .white;
    cells[12 * BOARD_SIZE + 7] = .white;
    // 黒: 行7の三の片端を止める石と、斜めの活三
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[4 * BOARD_SIZE + 4] = .black;
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[6 * BOARD_SIZE + 6] = .black;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 前提: 黒は活三を持つ（＝旧実装ならこの時点で VCT 不成立と判定された）
    try testing.expect(opponentBlocksThreePursuit(&cells, .black));
    // 前提: 白に VCF はない（四追いだけでは勝てない ＝ 三の追いが必要）
    try testing.expect(!vcf_mod.hasVCF(&cells, .white, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));

    try testing.expect(hasVCT(&cells, .white, 0, &limiter, VCT_MAX_DEPTH));
}

/// issue #115 の実戦棋譜の 20 石局面（左下原点・黒先手・黒番）
///
/// 実戦 14 手 "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9" に
/// 偽 VCT 手順の先頭 "15.L7 16.M6 17.L8 18.L6 19.J7 20.M10" を進めた局面。
/// 8 行目は G8 H8 _ J8 K8 L8（黒）で、黒が I8 に打つと 6 連＝長連になるため
/// J8 は「跳び四」ではなく三でしかない。
fn setupIssue115Position(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // 1. H8
    cells[8 * BOARD_SIZE + 7] = .white; // 2. H7
    cells[7 * BOARD_SIZE + 6] = .black; // 3. G8
    cells[6 * BOARD_SIZE + 6] = .white; // 4. G9
    cells[5 * BOARD_SIZE + 8] = .black; // 5. I10
    cells[6 * BOARD_SIZE + 7] = .white; // 6. H9
    cells[6 * BOARD_SIZE + 9] = .black; // 7. J9
    cells[5 * BOARD_SIZE + 9] = .white; // 8. J10
    cells[7 * BOARD_SIZE + 10] = .black; // 9. K8
    cells[4 * BOARD_SIZE + 7] = .white; // 10. H11
    cells[6 * BOARD_SIZE + 11] = .black; // 11. L9
    cells[6 * BOARD_SIZE + 10] = .white; // 12. K9
    cells[4 * BOARD_SIZE + 8] = .black; // 13. I11
    cells[6 * BOARD_SIZE + 8] = .white; // 14. I9
    cells[8 * BOARD_SIZE + 11] = .black; // 15. L7
    cells[9 * BOARD_SIZE + 12] = .white; // 16. M6
    cells[7 * BOARD_SIZE + 11] = .black; // 17. L8
    cells[9 * BOARD_SIZE + 11] = .white; // 18. L6
    cells[8 * BOARD_SIZE + 9] = .black; // 19. J7
    cells[5 * BOARD_SIZE + 12] = .white; // 20. M10
}

test "getThreatDefensePositions: 長連にしかならない跳び四は受けを1点に絞らない（issue #115）" {
    // 20 石局面（黒番）に黒 J8 を置いた局面。
    // 8 行目: G8 H8 _ J8 K8 L8 で、ギャップ I8 は黒が打つと 6 連＝長連。
    // よって J8 は四ではなく三であり（classifyThreat と同基準）、
    // 受けを跳び四のギャップ I8 の 1 点に絞ってはならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue115Position(&cells);
    cells[7 * BOARD_SIZE + 9] = .black; // 21. J8
    bitboard.initFromCells(&cells);

    // 前提: 分類側は長連補正済みで「四ではない三」と判定している
    const classification = classifyThreat(&cells, 7, 9, .black);
    try testing.expect(!classification.creates_four);
    try testing.expect(classification.creates_open_three);

    // 受け点も同基準でなければならない: I8 の 1 点強制ではなく M8 / I8 / N8
    const defense = getThreatDefensePositions(&cells, 7, 9, .black);
    try testing.expectEqual(@as(usize, 3), defense.len);

    var has_m8 = false;
    var has_i8 = false;
    var has_n8 = false;
    for (0..defense.len) |i| {
        const p = defense.items[i];
        if (p.row == 7 and p.col == 12) has_m8 = true; // M8
        if (p.row == 7 and p.col == 8) has_i8 = true; // I8
        if (p.row == 7 and p.col == 13) has_n8 = true; // N8
    }
    try testing.expect(has_m8);
    try testing.expect(has_i8);
    try testing.expect(has_n8);
}
