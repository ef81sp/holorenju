const board_mod = @import("board.zig");
const jp = @import("jump_patterns.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;

/// 4方向のペアインデックス（renjuRules の DIRECTION_PAIRS に対応）
/// [縦(0), 横(2), 斜め右(1), 斜め左(3)] — dirIndex の値
const DIRECTION_PAIR_INDICES = [4]u8{ 0, 2, 1, 3 };

/// 禁手の種類
pub const ForbiddenType = enum(u8) {
    none = 0,
    overline = 1,
    double_four = 2,
    double_three = 3,
};

/// 禁手判定の再帰コンテキスト
/// 循環参照検出とキャッシュ用
const ForbiddenContext = struct {
    /// 現在判定中のマス（循環参照検出）
    in_progress: [225]bool = [_]bool{false} ** 225,
    /// キャッシュ: 0=未計算, 1=禁手でない, 2=禁手
    cache: [225]u8 = [_]u8{0} ** 225,
};

/// 五連をチェック
pub fn checkFive(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    for (DIRECTION_PAIR_INDICES) |dir_index| {
        if (jp.getLineLength(cells, row, col, dir_index, color) == 5) return true;
    }
    return false;
}

/// 長連（6個以上）をチェック��黒のみ）
pub fn checkOverline(cells: []const Cell, row: u8, col: u8) bool {
    for (DIRECTION_PAIR_INDICES) |dir_index| {
        if (jp.getLineLength(cells, row, col, dir_index, .black) >= 6) return true;
    }
    return false;
}

/// 四四をチェック（2つ以上の四ができるか）
fn checkDoubleFour(cells: []const Cell, row: u8, col: u8) bool {
    var four_count: u8 = 0;

    for (DIRECTION_PAIR_INDICES) |dir_index| {
        const pattern = jp.checkOpenPattern(cells, row, col, dir_index, .black);
        if (pattern.four) {
            four_count += 1;
        } else if (jp.checkJumpFour(cells, row, col, dir_index, .black)) {
            four_count += 1;
        }
        if (four_count >= 2) return true;
    }

    return false;
}

/// 三が「本物の三」かどうかを検証
/// 達四点のいずれかが禁点でなく、かつ達四になるなら有効
fn isValidThreeConsecutive(
    cells: []Cell,
    row: u8,
    col: u8,
    dir_index: u8,
    ctx: *ForbiddenContext,
) bool {
    const sfp = jp.getConsecutiveThreeStraightFourPoints(cells, row, col, dir_index, .black);
    if (sfp.count == 0) return false;

    // 元の位置に黒石を仮置き
    const orig_idx = @as(u16, row) * BOARD_SIZE + col;
    const original = cells[orig_idx];
    cells[orig_idx] = .black;

    var valid = false;
    var i: u8 = 0;
    while (i < sfp.count) : (i += 1) {
        const p = sfp.points[i];
        // 達四点が禁点でないかチェック
        const forbidden = checkForbiddenMoveRecursive(cells, p.row, p.col, ctx);
        if (forbidden != .none) continue;
        // 達四判定
        if (jp.checkStraightFour(cells, p.row, p.col, dir_index, .black)) {
            valid = true;
            break;
        }
    }

    // 復元
    cells[orig_idx] = original;
    return valid;
}

/// 跳び三が「本物の三」かどうかを検証
fn isValidThreeJump(
    cells: []Cell,
    row: u8,
    col: u8,
    dir_index: u8,
    ctx: *ForbiddenContext,
) bool {
    const sfp = jp.getJumpThreeStraightFourPoints(cells, row, col, dir_index, .black);
    if (!sfp.found) return false;

    // 元の位置に黒石を仮置き
    const orig_idx = @as(u16, row) * BOARD_SIZE + col;
    const original = cells[orig_idx];
    cells[orig_idx] = .black;

    const p = sfp.point;
    // 達四点が禁点でないかチェック
    const forbidden = checkForbiddenMoveRecursive(cells, p.row, p.col, ctx);
    var valid = false;
    if (forbidden == .none) {
        valid = jp.checkStraightFour(cells, p.row, p.col, dir_index, .black);
    }

    // 復元
    cells[orig_idx] = original;
    return valid;
}

/// 三三をチェック（2つ以上の有効な活三ができるか）
fn checkDoubleThree(cells: []Cell, row: u8, col: u8, ctx: *ForbiddenContext) bool {
    const ThreeInfo = struct {
        dir_index: u8,
        is_jump: bool,
    };
    var threes: [4]ThreeInfo = undefined;
    var three_count: u8 = 0;

    for (DIRECTION_PAIR_INDICES) |dir_index| {
        const pattern = jp.checkOpenPattern(cells, row, col, dir_index, .black);

        // この方向が四なら三ではない
        if (pattern.four or jp.checkJumpFour(cells, row, col, dir_index, .black)) continue;

        // 連続三をチェック
        if (pattern.open3) {
            threes[three_count] = .{ .dir_index = dir_index, .is_jump = false };
            three_count += 1;
        }
        // 跳び三をチェック（連続三がない場合のみ）
        else if (jp.checkJumpThree(cells, row, col, dir_index, .black)) {
            threes[three_count] = .{ .dir_index = dir_index, .is_jump = true };
            three_count += 1;
        }
    }

    if (three_count < 2) return false;

    // ウソの三を除外して有効な三をカウント
    var valid_count: u8 = 0;
    var i: u8 = 0;
    while (i < three_count) : (i += 1) {
        const three = threes[i];
        const valid = if (three.is_jump)
            isValidThreeJump(cells, row, col, three.dir_index, ctx)
        else
            isValidThreeConsecutive(cells, row, col, three.dir_index, ctx);
        if (valid) {
            valid_count += 1;
            if (valid_count >= 2) return true;
        }
    }

    return false;
}

/// 再帰的な禁手判定（循環参照検出付き）
fn checkForbiddenMoveRecursive(cells: []Cell, row: u8, col: u8, ctx: *ForbiddenContext) ForbiddenType {
    const key = @as(u16, row) * BOARD_SIZE + col;

    // 循環参照検出
    if (ctx.in_progress[key]) return .none;

    // キャッシュ確認
    if (ctx.cache[key] != 0) {
        return if (ctx.cache[key] == 1) .none else .double_three;
    }

    // 空でなければスキップ
    if (cells[key] != .empty) return .none;

    // 判定中としてマーク
    ctx.in_progress[key] = true;

    const result = checkForbiddenMoveInternal(cells, row, col, ctx);

    ctx.in_progress[key] = false;
    ctx.cache[key] = if (result == .none) 1 else 2;

    return result;
}

/// 禁手判定の内部実装
fn checkForbiddenMoveInternal(cells: []Cell, row: u8, col: u8, ctx: *ForbiddenContext) ForbiddenType {
    // 五連ができる手は禁手ではない
    if (checkFive(cells, row, col, .black)) return .none;

    // 長連チェック
    if (checkOverline(cells, row, col)) return .overline;

    // 四四チェック
    if (checkDoubleFour(cells, row, col)) return .double_four;

    // 三三チェック
    if (checkDoubleThree(cells, row, col, ctx)) return .double_three;

    return .none;
}

/// 禁手判定（公開API）
pub fn checkForbiddenMove(cells: []Cell, row: u8, col: u8) ForbiddenType {
    var ctx = ForbiddenContext{};
    return checkForbiddenMoveRecursive(cells, row, col, &ctx);
}

// === Zig unit tests ===

test "checkFive: 5連検出" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    // (7,8) に置くと5連
    try std.testing.expect(checkFive(&cells, 7, 8, .black));
    // (7,3) に置くと 5連 (7,3-7)
    try std.testing.expect(checkFive(&cells, 7, 3, .black));
    // (7,9) に置いても5連にならない（4+1=5ではなく、離れている）
    try std.testing.expect(!checkFive(&cells, 7, 9, .black));
}

test "checkOverline: ���連検出" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    // (7,8) に置くと6連
    try std.testing.expect(checkOverline(&cells, 7, 8));
}

test "checkForbiddenMove: 長連禁" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    try std.testing.expectEqual(checkForbiddenMove(&cells, 7, 8), .overline);
}

test "checkForbiddenMove: 四四禁" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 横: (7,4),(7,5),(7,6) + 縦: (5,7),(6,7),(8,7) → (7,7)で四四
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 7] = .black;
    try std.testing.expectEqual(checkForbiddenMove(&cells, 7, 7), .double_four);
}

test "checkForbiddenMove: 五連は禁手ではない" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    try std.testing.expectEqual(checkForbiddenMove(&cells, 7, 8), .none);
}

test "checkForbiddenMove: 空でないマスは禁手でない" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    try std.testing.expectEqual(checkForbiddenMove(&cells, 7, 7), .none);
}
