/// 脅威検出
///
/// 相手の活四・止め四・活三・ミセ手・三三脅威を検出
/// TS版 threatDetection.ts + threatDetectionFast.ts に対応

const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const patterns = @import("patterns.zig");
const scores = @import("scores.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;

/// Position (row, col)
pub const Position = struct {
    row: u8,
    col: u8,
};

/// 最大防御位置数
const MAX_POSITIONS = 64;

/// 位置リスト（固定サイズ配列ベース）
pub const PositionList = struct {
    items: [MAX_POSITIONS]Position,
    len: u8,

    pub fn init() PositionList {
        return .{
            .items = undefined,
            .len = 0,
        };
    }

    pub fn push(self: *PositionList, pos: Position) void {
        if (self.len < MAX_POSITIONS) {
            self.items[self.len] = pos;
            self.len += 1;
        }
    }

    pub fn contains(self: *const PositionList, row: u8, col: u8) bool {
        for (0..self.len) |i| {
            if (self.items[i].row == row and self.items[i].col == col) {
                return true;
            }
        }
        return false;
    }

    pub fn addUnique(self: *PositionList, pos: Position) void {
        if (!self.contains(pos.row, pos.col)) {
            self.push(pos);
        }
    }

    pub fn addUniqueList(self: *PositionList, other: *const PositionList) void {
        for (0..other.len) |i| {
            self.addUnique(other.items[i]);
        }
    }
};

/// 脅威情報
pub const ThreatInfo = struct {
    open_fours: PositionList,
    fours: PositionList,
    open_threes: PositionList,
    mises: PositionList,
    double_threes: PositionList,

    pub fn init() ThreatInfo {
        return .{
            .open_fours = PositionList.init(),
            .fours = PositionList.init(),
            .open_threes = PositionList.init(),
            .mises = PositionList.init(),
            .double_threes = PositionList.init(),
        };
    }
};

/// 活四の防御位置を取得（両端の空きマス）
pub fn getOpenFourDefensePositions(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) PositionList {
    return getLineEnds(cells, row, col, dr, dc, color);
}

/// 連の両端の空き位置を取得（lineAnalysis.ts の getLineEnds 相当）
pub fn getLineEnds(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) PositionList {
    var result = PositionList.init();

    // 正方向の端を探す
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;
    while (board_mod.isValid(r, c) and cellAt(cells, r, c) == color) {
        r += dr;
        c += dc;
    }
    if (board_mod.isValid(r, c) and cellAt(cells, r, c) == .empty) {
        result.push(.{ .row = @intCast(r), .col = @intCast(c) });
    }

    // 負方向の端を探す
    r = @as(i16, row) - dr;
    c = @as(i16, col) - dc;
    while (board_mod.isValid(r, c) and cellAt(cells, r, c) == color) {
        r -= dr;
        c -= dc;
    }
    if (board_mod.isValid(r, c) and cellAt(cells, r, c) == .empty) {
        result.push(.{ .row = @intCast(r), .col = @intCast(c) });
    }

    return result;
}

fn cellAt(cells: []const Cell, r: i16, c: i16) Cell {
    return cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))];
}

/// 活三の防御位置を取得（両端の空きマス＋夏止め位置）
pub fn getOpenThreeDefensePositions(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) PositionList {
    var result = PositionList.init();

    // 正方向の端を探す
    var r: i16 = @as(i16, row) + dr;
    var c: i16 = @as(i16, col) + dc;
    while (board_mod.isValid(r, c) and cellAt(cells, r, c) == color) {
        r += dr;
        c += dc;
    }
    const end_pos_r = r;
    const end_pos_c = c;
    if (board_mod.isValid(r, c) and cellAt(cells, r, c) == .empty) {
        result.push(.{ .row = @intCast(r), .col = @intCast(c) });
    }

    // 負方向の端を探す
    r = @as(i16, row) - dr;
    c = @as(i16, col) - dc;
    while (board_mod.isValid(r, c) and cellAt(cells, r, c) == color) {
        r -= dr;
        c -= dc;
    }
    const end_neg_r = r;
    const end_neg_c = c;
    if (board_mod.isValid(r, c) and cellAt(cells, r, c) == .empty) {
        result.push(.{ .row = @intCast(r), .col = @intCast(c) });
    }

    // 夏止め位置を検出
    const beyond_pos_r = end_pos_r + dr;
    const beyond_pos_c = end_pos_c + dc;
    const beyond_neg_r = end_neg_r - dr;
    const beyond_neg_c = end_neg_c - dc;

    const beyond_pos_open = board_mod.isValid(beyond_pos_r, beyond_pos_c) and cellAt(cells, beyond_pos_r, beyond_pos_c) == .empty;
    const beyond_neg_open = board_mod.isValid(beyond_neg_r, beyond_neg_c) and cellAt(cells, beyond_neg_r, beyond_neg_c) == .empty;

    // 両方の beyond がブロック → 夏止め済み
    if (!beyond_pos_open and !beyond_neg_open) {
        return PositionList.init();
    }

    // 片側の beyond がブロックなら反対側に夏止め
    if (beyond_pos_open and !beyond_neg_open) {
        result.push(.{ .row = @intCast(beyond_pos_r), .col = @intCast(beyond_pos_c) });
    }
    if (beyond_neg_open and !beyond_pos_open) {
        result.push(.{ .row = @intCast(beyond_neg_r), .col = @intCast(beyond_neg_c) });
    }

    return result;
}

/// 跳び三の防御位置を取得（ライン走査版）
///
/// TS版 getJumpThreeDefensePositions に対応。
/// 起点 (row,col) から前後4マスのラインを構築し、
/// 6マスのスライディングウィンドウで ・●●・●・ / ・●・●●・ を検出。
pub fn getJumpThreeDefensePositions(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) PositionList {
    var result = PositionList.init();
    const r: i16 = row;
    const c: i16 = col;

    // ライン構築: 最大 4+1+4 = 9 マス
    var line_stones: [9]Cell = undefined;
    var line_rows: [9]i16 = undefined;
    var line_cols: [9]i16 = undefined;
    var line_len: u8 = 0;

    // 負方向に4マス
    var i: i16 = 4;
    while (i >= 1) : (i -= 1) {
        const pr = r - dr * i;
        const pc = c - dc * i;
        if (board_mod.isValid(pr, pc)) {
            line_rows[line_len] = pr;
            line_cols[line_len] = pc;
            line_stones[line_len] = cellAt(cells, pr, pc);
            line_len += 1;
        }
    }

    // 置いた位置
    line_rows[line_len] = r;
    line_cols[line_len] = c;
    line_stones[line_len] = color;
    line_len += 1;

    // 正方向に4マス
    i = 1;
    while (i <= 4) : (i += 1) {
        const pr = r + dr * i;
        const pc = c + dc * i;
        if (board_mod.isValid(pr, pc)) {
            line_rows[line_len] = pr;
            line_cols[line_len] = pc;
            line_stones[line_len] = cellAt(cells, pr, pc);
            line_len += 1;
        }
    }

    // 6マスウィンドウで跳び三パターンを検出
    if (line_len < 6) return result;
    var start: u8 = 0;
    while (start + 5 < line_len) : (start += 1) {
        const s0 = line_stones[start];
        const s1 = line_stones[start + 1];
        const s2 = line_stones[start + 2];
        const s3 = line_stones[start + 3];
        const s4 = line_stones[start + 4];
        const s5 = line_stones[start + 5];

        // パターン1: ・●●・●・
        if (s0 == .empty and s1 == color and s2 == color and s3 == .empty and s4 == color and s5 == .empty) {
            result.addUnique(.{ .row = @intCast(line_rows[start]), .col = @intCast(line_cols[start]) });
            result.addUnique(.{ .row = @intCast(line_rows[start + 3]), .col = @intCast(line_cols[start + 3]) });
            result.addUnique(.{ .row = @intCast(line_rows[start + 5]), .col = @intCast(line_cols[start + 5]) });
        }

        // パターン2: ・●・●●・
        if (s0 == .empty and s1 == color and s2 == .empty and s3 == color and s4 == color and s5 == .empty) {
            result.addUnique(.{ .row = @intCast(line_rows[start]), .col = @intCast(line_cols[start]) });
            result.addUnique(.{ .row = @intCast(line_rows[start + 2]), .col = @intCast(line_cols[start + 2]) });
            result.addUnique(.{ .row = @intCast(line_rows[start + 5]), .col = @intCast(line_cols[start + 5]) });
        }
    }

    return result;
}

/// 跳び三パターンを検出して防御位置を返す（旧版: 起点からの前方パターンのみ）
pub fn detectJumpThreePattern(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) PositionList {
    var result = PositionList.init();
    const r: i16 = row;
    const c: i16 = col;

    // パターン1: ・●●・●・ (起点が2石の先頭)
    const p1_before_r = r - dr;
    const p1_before_c = c - dc;
    const p1_second_r = r + dr;
    const p1_second_c = c + dc;
    const p1_gap_r = r + @as(i16, 2) * dr;
    const p1_gap_c = c + @as(i16, 2) * dc;
    const p1_third_r = r + @as(i16, 3) * dr;
    const p1_third_c = c + @as(i16, 3) * dc;
    const p1_after_r = r + @as(i16, 4) * dr;
    const p1_after_c = c + @as(i16, 4) * dc;

    if (board_mod.isValid(p1_before_r, p1_before_c) and cellAt(cells, p1_before_r, p1_before_c) == .empty and
        board_mod.isValid(p1_second_r, p1_second_c) and cellAt(cells, p1_second_r, p1_second_c) == color and
        board_mod.isValid(p1_gap_r, p1_gap_c) and cellAt(cells, p1_gap_r, p1_gap_c) == .empty and
        board_mod.isValid(p1_third_r, p1_third_c) and cellAt(cells, p1_third_r, p1_third_c) == color and
        board_mod.isValid(p1_after_r, p1_after_c) and cellAt(cells, p1_after_r, p1_after_c) == .empty)
    {
        result.push(.{ .row = @intCast(p1_gap_r), .col = @intCast(p1_gap_c) });
        result.push(.{ .row = @intCast(p1_before_r), .col = @intCast(p1_before_c) });
        result.push(.{ .row = @intCast(p1_after_r), .col = @intCast(p1_after_c) });
    }

    // パターン2: ・●・●●・ (起点が1石)
    const p2_before_r = r - dr;
    const p2_before_c = c - dc;
    const p2_gap_r = r + dr;
    const p2_gap_c = c + dc;
    const p2_second_r = r + @as(i16, 2) * dr;
    const p2_second_c = c + @as(i16, 2) * dc;
    const p2_third_r = r + @as(i16, 3) * dr;
    const p2_third_c = c + @as(i16, 3) * dc;
    const p2_after_r = r + @as(i16, 4) * dr;
    const p2_after_c = c + @as(i16, 4) * dc;

    if (board_mod.isValid(p2_before_r, p2_before_c) and cellAt(cells, p2_before_r, p2_before_c) == .empty and
        board_mod.isValid(p2_gap_r, p2_gap_c) and cellAt(cells, p2_gap_r, p2_gap_c) == .empty and
        board_mod.isValid(p2_second_r, p2_second_c) and cellAt(cells, p2_second_r, p2_second_c) == color and
        board_mod.isValid(p2_third_r, p2_third_c) and cellAt(cells, p2_third_r, p2_third_c) == color and
        board_mod.isValid(p2_after_r, p2_after_c) and cellAt(cells, p2_after_r, p2_after_c) == .empty)
    {
        result.push(.{ .row = @intCast(p2_gap_r), .col = @intCast(p2_gap_c) });
        result.push(.{ .row = @intCast(p2_before_r), .col = @intCast(p2_before_c) });
        result.push(.{ .row = @intCast(p2_after_r), .col = @intCast(p2_after_c) });
    }

    return result;
}

/// 跳び四の空き位置（ギャップ）を検出
pub fn findJumpGapPosition(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, color: Cell) ?Position {
    const r: i16 = row;
    const c: i16 = col;

    // ラインを走査（-5 ~ +5）して跳び四パターンの空きを探す
    var line_stones: [11]Cell = undefined;
    var line_rows: [11]i16 = undefined;
    var line_cols: [11]i16 = undefined;
    var line_len: u8 = 0;

    // 負方向に5マス
    var i: i16 = 5;
    while (i >= 1) : (i -= 1) {
        const pr = r - dr * i;
        const pc = c - dc * i;
        if (board_mod.isValid(pr, pc)) {
            line_rows[line_len] = pr;
            line_cols[line_len] = pc;
            line_stones[line_len] = cellAt(cells, pr, pc);
            line_len += 1;
        }
    }

    // 置いた位置
    line_rows[line_len] = r;
    line_cols[line_len] = c;
    line_stones[line_len] = color;
    line_len += 1;

    // 正方向に5マス
    i = 1;
    while (i <= 5) : (i += 1) {
        const pr = r + dr * i;
        const pc = c + dc * i;
        if (board_mod.isValid(pr, pc)) {
            line_rows[line_len] = pr;
            line_cols[line_len] = pc;
            line_stones[line_len] = cellAt(cells, pr, pc);
            line_len += 1;
        }
    }

    // 5マスのウィンドウで跳び四パターンを探す
    if (line_len < 5) return null;
    var start: u8 = 0;
    while (start + 4 < line_len) : (start += 1) {
        const s0 = line_stones[start];
        const s1 = line_stones[start + 1];
        const s2 = line_stones[start + 2];
        const s3 = line_stones[start + 3];
        const s4 = line_stones[start + 4];

        // 両端が同色でなければスキップ
        if (s0 != color or s4 != color) continue;

        // パターン1: ●●●・●
        if (s1 == color and s2 == color and s3 == .empty) {
            return .{ .row = @intCast(line_rows[start + 3]), .col = @intCast(line_cols[start + 3]) };
        }

        // パターン2: ●●・●●
        if (s1 == color and s2 == .empty and s3 == color) {
            return .{ .row = @intCast(line_rows[start + 2]), .col = @intCast(line_cols[start + 2]) };
        }

        // パターン3: ●・●●●
        if (s1 == .empty and s2 == color and s3 == color) {
            return .{ .row = @intCast(line_rows[start + 1]), .col = @intCast(line_cols[start + 1]) };
        }
    }

    return null;
}

// =========================================================================
// ビットマスクベースの近傍チェック
// =========================================================================

/// cells から行ごとの occupied ビットマスクを構築
pub fn computeOccupiedRows(cells: []const Cell) [BOARD_SIZE]u16 {
    var rows: [BOARD_SIZE]u16 = .{0} ** BOARD_SIZE;
    for (0..BOARD_SIZE) |r| {
        const base = r * BOARD_SIZE;
        for (0..BOARD_SIZE) |c| {
            if (cells[base + c] != .empty) {
                rows[r] |= @as(u16, 1) << @intCast(c);
            }
        }
    }
    return rows;
}

/// occupied_rows を距離 distance で膨張させた near マスクを返す
/// distance=1: 8近傍, distance=2: 24近傍
pub fn computeNearMask(occupied_rows: [BOARD_SIZE]u16, comptime distance: u8) [BOARD_SIZE]u16 {
    // 各行を横方向に膨張
    var dilated: [BOARD_SIZE]u16 = undefined;
    for (0..BOARD_SIZE) |r| {
        dilated[r] = dilateRow(occupied_rows[r], distance);
    }
    // 縦方向に膨張（distance行分のORを取る）
    var result: [BOARD_SIZE]u16 = .{0} ** BOARD_SIZE;
    for (0..BOARD_SIZE) |r| {
        const r_i: i16 = @intCast(r);
        const dist_i16: i16 = distance;
        var dr: i16 = -dist_i16;
        while (dr <= dist_i16) : (dr += 1) {
            const nr = r_i + dr;
            if (nr >= 0 and nr < BOARD_SIZE) {
                result[r] |= dilated[@intCast(nr)];
            }
        }
    }
    // occupied 自体のビットを除外（空きマスのみ対象のため不要だが、明示的に残さない）
    // → 呼び出し側で cells[idx] != .empty チェック済みなので不要
    return result;
}

/// 1行を横方向に distance ビット膨張
fn dilateRow(bits: u16, comptime distance: u8) u16 {
    var result: u16 = bits;
    inline for (1..distance + 1) |d| {
        result |= bits << d;
        result |= bits >> d;
    }
    // 15ビット幅にマスク（16ビット目以上をクリア）
    return result & 0x7FFF;
}

/// near マスクから特定位置が近傍かチェック（O(1)）
pub inline fn isNearFromMask(near_mask: [BOARD_SIZE]u16, row: u8, col: u8) bool {
    return near_mask[row] & (@as(u16, 1) << @intCast(col)) != 0;
}

/// 石の近くかチェック（距離2以内）
/// 注意: 全盤面スキャン時は computeOccupiedRows + computeNearMask を使うこと
pub fn isNearExistingStone(cells: []const Cell, row: u8, col: u8) bool {
    const occupied = computeOccupiedRows(cells);
    const near = computeNearMask(occupied, 2);
    return isNearFromMask(near, row, col);
}

/// 活三とミセ手の両方を止める手が存在するかチェック
pub fn hasDefenseThatBlocksBoth(open_threes: *const PositionList, mises: *const PositionList) bool {
    for (0..open_threes.len) |i| {
        const pos = open_threes.items[i];
        if (mises.contains(pos.row, pos.col)) {
            return true;
        }
    }
    return false;
}

/// 複数方向に脅威（活三以上）がある数をカウント
pub fn countThreatDirections(cells: []Cell, row: u8, col: u8, color: Cell) u8 {
    var threat_count: u8 = 0;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);

        // 活四 or 止め四
        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            threat_count += 1;
            continue;
        }

        // 跳び四をチェック
        const dir_index = jp.DIRECTION_INDICES[i];
        if (result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, color)) {
            threat_count += 1;
            continue;
        }

        // 活三
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty) {
            if (color == .white or patterns.isValidConsecutiveThree(cells, row, col, dir_index, color)) {
                threat_count += 1;
                continue;
            }
        }

        // 跳び三
        if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color)) {
            if (color == .white or patterns.isValidJumpThree(cells, row, col, dir_index, color)) {
                threat_count += 1;
            }
        }
    }

    return threat_count;
}

/// 複数方向脅威ボーナスを計算
pub fn evaluateMultiThreat(threat_count: u8) i32 {
    return if (threat_count >= 2)
        scores.MULTI_THREAT_BONUS * (@as(i32, threat_count) - 1)
    else
        0;
}

/// 相手の脅威を検出
pub fn detectOpponentThreats(cells: []Cell, opponent_color: Cell) ThreatInfo {
    var result = ThreatInfo.init();

    // 相手の石を全て走査
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            if (cells[@as(u16, row) * BOARD_SIZE + col] != opponent_color) continue;

            // 各方向をチェック
            for (DIRECTIONS, 0..) |dir, dir_idx| {
                const renju_dir_index = jp.DIRECTION_INDICES[dir_idx];
                const pattern = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, opponent_color);

                // 活四: 両端が空いている4連
                if (pattern.count == 4 and pattern.end1 == .empty and pattern.end2 == .empty) {
                    const defense = getOpenFourDefensePositions(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.open_fours.addUniqueList(&defense);
                }

                // 止め四: 片側だけ空いている4連
                if (pattern.count == 4 and
                    ((pattern.end1 == .empty and pattern.end2 != .empty) or
                    (pattern.end1 != .empty and pattern.end2 == .empty)))
                {
                    const defense = getOpenFourDefensePositions(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.fours.addUniqueList(&defense);
                }

                // 跳び四
                var is_jump_four = false;
                if (pattern.count != 4 and jp.checkJumpFour(cells, row, col, renju_dir_index, opponent_color)) {
                    is_jump_four = true;
                    if (findJumpGapPosition(cells, row, col, dir.dr, dir.dc, opponent_color)) |gap_pos| {
                        result.fours.addUnique(gap_pos);
                    }
                }

                // 活三: 両端が空いている3連（跳び四の一部でない）
                if (!is_jump_four and pattern.count == 3 and pattern.end1 == .empty and pattern.end2 == .empty) {
                    const defense = getOpenThreeDefensePositions(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.open_threes.addUniqueList(&defense);
                }

                // 跳び三
                if (pattern.count < 3) {
                    const defense = detectJumpThreePattern(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.open_threes.addUniqueList(&defense);
                }
            }
        }
    }

    // ミセ手・三三脅威を検出
    const near_mask_d2 = computeNearMask(computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            const idx = @as(u16, row) * BOARD_SIZE + col;
            if (cells[idx] != .empty) continue;
            if (!isNearFromMask(near_mask_d2, row, col)) continue;

            // ミセ手チェック
            if (evaluate.createsFourThree(cells, row, col, opponent_color)) {
                result.mises.push(.{ .row = row, .col = col });
            }

            // 三三脅威チェック（白のみ: 黒は三三が禁手）
            if (opponent_color == .white and createsDoubleThree(cells, row, col, opponent_color)) {
                result.double_threes.push(.{ .row = row, .col = col });
            }
        }
    }

    return result;
}

/// 三三チェック（活三2つ以上）
pub fn createsDoubleThree(cells: []Cell, row: u8, col: u8, color: Cell) bool {
    const idx = @as(u16, row) * BOARD_SIZE + col;
    cells[idx] = color;
    defer cells[idx] = .empty;

    var open_three_count: u8 = 0;

    for (DIRECTIONS, 0..) |_, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, color);

        // 活三カウント
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty and
            patterns.isValidConsecutiveThree(cells, row, col, dir_index, color))
        {
            open_three_count += 1;
        } else if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, color) and
            patterns.isValidJumpThree(cells, row, col, dir_index, color))
        {
            open_three_count += 1;
        }

        if (open_three_count >= 2) return true;
    }

    return false;
}

/// 白の三三・四四パターンをチェック
pub fn checkWhiteWinningPattern(cells: []Cell, row: u8, col: u8) bool {
    var open_three_count: u8 = 0;
    var four_count: u8 = 0;

    for (DIRECTIONS, 0..) |dir, i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const result = board_mod.analyzeDirectionOnCells(cells, row, col, dir.dr, dir.dc, .white);

        // 活三カウント
        if (result.count == 3 and result.end1 == .empty and result.end2 == .empty and
            patterns.isValidConsecutiveThree(cells, row, col, dir_index, .white))
        {
            open_three_count += 1;
        }

        // 四カウント
        if (result.count == 4 and (result.end1 == .empty or result.end2 == .empty)) {
            four_count += 1;
        }

        // 跳び三
        if (result.count != 3 and jp.checkJumpThree(cells, row, col, dir_index, .white) and
            patterns.isValidJumpThree(cells, row, col, dir_index, .white))
        {
            open_three_count += 1;
        }

        // 跳び四
        if (result.count != 4 and jp.checkJumpFour(cells, row, col, dir_index, .white)) {
            four_count += 1;
        }
    }

    return open_three_count >= 2 or four_count >= 2;
}

// === Tests ===

test "detectOpponentThreats: 活四検出" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の4連: (7,4),(7,5),(7,6),(7,7) 両端空き
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;

    const result = detectOpponentThreats(&cells, .white);
    try std.testing.expect(result.open_fours.len > 0);
}

test "isNearExistingStone" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    try std.testing.expect(isNearExistingStone(&cells, 7, 8));
    try std.testing.expect(isNearExistingStone(&cells, 7, 9));
    try std.testing.expect(isNearExistingStone(&cells, 5, 5));
    try std.testing.expect(!isNearExistingStone(&cells, 4, 4));
}

test "computeNearMask distance 2: exhaustive check against naive" {
    // 複数石を配置して、全空きマスについてビットマスク版とナイーブ版の結果が一致することを確認
    // 注意: 占有マスは near mask に含まれるが、呼び出し側で cells[idx] != .empty チェック済みのため問題ない
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[3 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[0 * BOARD_SIZE + 0] = .black; // 隅
    cells[14 * BOARD_SIZE + 14] = .white; // 隅
    cells[0 * BOARD_SIZE + 14] = .black; // 隅
    cells[10 * BOARD_SIZE + 5] = .white;

    const near_mask = computeNearMask(computeOccupiedRows(&cells), 2);

    for (0..BOARD_SIZE) |r| {
        for (0..BOARD_SIZE) |c| {
            const row: u8 = @intCast(r);
            const col: u8 = @intCast(c);
            if (cells[r * BOARD_SIZE + c] != .empty) continue; // 占有マスはスキップ
            const bitmask_result = isNearFromMask(near_mask, row, col);
            const naive_result = isNearExistingStoneNaive(&cells, row, col, 2);
            try std.testing.expectEqual(naive_result, bitmask_result);
        }
    }
}

test "computeNearMask distance 1: exhaustive check against naive" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[3 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[0 * BOARD_SIZE + 0] = .black;
    cells[14 * BOARD_SIZE + 14] = .white;
    cells[0 * BOARD_SIZE + 14] = .black;
    cells[10 * BOARD_SIZE + 5] = .white;

    const near_mask = computeNearMask(computeOccupiedRows(&cells), 1);

    for (0..BOARD_SIZE) |r| {
        for (0..BOARD_SIZE) |c| {
            const row: u8 = @intCast(r);
            const col: u8 = @intCast(c);
            if (cells[r * BOARD_SIZE + c] != .empty) continue;
            const bitmask_result = isNearFromMask(near_mask, row, col);
            const naive_result = isNearExistingStoneNaive(&cells, row, col, 1);
            try std.testing.expectEqual(naive_result, bitmask_result);
        }
    }
}

/// テスト用: ナイーブな近傍チェック（旧実装と同等）
fn isNearExistingStoneNaive(cells: []const Cell, row: u8, col: u8, comptime distance: i16) bool {
    const r: i16 = row;
    const c_val: i16 = col;
    var dr: i16 = -distance;
    while (dr <= distance) : (dr += 1) {
        var dc: i16 = -distance;
        while (dc <= distance) : (dc += 1) {
            if (dr == 0 and dc == 0) continue;
            const nr = r + dr;
            const nc = c_val + dc;
            if (board_mod.isValid(nr, nc)) {
                if (cells[@intCast(@as(u16, @intCast(nr)) * BOARD_SIZE + @as(u16, @intCast(nc)))] != .empty) {
                    return true;
                }
            }
        }
    }
    return false;
}

test "findJumpGapPosition: ●●●・●" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の跳び四: (7,4),(7,5),(7,6),空,(7,8)
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 8] = .white;

    // (7,4)から見て横方向(0,1)の跳び四ギャップ = (7,7)
    const gap = findJumpGapPosition(&cells, 7, 4, 0, 1, .white);
    try std.testing.expect(gap != null);
    const g = gap.?;
    try std.testing.expectEqual(@as(u8, 7), g.row);
    try std.testing.expectEqual(@as(u8, 7), g.col);
}

test "findJumpGapPosition: ●・●●●" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の跳び四: (7,4),空,(7,6),(7,7),(7,8)
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 8] = .white;

    const gap = findJumpGapPosition(&cells, 7, 4, 0, 1, .white);
    try std.testing.expect(gap != null);
    const g = gap.?;
    try std.testing.expectEqual(@as(u8, 7), g.row);
    try std.testing.expectEqual(@as(u8, 5), g.col);
}

test "findJumpGapPosition: ●●・●●" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の跳び四: (7,4),(7,5),空,(7,7),(7,8)
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 8] = .white;

    const gap = findJumpGapPosition(&cells, 7, 4, 0, 1, .white);
    try std.testing.expect(gap != null);
    const g = gap.?;
    try std.testing.expectEqual(@as(u8, 7), g.row);
    try std.testing.expectEqual(@as(u8, 6), g.col);
}

test "countThreatDirections basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活三: (7,5),(7,6),(7,7) 横方向
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    const count = countThreatDirections(&cells, 7, 7, .white);
    try std.testing.expect(count >= 1);
}
