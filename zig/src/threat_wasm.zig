// 脅威分類専用 thin wasm（Issue #37 P3 / PR2）
//
// review worker / メインスレッド（vcfPuzzle）が、TS の `createsFour` / `createsOpenThree`
// （= 四 / 活三 判定）を **Zig 単一ソース**経由で使うための最小 wasm。
//
// 橋の本体は `vct.classifyThreat`（vct.zig）。これは TS `threatMoves.ts` の `classifyThreat`
// と 1:1 構造一致し、**黒長連除外（isJumpFourOverline / isOverlineEnd）を内包**する。
// 注意: `main.zig` の `classifyPointWasm` は生パターンビット（長連除外なし）なので**使わない**。
//
// forbidden_wasm.zig との唯一の構造差: `vct.classifyThreat` は `line_lookup.queryPatternByCell`
// 経由で `bitboard.global_bb` に依存するため、cells 同期に加えて `bitboard.initFromCells` の
// 同期（syncBitboard）が必須。
//
// vct.zig は探索スタック全体を import するが、ここから到達するのは classifyThreat の呼ぶ
// 関数のみ（Zig のデッドコード削除で thin に保たれる）。
const bitboard = @import("bitboard.zig");
const board = @import("board.zig");
const evaluate = @import("evaluate.zig");
const jp = @import("jump_patterns.zig");
const threats = @import("threats.zig");
const vct = @import("vct.zig");

export fn boardInit() void {
    board.boardInit();
}

export fn boardSet(row: u8, col: u8, value: u8) void {
    board.boardSet(row, col, value);
}

/// cells から bitboard.global_bb を再構築する。classifyThreatWasm の前に必ず呼ぶ。
export fn syncBitboard() void {
    bitboard.initFromCells(&board.board_cells);
}

/// (row,col) に color が**配置済み**の盤面で、四 / 活三ができるかを返す。
/// bit0 = createsFour（黒は長連除外済）, bit1 = createsOpenThree。
/// 呼び出し前に boardSet で cells を、syncBitboard で bitboard を同期しておくこと。
export fn classifyThreatWasm(row: u8, col: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    const r = vct.classifyThreat(&board.board_cells, row, col, c);
    var bits: u8 = 0;
    if (r.creates_four) bits |= 1;
    if (r.creates_open_three) bits |= 2;
    return bits;
}

/// (row,col) が**空き**の盤面で、そこに color を打つと四三ができるか（黒は禁手考慮）。
/// 内部で候補を仮置き・復元する（候補は空き前提）。事前に boardSet/syncBitboard で同期しておくこと。
export fn createsFourThreeWasm(row: u8, col: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (evaluate.createsFourThree(&board.board_cells, row, col, c)) 1 else 0;
}

// === detectOpponentThreats（ThreatInfo）の wire（#37 P3 PR4）===
//
// ThreatInfo = 5 リスト（open_fours/fours/open_threes/mises/double_threes、各 PositionList cap=64）。
// バッファに [u8 count][count*(u8 row, u8 col)] を 5 回連結してシリアライズする。
// 最大 5*(1 + 64*2) = 645 バイト。
var threat_info_buffer: [768]u8 = undefined;

export fn getThreatInfoBuffer() [*]u8 {
    return &threat_info_buffer;
}

fn writeList(off: usize, list: *const threats.PositionList) usize {
    var o = off;
    threat_info_buffer[o] = list.len;
    o += 1;
    for (0..list.len) |i| {
        threat_info_buffer[o] = list.items[i].row;
        threat_info_buffer[o + 1] = list.items[i].col;
        o += 2;
    }
    return o;
}

/// 相手(opponent_color)の脅威を検出し ThreatInfo をバッファにシリアライズする。
/// 事前に boardSet で cells、syncBitboard で bitboard を同期しておくこと。
export fn detectOpponentThreatsWasm(opponent_color: u8) void {
    const c: board.Cell = @enumFromInt(opponent_color);
    const info = threats.detectOpponentThreats(&board.board_cells, c);
    var o: usize = 0;
    o = writeList(o, &info.open_fours);
    o = writeList(o, &info.fours);
    o = writeList(o, &info.open_threes);
    o = writeList(o, &info.mises);
    o = writeList(o, &info.double_threes);
}

// === findMiseTargets（#37 P3 PR5b）===
//
// (row,col) に color のミセ手を配置済みの盤面で、四三ターゲット点（空き）を列挙する。
// [u8 count][count*(u8 row, u8 col)] を mise_buffer にシリアライズ（最大 1+64*2=129B）。
var mise_buffer: [160]u8 = undefined;

export fn getMiseBuffer() [*]u8 {
    return &mise_buffer;
}

/// (row,col) にミセ手を配置済みの盤面で四三ターゲットを検出しバッファに書く。
/// 事前に boardSet で cells（ミセ手含む）、syncBitboard で bitboard を同期しておくこと。
export fn findMiseTargetsWasm(row: u8, col: u8, color: u8) void {
    const c: board.Cell = @enumFromInt(color);
    const list = evaluate.findMiseTargets(&board.board_cells, row, col, c);
    mise_buffer[0] = list.len;
    var o: usize = 1;
    for (0..list.len) |i| {
        mise_buffer[o] = list.items[i].row;
        mise_buffer[o + 1] = list.items[i].col;
        o += 2;
    }
}

// === findDoubleMiseMoves（#37 P3 PR5b）===
//
// 盤面全空きセルから両ミセ手を列挙し [u8 count][count*(u8 row,u8 col)] をバッファに書く。
var double_mise_buffer: [160]u8 = undefined;

export fn getDoubleMiseBuffer() [*]u8 {
    return &double_mise_buffer;
}

/// color の両ミセ手を列挙しバッファに書く。事前に boardSet/syncBitboard で同期しておくこと。
export fn findDoubleMiseMovesWasm(color: u8) void {
    const c: board.Cell = @enumFromInt(color);
    const list = evaluate.findDoubleMiseMoves(&board.board_cells, c);
    double_mise_buffer[0] = list.len;
    var o: usize = 1;
    for (0..list.len) |i| {
        double_mise_buffer[o] = list.items[i].row;
        double_mise_buffer[o + 1] = list.items[i].col;
        o += 2;
    }
}

// === vctHelpers（#37 P3 PR6）===
//
// VCT 検証ヘルパー3関数（review 専用パス: validateVCTSequence / filterByCounterThreats /
// findVCTByFirstMoveIteration）を Zig 単一ソース経由にする橋。実体は vct.zig の既存関数。
// いずれも盤面全走査を内包するバッチ API なので、1 回の sync で 1 回呼ぶ（点ごと再同期は不要）。
// 事前に boardSet で cells、syncBitboard で bitboard を同期しておくこと。

/// color が活三を持つか（1/0）。
export fn hasOpenThreeWasm(color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (vct.hasOpenThree(&board.board_cells, c)) 1 else 0;
}

/// color がミセ手（1手で四三）を持つか（1/0）。内部で空き点を仮置き・復元する。
export fn hasFourThreeAvailableWasm(color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (vct.hasFourThreeAvailable(&board.board_cells, c)) 1 else 0;
}

// 四・活三を作れる手（四優先・row-major）を [u8 count][count*(row,col)] でシリアライズ。
// 最大 225 手なので 1 + 225*2 = 451 バイト。
var threat_moves_buffer: [512]u8 = undefined;

export fn getThreatMovesBuffer() [*]u8 {
    return &threat_moves_buffer;
}

/// color の脅威手を列挙しバッファに書く。内部で各空き点を仮置き・復元する。
export fn findThreatMovesWasm(color: u8) void {
    const c: board.Cell = @enumFromInt(color);
    var buf: [225]threats.Position = undefined;
    const n = vct.findThreatMoves(&board.board_cells, c, &buf);
    threat_moves_buffer[0] = @intCast(n);
    var o: usize = 1;
    for (0..n) |i| {
        threat_moves_buffer[o] = buf[i].row;
        threat_moves_buffer[o + 1] = buf[i].col;
        o += 2;
    }
}

// === patterns プリミティブ（#37 P4 PR-A）===
//
// patterns.ts の図形判定プリミティブを Zig 単一ソース化する橋（patternsAdapter 経由）。
// 実体は jump_patterns.zig の既存関数。これらは cells を直読みする（bitboard 非依存）ため
// boardInit/boardSet のみで同期可（syncBitboard 不要）。
// 規約: (row,col) に color を**配置済み**の cells で評価する（renjuParity と同一規約）。
// dir_index は 0-7（DIRECTIONS_8。TS の DIRECTIONS と一致）。

/// (row,col,dir,color) で跳び四が成立するか（1/0）。
export fn checkJumpFourWasm(row: u8, col: u8, dir_index: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (jp.checkJumpFour(&board.board_cells, row, col, dir_index, c)) 1 else 0;
}

/// (row,col,dir,color) で跳び三が成立するか（1/0）。
export fn checkJumpThreeWasm(row: u8, col: u8, dir_index: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (jp.checkJumpThree(&board.board_cells, row, col, dir_index, c)) 1 else 0;
}

/// (row,col,dir,color) で達四（連続四で延ばすと五）が成立するか（1/0）。
export fn checkStraightFourWasm(row: u8, col: u8, dir_index: u8, color: u8) u8 {
    const c: board.Cell = @enumFromInt(color);
    return if (jp.checkStraightFour(&board.board_cells, row, col, dir_index, c)) 1 else 0;
}

// 達四点（getConsecutive…/getJumpThree…）を [u8 count][count*(row,col)] でシリアライズ。
// 連続三は最大2点なので 1+2*2=5 バイト。
var pattern_points_buffer: [8]u8 = undefined;

export fn getPatternPointsBuffer() [*]u8 {
    return &pattern_points_buffer;
}

/// 連続三の達四点（最大2点）を pattern_points_buffer に書く。
export fn getConsecutiveThreeStraightFourPointsWasm(row: u8, col: u8, dir_index: u8, color: u8) void {
    const c: board.Cell = @enumFromInt(color);
    const r = jp.getConsecutiveThreeStraightFourPoints(&board.board_cells, row, col, dir_index, c);
    pattern_points_buffer[0] = r.count;
    var o: usize = 1;
    for (0..r.count) |i| {
        pattern_points_buffer[o] = r.points[i].row;
        pattern_points_buffer[o + 1] = r.points[i].col;
        o += 2;
    }
}

/// 跳び三の達四点（最大1点）を pattern_points_buffer に書く。
export fn getJumpThreeStraightFourPointsWasm(row: u8, col: u8, dir_index: u8, color: u8) void {
    const c: board.Cell = @enumFromInt(color);
    const r = jp.getJumpThreeStraightFourPoints(&board.board_cells, row, col, dir_index, c);
    if (r.found) {
        pattern_points_buffer[0] = 1;
        pattern_points_buffer[1] = r.point.row;
        pattern_points_buffer[2] = r.point.col;
    } else {
        pattern_points_buffer[0] = 0;
    }
}
