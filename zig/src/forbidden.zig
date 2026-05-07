const board_mod = @import("board.zig");
const jp = @import("jump_patterns.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;

/// 4方向のペアインデックス（renjuRules の DIRECTION_PAIRS に対応）
/// [縦(0), 横(2), 斜め右(1), 斜め左(3)] — dirIndex の値
const DIRECTION_PAIR_INDICES = [4]u8{ 0, 2, 1, 3 };

/// 四四判定用の4方向ベクトル（縦, 横, ↘, ↙）
const FOUR_DIRECTION_VECTORS = [4]struct { dr: i8, dc: i8 }{
    .{ .dr = 1, .dc = 0 }, // 縦
    .{ .dr = 0, .dc = 1 }, // 横
    .{ .dr = 1, .dc = 1 }, // 斜め↘
    .{ .dr = 1, .dc = -1 }, // 斜め↙
};

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

/// 指定方向の「異なる4石セットの真の四」を数える
///
/// 配置点 (row, col) を含む 5-cell ウィンドウを 5個 (start offset = -4..0) 列挙し、
/// 各ウィンドウが「自色4石 + 空き1マス、相手石・盤外なし」を満たすかチェックする。
/// 該当ウィンドウについて:
/// - 4石位置の bitmask で重複排除（同じ4石セットは1つの四として扱う）
/// - 完成形が長連 (overline) にならないか検証（隣接マス start-1 / start+5 が黒でない）
///
/// 既存の `checkOpenPattern.four` / `checkJumpFour` は方向ごとに bool しか返さず、
/// 同方向に4石セットが異なる複数の四（飛び四×2 や 連続四＋飛び四）を区別できないため
/// ここでは独自に 5-cell ウィンドウ列挙する（Issue #19）。
///
/// 仕様 SSoT: src/logic/renjuRules/forbiddenMoves.ts の countDistinctFoursInDirection と同期させること。
///
/// stack 上の固定配列で dedupe するため alloc-free。
fn countDistinctFoursInDirection(
    cells: []const Cell,
    row: u8,
    col: u8,
    dr: i8,
    dc: i8,
) u8 {
    // 同一 stone set の bitmask が複数 window から出現する可能性があるため、
    // dedupe しつつ「いずれかの window が真の四（長連にならない）」かを記録する。
    var masks: [5]u16 = undefined;
    var is_real: [5]bool = undefined;
    var mask_count: u8 = 0;

    var start: i32 = -4;
    while (start <= 0) : (start += 1) {
        var stone_mask: u16 = 0;
        var stone_count: u8 = 0;
        var empty_count: u8 = 0;
        var window_valid = true;

        var i: u8 = 0;
        while (i < 5) : (i += 1) {
            const offset: i32 = start + @as(i32, i);
            const r: i32 = @as(i32, row) + offset * @as(i32, dr);
            const c: i32 = @as(i32, col) + offset * @as(i32, dc);
            if (r < 0 or r >= BOARD_SIZE or c < 0 or c >= BOARD_SIZE) {
                window_valid = false;
                break;
            }
            const idx: usize = @intCast(r * BOARD_SIZE + c);
            const cell: Cell = if (offset == 0) .black else cells[idx];
            if (cell == .black) {
                stone_mask |= (@as(u16, 1) << @intCast(offset + 4));
                stone_count += 1;
            } else if (cell == .empty) {
                empty_count += 1;
            } else {
                window_valid = false;
                break;
            }
        }

        if (!window_valid or stone_count != 4 or empty_count != 1) continue;

        // 完成形の長連チェック: 完成後の 5石は [start, start+4]、
        // 隣接マス (start-1, start+5) が黒なら長連 (ウソの四)
        const before_r: i32 = @as(i32, row) + (start - 1) * @as(i32, dr);
        const before_c: i32 = @as(i32, col) + (start - 1) * @as(i32, dc);
        const after_r: i32 = @as(i32, row) + (start + 5) * @as(i32, dr);
        const after_c: i32 = @as(i32, col) + (start + 5) * @as(i32, dc);
        const before_is_black = before_r >= 0 and before_r < BOARD_SIZE and
            before_c >= 0 and before_c < BOARD_SIZE and
            cells[@as(usize, @intCast(before_r * BOARD_SIZE + before_c))] == .black;
        const after_is_black = after_r >= 0 and after_r < BOARD_SIZE and
            after_c >= 0 and after_c < BOARD_SIZE and
            cells[@as(usize, @intCast(after_r * BOARD_SIZE + after_c))] == .black;
        const window_is_real = !before_is_black and !after_is_black;

        // dedupe: 同じ stone_mask が既にあれば、real 判定を OR 更新
        var found = false;
        var k: u8 = 0;
        while (k < mask_count) : (k += 1) {
            if (masks[k] == stone_mask) {
                if (window_is_real) is_real[k] = true;
                found = true;
                break;
            }
        }
        if (!found) {
            masks[mask_count] = stone_mask;
            is_real[mask_count] = window_is_real;
            mask_count += 1;
        }
    }

    var real_count: u8 = 0;
    var k: u8 = 0;
    while (k < mask_count) : (k += 1) {
        if (is_real[k]) real_count += 1;
    }
    return real_count;
}

/// 四四をチェック（2つ以上の真の四ができるか）
/// 同方向に 4石セットが異なる複数の四が成立する場合もそれぞれカウントする。
/// 連続四・飛び四を区別せず、5-cell ウィンドウ列挙で統一的に判定する。
fn checkDoubleFour(cells: []const Cell, row: u8, col: u8) bool {
    var total: u8 = 0;
    for (FOUR_DIRECTION_VECTORS) |dir| {
        total += countDistinctFoursInDirection(cells, row, col, dir.dr, dir.dc);
        if (total >= 2) return true;
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

// Issue #19 リグレッション: 同方向に 2つの異なる飛び四 (D_FGH と FGH_J) が成立
test "checkForbiddenMove: 同方向の2つの飛び四で四四禁" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // row=5 に col 3(D), 5(F), 7(H), 9(J) を黒、col 6(G) に置く
    // 配置後 row 5: ・・・●・●・●・●・・・・・
    // 飛び四 1: {3,5,6,7} (gap=4) → 5石(3..7)
    // 飛び四 2: {5,6,7,9} (gap=8) → 5石(5..9)
    // 異なる4石セットの真の四が同方向に2つ → 四四禁
    cells[5 * BOARD_SIZE + 3] = .black; // D
    cells[5 * BOARD_SIZE + 5] = .black; // F
    cells[5 * BOARD_SIZE + 7] = .black; // H
    cells[5 * BOARD_SIZE + 9] = .black; // J
    try std.testing.expectEqual(checkForbiddenMove(&cells, 5, 6), .double_four);
}

// 完成形が長連になる「ウソの四」は四四にカウントしない
test "checkForbiddenMove: XXXX_X 配置はウソの四を含むため四四ではない" {
    const CELL_COUNT = board_mod.CELL_COUNT;
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // row=7 に cols 4,5,6 黒、col 7 placed、col 9 黒（col 8 空き）
    // 連続四 {4,5,6,7}: gap=3→真の5、gap=8→col 9 が黒で長連 → 真
    // 飛び四 {5,6,7,9}: gap=8 のみ、col 4 が黒で長連 → ウソ
    // 真の四は1つだけ → 四四ではない
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 9] = .black;
    const result = checkForbiddenMove(&cells, 7, 7);
    // 長連にはならない (cols 4..7 = 4石 + col 9 で 5石、空 col 8 が間にあるので連続5ではない)
    // 四四でもない (真の四1つだけ)
    try std.testing.expect(result != .double_four);
    try std.testing.expect(result != .overline);
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
