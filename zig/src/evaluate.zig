const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
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

/// evaluateBoard のオプション（ビットフィールドからデコード）
pub const EvalOptions = struct {
    enable_leaf_mise: bool,
    last_mover_is_perspective: enum(u8) { unset = 0, yes = 1, no = 2 },
    single_four_penalty_multiplier: i32, // 0-100 (実際の値は /100)
    connectivity_bonus: i32,
};

pub fn decodeOptions(flags: u32) EvalOptions {
    const multiplier_raw: u8 = @intCast((flags >> 8) & 0xFF);
    const connectivity_raw: u8 = @intCast((flags >> 16) & 0xFF);

    // bit 1-2: lastMoverIsPerspective (0=unset, 1=true, 2=false)
    const last_mover_bits: u8 = @intCast((flags >> 1) & 0x03);

    return .{
        .enable_leaf_mise = (flags & 1) != 0,
        .last_mover_is_perspective = @enumFromInt(if (last_mover_bits > 2) 0 else last_mover_bits),
        .single_four_penalty_multiplier = if (multiplier_raw == 0) 100 else @as(i32, multiplier_raw),
        .connectivity_bonus = if (connectivity_raw == 0) scores.CONNECTIVITY_BONUS else if (connectivity_raw == 255) 0 else @as(i32, connectivity_raw),
    };
}

const threats = @import("threats.zig");

/// 隣接マス（距離1）に石があるかチェック
fn isNearExistingStone(cells: []const Cell, row: u8, col: u8) bool {
    const occupied = threats.computeOccupiedRows(cells);
    const near = threats.computeNearMask(occupied, 1);
    return threats.isNearFromMask(near, row, col);
}

/// hasFourThreePotential: 四と活三の候補が異なる方向に存在するか
/// 連続石のみチェック（跳びパターンは対象外）
fn hasFourThreePotential(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    var has_four = false;
    var has_open_three = false;

    for (DIRECTIONS) |dir| {
        const pos = board_mod.countInDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
        const neg = board_mod.countInDirectionOnCells(cells, row, col, -dir.dr, -dir.dc, color);
        const total = @as(u16, pos.count) + neg.count;

        // 四の候補: 3石 + 仮置き = 4石連続、片端open
        if (total >= 3 and (pos.end_state == .empty or neg.end_state == .empty)) {
            has_four = true;
        }
        // 活三の候補: 2石 + 仮置き = 3石連続、両端open (else if で四方向と異なる方向)
        else if (total >= 2 and pos.end_state == .empty and neg.end_state == .empty) {
            has_open_three = true;
        }

        if (has_four and has_open_three) return true;
    }
    return false;
}

/// 黒の四の長連補正: empty 端の「gap の1つ先」(中心から run+2 マス先) が黒なら、
/// その端へ伸ばすと6連(長連)になり五を作れないため塞がり扱いとする。
/// TS analyzeDirection（directionAnalysis.ts）の count==4 オーバーライン補正に一致。
fn blackOverlineEnd(cells: []const Cell, row: u8, col: u8, dr: i8, dc: i8, run: u8) bool {
    const steps: i16 = @as(i16, run) + 2;
    const r: i16 = @as(i16, row) + dr * steps;
    const c: i16 = @as(i16, col) + dc * steps;
    if (!board_mod.isValid(r, c)) return false;
    const idx: u16 = @intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)));
    return cells[idx] == .black;
}

/// createsFourThree: 仮置きして四と活三が同時にできるかチェック（跳びパターン含む）
/// TS版 analyzeJumpPatterns の hasFour && hasValidOpenThree に対応
/// 呼び出し側で bitboard が cells と同期している前提。
pub fn createsFourThree(cells: []Cell, row: u8, col: u8, color: Cell) bool {
    const idx = @as(u16, row) * BOARD_SIZE + col;
    // 仮置き（bitboard も同期）
    cells[idx] = color;
    bitboard.placeStone(row, col, color);
    defer {
        cells[idx] = .empty;
        bitboard.removeStone(row, col);
    }

    var has_four = false;
    var has_valid_open_three = false;

    // 各方向のLUT結果をキャッシュ
    var dir_luts: [4]ll.PatternResult = undefined;
    var jump_four_dirs: [4]bool = [_]bool{false} ** 4;

    // 1st pass: 連続パターン + 跳び四検出 (LUT版)
    for (0..4) |i| {
        const lut = ll.queryPatternByCell(row, col, i, color);
        dir_luts[i] = lut;

        if (lut.count != 4 and lut.has_jump_four) {
            jump_four_dirs[i] = true;
        }
    }

    // 2nd pass: 四・活三判定
    for (0..4) |i| {
        const dir_index = jp.DIRECTION_INDICES[i];
        const lut = dir_luts[i];
        const end1 = lutEnd(lut.end1);
        const end2 = lutEnd(lut.end2);

        // 連続四（片端以上が空き）。端はセル走査で求め、黒は長連補正を適用する
        // （TS analyzeDirection と一致。LUT 端は黒長連補正を持たないため使わない）。
        if (lut.count == 4) {
            const dir = board_mod.DIRECTIONS[i];
            const pos = board_mod.countInDirectionOnCells(cells, row, col, dir.dr, dir.dc, color);
            const neg = board_mod.countInDirectionOnCells(cells, row, col, -dir.dr, -dir.dc, color);
            var e1 = pos.end_state;
            var e2 = neg.end_state;
            if (color == .black) {
                if (e1 == .empty and blackOverlineEnd(cells, row, col, dir.dr, dir.dc, pos.count)) {
                    e1 = .opponent;
                }
                if (e2 == .empty and blackOverlineEnd(cells, row, col, -dir.dr, -dir.dc, neg.count)) {
                    e2 = .opponent;
                }
            }
            if (e1 == .empty or e2 == .empty) {
                has_four = true;
            }
        }

        // 連続三の有効性チェック（跳び四方向でなければ）
        if (lut.count == 3 and !jump_four_dirs[i]) {
            if (end1 == .empty and end2 == .empty) {
                if (patterns.isValidConsecutiveThree(cells, row, col, dir_index, color)) {
                    has_valid_open_three = true;
                }
            }
        }

        // 跳び四
        if (jump_four_dirs[i]) {
            has_four = true;
        }

        // 跳び三 (LUT版: 連続三がなく、跳び四もない場合のみ)
        // 跳び四と同方向の跳び三は同一スジの四と三であり、四三を構成しない。
        // TS analyzeJumpPatterns の `!jumpFourDirections.has(i)` ガードに対応。
        if (lut.count != 3 and !jump_four_dirs[i] and lut.has_jump_three) {
            if (patterns.isValidJumpThree(cells, row, col, dir_index, color)) {
                has_valid_open_three = true;
            }
        }

        if (has_four and has_valid_open_three) return true;
    }
    return false;
}

/// 四三脅威スキャン
pub fn scanFourThreeThreat(cells: []Cell, color: Cell, stone_count: u16) bool {
    if (stone_count < 5) return false;

    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 1);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            if (cells[@as(u16, r) * BOARD_SIZE + c] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;
            if (!hasFourThreePotential(cells, r, c, color)) continue;
            if (createsFourThree(cells, r, c, color)) return true;
        }
    }
    return false;
}

/// estimateMiseOpportunity: 四と活三が両方存在するならミセ手の機会あり
pub fn estimateMiseOpportunity(four_score: i32, open_three_score: i32) bool {
    return four_score > 0 and open_three_score > 0;
}

/// evaluateBoard 本体
pub fn evaluateBoardOnCells(
    cells: []Cell,
    perspective: Cell,
    options: EvalOptions,
) i32 {
    const opponent = perspective.opposite();
    var my_score: i32 = 0;
    var opp_score: i32 = 0;
    var my_open_three_score: i32 = 0;
    var opp_open_three_score: i32 = 0;
    var my_four_score: i32 = 0;
    var opp_four_score: i32 = 0;
    var my_pending_four_penalty: i32 = 0;
    var opp_pending_four_penalty: i32 = 0;
    var my_stone_count: u16 = 0;
    var opp_stone_count: u16 = 0;

    const multiplier = options.single_four_penalty_multiplier;

    // 全石走査
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const stone = cells[@as(u16, r) * BOARD_SIZE + c];
            if (stone == .empty) continue;

            const result = patterns.evaluateStonePatternsLightOnCells(cells, r, c, stone);
            var adjusted_score = result.score;

            // 連携ボーナス
            if (result.active_direction_count >= 2 and options.connectivity_bonus > 0) {
                adjusted_score += options.connectivity_bonus * (@as(i32, result.active_direction_count) - 1);
            }

            if (stone == perspective) {
                my_stone_count += 1;
                my_score += adjusted_score;
                my_open_three_score += result.open_three_score;
                my_four_score += result.four_score;
                if (multiplier < 100 and result.four_score > 0 and result.open_three_score == 0) {
                    my_pending_four_penalty += @divTrunc(result.four_score * (100 - multiplier), 100);
                }
            } else if (stone == opponent) {
                opp_stone_count += 1;
                opp_score += adjusted_score;
                opp_open_three_score += result.open_three_score;
                opp_four_score += result.four_score;
                if (multiplier < 100 and result.four_score > 0 and result.open_three_score == 0) {
                    opp_pending_four_penalty += @divTrunc(result.four_score * (100 - multiplier), 100);
                }
            }
        }
    }

    // テンポ補正
    if (options.last_mover_is_perspective == .yes) {
        my_score -= @divTrunc(my_open_three_score * scores.TEMPO_OPEN_THREE_DISCOUNT_NUM, scores.TEMPO_OPEN_THREE_DISCOUNT_DEN);
    } else if (options.last_mover_is_perspective == .no) {
        opp_score -= @divTrunc(opp_open_three_score * scores.TEMPO_OPEN_THREE_DISCOUNT_NUM, scores.TEMPO_OPEN_THREE_DISCOUNT_DEN);
    }

    // 四三脅威スキャン
    const my_has_four_three = scanFourThreeThreat(cells, perspective, my_stone_count);
    const opp_has_four_three = scanFourThreeThreat(cells, opponent, opp_stone_count);

    if (scores.LEAF_FOUR_THREE_THREAT > 0) {
        if (my_has_four_three) my_score += scores.LEAF_FOUR_THREE_THREAT;
        if (opp_has_four_three) opp_score += scores.LEAF_FOUR_THREE_THREAT;
    }

    // ミセ手脅威推定
    if (options.enable_leaf_mise and scores.LEAF_MISE_THREAT > 0) {
        if (!my_has_four_three and estimateMiseOpportunity(my_four_score, my_open_three_score)) {
            my_score += scores.LEAF_MISE_THREAT;
        }
        if (!opp_has_four_three and estimateMiseOpportunity(opp_four_score, opp_open_three_score)) {
            opp_score += scores.LEAF_MISE_THREAT;
        }
    }

    // 四三脅威がなければ単発四ペナルティ適用
    if (!my_has_four_three) my_score -= my_pending_four_penalty;
    if (!opp_has_four_three) opp_score -= opp_pending_four_penalty;

    // Phase B: ラインポテンシャル（bitboard 同期済みの前提）
    // 非 incremental パスなので全ライン集計を毎回実行。Release ではこのパスは通らない。
    const line_potential = @import("line_potential.zig");
    const my_potential = line_potential.computeTotalGlobal(perspective);
    const opp_potential = line_potential.computeTotalGlobal(opponent);
    my_score += my_potential;
    opp_score += opp_potential;

    return my_score - opp_score;
}

// === WASM export ===

pub fn evaluateBoard(perspective: u8, options_flags: u32) i32 {
    ll.init();
    bitboard.initFromCells(&board_mod.board_cells);
    const options = decodeOptions(options_flags);
    return evaluateBoardOnCells(
        &board_mod.board_cells,
        @enumFromInt(perspective),
        options,
    );
}

// === Zig unit tests ===

test "empty board evaluates to 0" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    bitboard.initFromCells(&cells);
    const result = evaluateBoardOnCells(&cells, .black, .{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    });
    try std.testing.expectEqual(result, 0);
}

test "single stone has only line potential (no pattern score)" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);
    const result = evaluateBoardOnCells(&cells, .black, .{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    });
    // Phase B: 1石でもラインポテンシャルが入る
    // 中央 (7,7) は 4 方向それぞれで 5 ウィンドウに含まれる
    // 各ウィンドウ: popcount=1, [1]=3 → 合計 4 * 5 * 3 = 60
    try std.testing.expectEqual(@as(i32, 60), result);
}

test "symmetric position evaluates to 0" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Black horizontal 3: (7,6),(7,7),(7,8)
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    // White horizontal 3: (3,6),(3,7),(3,8)
    cells[3 * BOARD_SIZE + 6] = .white;
    cells[3 * BOARD_SIZE + 7] = .white;
    cells[3 * BOARD_SIZE + 8] = .white;
    bitboard.initFromCells(&cells);

    const black_perspective = evaluateBoardOnCells(&cells, .black, .{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    });
    const white_perspective = evaluateBoardOnCells(&cells, .white, .{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    });
    // Symmetric: black_perspective should be -white_perspective
    try std.testing.expectEqual(black_perspective, -white_perspective);
}

test "isNearExistingStone" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    try std.testing.expect(isNearExistingStone(&cells, 7, 8));
    try std.testing.expect(isNearExistingStone(&cells, 6, 6));
    try std.testing.expect(!isNearExistingStone(&cells, 5, 5));
}

test "hasFourThreePotential basic" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // Create a position where placing at (7,7) makes four+three
    // Horizontal: (7,5),(7,6),_,(7,8) → placing at (7,7) makes 4 in a row
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    // Vertical: (6,7),(8,7) → placing at (7,7) makes 3 in a row (open)
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 7] = .black;

    try std.testing.expect(hasFourThreePotential(&cells, 7, 7, .black));
}

// bug#2 回帰: 黒の四が長連方向に伸びる（伸ばすと6連）場合は四として数えない。
// 縦 col7: (5,7)黒, (6,7)空, [cand(7,7)], (8,7)(9,7)(10,7)黒, (11,7)白。
//   → 7-10 の連続四だが、下端(11,7)は白で塞がり、上端(6,7)空の先(5,7)が黒＝伸ばすと
//      5-10 の6連(長連)。よって黒では「四」にならない（TS analyzeDirection 補正と一致）。
// 横 row7: (7,5)(7,6)黒, [cand(7,7)], (7,8)空, (7,4)空 → 活三。
// 四が成立しないので四三は false でなければならない。
test "createsFourThree: 黒の長連方向の四は四三にしない (bug#2)" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 7] = .black;
    cells[9 * BOARD_SIZE + 7] = .black;
    cells[10 * BOARD_SIZE + 7] = .black;
    cells[11 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    bitboard.initFromCells(&cells);
    try std.testing.expect(!createsFourThree(&cells, 7, 7, .black));

    // 対照: 上端の長連石(5,7)を白にすると、(6,7)を埋めて 6-10 の五が作れる真の四
    //       → 四三が成立し true。
    cells[5 * BOARD_SIZE + 7] = .white;
    bitboard.initFromCells(&cells);
    try std.testing.expect(createsFourThree(&cells, 7, 7, .black));
}

// board_mod.isValid を公開するためにこのモジュール内で再宣言は不要。
// evaluate.zig 側で board_mod.isValid を直接使えないのは private のため。
// → isNearExistingStone 内で直接実装済み。
