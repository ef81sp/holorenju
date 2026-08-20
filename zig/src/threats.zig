/// 脅威検出
///
/// 相手の活四・止め四・活三・ミセ手・三三脅威を検出
/// TS版 threatDetection.ts + threatDetectionFast.ts に対応

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const jp = @import("jump_patterns.zig");
const ll = @import("line_lookup.zig");
const patterns = @import("patterns.zig");
const scores = @import("scores.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;

/// LUT の end (0=empty, 1=blocked) を EndState に変換
fn lutEnd(end: u2) board_mod.EndState {
    return if (end == 0) .empty else .opponent;
}

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
/// ライン上の空点のうち、その方向で「埋めるとちょうど五になる」点を列挙する
///
/// 受け点（四を止める点）の SSoT。`getThreatDefensePositions`（vct.zig）と
/// `getFourDefensePosition`（quiescence.zig）の両方がこれを使う。
///
/// 「跳び四のギャップを探して返す」方式（`findJumpGapPosition`）は、5 マス窓を
/// ラインの先頭から走査して最初のギャップを返すため、同一ライン上に
/// 「埋めると長連になるギャップ」と「埋めると五になる正当なギャップ」が
/// 併存すると前者を返してしまう（issue #115）。
/// 例: 8 行目 `G8 H8 _ J8 K8 L8 _ N8`（黒）で J8 に打ったとき、
/// I8 を埋めると G8..L8 の 6 連＝長連、M8 を埋めると J8..N8 の五。本物の受けは M8。
///
/// そこでギャップを探すのではなく、ライン上（±5 マス）の空点を仮の着手点として
/// 「その方向で五になるか」を直接判定する。
///
/// - 黒: ちょうど 5（6 以上は長連なので五ではない）
/// - 白: 5 以上（白に長連の制限は無い）
///
/// 白を `>= 5` にしているのは意図的である。`forbidden.checkFive` は白でも `== 5` で
/// 判定しており、白の長連（6 連以上）を五と認めない（定義不一致・#125）。
/// 連珠ルール上は白の長連は勝ちなので、受け点の列挙ではルールに従って `>= 5` を採る。
///
/// **方向限定**である点が重要: `forbidden.checkFive` は 4 方向すべてを見るため、
/// 別ラインの五点まで拾ってしまい「この四の受け」という意味からずれる。
///
/// @return このライン上で見つかった五点の数（`out` へは addUnique で追加する）
pub fn collectLineFivePoints(
    cells: []const Cell,
    row: u8,
    col: u8,
    dr: i8,
    dc: i8,
    color: Cell,
    out: *PositionList,
) u8 {
    var found: u8 = 0;
    var i: i16 = -5;
    while (i <= 5) : (i += 1) {
        if (i == 0) continue;
        const r = @as(i16, row) + @as(i16, dr) * i;
        const c = @as(i16, col) + @as(i16, dc) * i;
        if (!board_mod.isValid(r, c)) continue;

        const gap_r: u8 = @intCast(r);
        const gap_c: u8 = @intCast(c);
        if (cells[@as(u16, gap_r) * BOARD_SIZE + gap_c] != .empty) continue;

        const pos_result = board_mod.countInDirectionOnCells(cells, gap_r, gap_c, dr, dc, color);
        const neg_result = board_mod.countInDirectionOnCells(cells, gap_r, gap_c, -dr, -dc, color);
        const total = @as(u16, pos_result.count) + neg_result.count + 1;

        const is_five = if (color == .black) total == 5 else total >= 5;
        if (!is_five) continue;

        out.addUnique(.{ .row = gap_r, .col = gap_c });
        found += 1;
    }
    return found;
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
/// 注意: 呼び出し元で bitboard.global_bb が cells と同期している必要あり
pub fn countThreatDirections(cells: []Cell, row: u8, col: u8, color: Cell) u8 {
    var threat_count: u8 = 0;

    for (0..4) |i| {
        const lut = ll.queryPatternByCell(row, col, i, color);
        const end1 = lutEnd(lut.end1);
        const end2 = lutEnd(lut.end2);
        const dir_index = jp.DIRECTION_INDICES[i];

        // 活四 or 止め四
        if (lut.count == 4 and (end1 == .empty or end2 == .empty)) {
            threat_count += 1;
            continue;
        }

        // 跳び四 (LUT版)
        if (lut.count != 4 and lut.has_jump_four) {
            threat_count += 1;
            continue;
        }

        // 活三
        if (lut.count == 3 and end1 == .empty and end2 == .empty) {
            if (color == .white or patterns.isValidConsecutiveThree(cells, row, col, dir_index, color)) {
                threat_count += 1;
                continue;
            }
        }

        // 跳び三 (LUT版)
        if (lut.count != 3 and lut.has_jump_three) {
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
/// 脅威検出コアループ（四/活四/跳び四/活三/跳び三）
/// comptime use_cells_query: true ならビットボード不要の cells 直接参照版を使用
fn detectThreatsCore(cells: []const Cell, opponent_color: Cell, comptime use_cells_query: bool) ThreatInfo {
    var result = ThreatInfo.init();

    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            if (cells[@as(u16, row) * BOARD_SIZE + col] != opponent_color) continue;

            for (DIRECTIONS, 0..) |dir, dir_idx| {
                const lut = if (use_cells_query)
                    ll.queryPatternFromCells(cells, row, col, dir_idx, opponent_color)
                else
                    ll.queryPatternByCell(row, col, dir_idx, opponent_color);
                const end1 = lutEnd(lut.end1);
                const end2 = lutEnd(lut.end2);

                // 活四: 両端が空いている4連
                if (lut.count == 4 and end1 == .empty and end2 == .empty) {
                    const defense = getOpenFourDefensePositions(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.open_fours.addUniqueList(&defense);
                }

                // 止め四: 片側だけ空いている4連
                if (lut.count == 4 and
                    ((end1 == .empty and end2 != .empty) or
                    (end1 != .empty and end2 == .empty)))
                {
                    const defense = getOpenFourDefensePositions(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.fours.addUniqueList(&defense);
                }

                // 跳び四 (LUT版)
                var is_jump_four = false;
                if (lut.count != 4 and lut.has_jump_four) {
                    is_jump_four = true;
                    if (findJumpGapPosition(cells, row, col, dir.dr, dir.dc, opponent_color)) |gap_pos| {
                        result.fours.addUnique(gap_pos);
                    }
                }

                // 活三: 両端が空いている3連（跳び四の一部でない）
                if (!is_jump_four and lut.count == 3 and end1 == .empty and end2 == .empty) {
                    const defense = getOpenThreeDefensePositions(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.open_threes.addUniqueList(&defense);
                }

                // 跳び三
                if (lut.count < 3) {
                    const defense = detectJumpThreePattern(cells, row, col, dir.dr, dir.dc, opponent_color);
                    result.open_threes.addUniqueList(&defense);
                }
            }
        }
    }

    return result;
}

pub fn detectOpponentThreats(cells: []Cell, opponent_color: Cell) ThreatInfo {
    var result = detectThreatsCore(cells, opponent_color, false);

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

/// 相手の脅威を検出（cells 配列直接参照版、ビットボード不要）
/// PV 抽出など一時的な石配置でビットボードが未更新の場合に使用
pub fn detectOpponentThreatsFromCells(cells: []const Cell, opponent_color: Cell) ThreatInfo {
    return detectThreatsCore(cells, opponent_color, true);
}

/// 三三チェック（活三2つ以上）
pub fn createsDoubleThree(cells: []Cell, row: u8, col: u8, color: Cell) bool {
    const idx = @as(u16, row) * BOARD_SIZE + col;
    cells[idx] = color;
    bitboard.placeStone(row, col, color);
    defer {
        cells[idx] = .empty;
        bitboard.removeStone(row, col);
    }

    var open_three_count: u8 = 0;

    for (0..4) |i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const lut = ll.queryPatternByCell(row, col, i, color);
        const end1 = lutEnd(lut.end1);
        const end2 = lutEnd(lut.end2);

        // 活三カウント
        if (lut.count == 3 and end1 == .empty and end2 == .empty and
            patterns.isValidConsecutiveThree(cells, row, col, dir_index, color))
        {
            open_three_count += 1;
        } else if (lut.count != 3 and lut.has_jump_three and
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

    for (0..4) |i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const lut = ll.queryPatternByCell(row, col, i, .white);
        // 白なのでオーバーライン補正不要
        const end1 = lutEnd(lut.end1);
        const end2 = lutEnd(lut.end2);

        // 活三カウント
        if (lut.count == 3 and end1 == .empty and end2 == .empty and
            patterns.isValidConsecutiveThree(cells, row, col, dir_index, .white))
        {
            open_three_count += 1;
        }

        // 四カウント
        if (lut.count == 4 and (end1 == .empty or end2 == .empty)) {
            four_count += 1;
        }

        // 跳び三 (LUT版)
        if (lut.count != 3 and lut.has_jump_three and
            patterns.isValidJumpThree(cells, row, col, dir_index, .white))
        {
            open_three_count += 1;
        }

        // 跳び四 (LUT版)
        if (lut.count != 4 and lut.has_jump_four) {
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
    bitboard.initFromCells(&cells);

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

test "detectOpponentThreatsFromCells: 活四検出（ビットボード未同期）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の4連: (7,4),(7,5),(7,6),(7,7) 両端空き
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    // ビットボード未同期（initFromCells を呼ばない）

    const result = detectOpponentThreatsFromCells(&cells, .white);
    try std.testing.expect(result.open_fours.len > 0);
}

test "detectOpponentThreatsFromCells: 止め四検出" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の止め四: 黒(7,3), 白(7,4..7), 空(7,8)
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;

    const result = detectOpponentThreatsFromCells(&cells, .white);
    try std.testing.expect(result.fours.len > 0);
    try std.testing.expect(result.fours.contains(7, 8));
}

test "detectOpponentThreatsFromCells: 跳び四検出" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の跳び四: (7,4),(7,5),(7,6),空,(7,8)
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 8] = .white;

    const result = detectOpponentThreatsFromCells(&cells, .white);
    try std.testing.expect(result.fours.len > 0);
    try std.testing.expect(result.fours.contains(7, 7));
}

test "detectOpponentThreatsFromCells: ビットボード同期時に detectOpponentThreats と一致" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[5 * BOARD_SIZE + 5] = .black;
    bitboard.initFromCells(&cells);

    const result_bb = detectOpponentThreats(&cells, .white);
    const result_cells = detectOpponentThreatsFromCells(&cells, .white);

    // 四/活四は一致すべき（ミセ/三三は cells 版では省略）
    try std.testing.expectEqual(result_bb.open_fours.len, result_cells.open_fours.len);
    try std.testing.expectEqual(result_bb.fours.len, result_cells.fours.len);
    try std.testing.expectEqual(result_bb.open_threes.len, result_cells.open_threes.len);
}

test "countThreatDirections basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活三: (7,5),(7,6),(7,7) 横方向
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    bitboard.initFromCells(&cells);
    const count = countThreatDirections(&cells, 7, 7, .white);
    try std.testing.expect(count >= 1);
}

// === bitboard 不変性のリグレッション（#37 P3 PR5b 調査）===
//
// detectOpponentThreats は空き点ループ内で createsFourThree / createsDoubleThree を
// 繰り返し呼ぶ。これらは候補を仮置き（cells + bitboard.placeStone）し defer で復元するが、
// removeStone が黒白**両ビット**をクリアするため、候補が**空き点**である限り
// （置く前のビットは 0 → 置いて消すと 0 に戻る）global_bb は完全復元される。
// detectOpponentThreats は `cells[idx] != .empty` で空き点に限定しているので蓄積ドリフトは
// 起きない。本テストはその不変性を凍結する（占有セルに createsFourThree を呼ぶ契約違反を
// 別実装が犯すとここが落ちて気付ける）。
fn bbEqual(a: bitboard.Bitboard, b: bitboard.Bitboard) bool {
    for (0..bitboard.LINE_COUNT) |i| {
        if (a.black[i] != b.black[i]) return false;
        if (a.white[i] != b.white[i]) return false;
    }
    return true;
}

test "detectOpponentThreats: global_bb を不変に保つ（蓄積ドリフトなし）" {
    // ミセ手（四三）と三三脅威が複数生じる多石の合法寄り局面
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const whites = [_][2]u8{
        .{ 7, 5 }, .{ 7, 6 }, .{ 8, 7 }, .{ 9, 7 },
        .{ 6, 8 }, .{ 8, 9 }, .{ 9, 6 }, .{ 5, 5 },
    };
    const blacks = [_][2]u8{
        .{ 7, 7 }, .{ 8, 8 }, .{ 9, 9 }, .{ 6, 6 },
        .{ 10, 7 }, .{ 7, 10 }, .{ 6, 7 },
    };
    for (whites) |p| cells[@as(u16, p[0]) * BOARD_SIZE + p[1]] = .white;
    for (blacks) |p| cells[@as(u16, p[0]) * BOARD_SIZE + p[1]] = .black;
    bitboard.initFromCells(&cells);

    const snapshot = bitboard.global_bb;
    _ = detectOpponentThreats(&cells, .white);
    try std.testing.expect(bbEqual(snapshot, bitboard.global_bb));
    _ = detectOpponentThreats(&cells, .black);
    try std.testing.expect(bbEqual(snapshot, bitboard.global_bb));

    // cells 自体も不変（仮置きが全て復元されている）
    var fresh = [_]Cell{.empty} ** CELL_COUNT;
    for (whites) |p| fresh[@as(u16, p[0]) * BOARD_SIZE + p[1]] = .white;
    for (blacks) |p| fresh[@as(u16, p[0]) * BOARD_SIZE + p[1]] = .black;
    try std.testing.expect(std.mem.eql(Cell, &cells, &fresh));
}

test "createsFourThree: 空き候補なら global_bb 不変・占有候補なら破壊（契約の確認）" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[8 * BOARD_SIZE + 8] = .white;
    bitboard.initFromCells(&cells);
    const snapshot = bitboard.global_bb;

    // 空き候補: 仮置き→defer 復元で global_bb は完全復元
    _ = evaluate.createsFourThree(&cells, 9, 9, .black);
    try std.testing.expect(bbEqual(snapshot, bitboard.global_bb));

    // 占有セルに呼ぶと removeStone が既存石のビットを消し drift する（＝契約違反の証跡）。
    // 呼び出し側は必ず空き点を渡すこと（detectOpponentThreats はガード済み）。
    _ = evaluate.createsFourThree(&cells, 7, 7, .white);
    try std.testing.expect(!bbEqual(snapshot, bitboard.global_bb));
}
