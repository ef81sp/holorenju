const board = @import("board.zig");
const evaluate = @import("evaluate.zig");
const patterns = @import("patterns.zig");
const search = @import("search.zig");
const position_eval = @import("position_eval.zig");
const scores_mod = @import("scores.zig");
const tt_mod = @import("tt.zig");

export fn add(a: i32, b: i32) i32 {
    return a + b;
}

// Board exports
export fn boardInit() void {
    board.boardInit();
}
export fn boardGet(row: u8, col: u8) u8 {
    return board.boardGet(row, col);
}
export fn boardSet(row: u8, col: u8, value: u8) void {
    board.boardSet(row, col, value);
}
export fn countInDirection(row: u8, col: u8, dr: i8, dc: i8, color: u8) u16 {
    return board.countInDirection(row, col, dr, dc, color);
}
export fn analyzeDirection(row: u8, col: u8, dr: i8, dc: i8, color: u8) u32 {
    return board.analyzeDirection(row, col, dr, dc, color);
}

// Pattern exports
export fn evaluateDirectionScores(row: u8, col: u8, color: u8) i32 {
    return patterns.evaluateDirectionScores(row, col, color);
}
export fn wasmGetPatternScore(count: u8, end1: u8, end2: u8) i32 {
    return patterns.wasmGetPatternScore(count, end1, end2);
}
export fn wasmGetPatternType(count: u8, end1: u8, end2: u8) u8 {
    return patterns.wasmGetPatternType(count, end1, end2);
}

// Evaluate exports
export fn evaluateBoard(perspective: u8, options_flags: u32) i32 {
    return evaluate.evaluateBoard(perspective, options_flags);
}

// Search exports
/// 最善手を探索して返す
/// 戻り値: (row << 8) | col | (score << 16) をパック
/// score が FIVE 付近なら VCF/VCT による即勝ち手
///
/// パラメータ:
///   color: 1=black, 2=white
///   max_depth: 探索深度
///   time_limit_ms: 時間制限（ミリ秒）、0=無制限
///   max_nodes: ノード数上限、0=無制限
///
/// 戻り値: 上位16bit=score(i16にキャスト), 下位16bit=(row*15+col)
///   row=15, col=15 の場合はパス（有効な手なし）
export fn findBestMove(color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32) u32 {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => return packResult(15, 15, 0),
    };

    // グローバル盤面を使用
    const cells = &board.board_cells;

    const result = search.findBestMoveIterative(cells, cell_color, .{
        .max_depth = max_depth,
        .time_limit = time_limit_ms,
        .max_nodes = max_nodes,
    });

    return packResult(result.position.row, result.position.col, result.score);
}

/// TT をクリア
export fn ttClear() void {
    tt_mod.global_tt.clear();
}

fn packResult(row: u8, col: u8, score: i32) u32 {
    const pos: u16 = @as(u16, row) * 15 + col;
    // score を i16 範囲にクランプ
    const clamped: i16 = if (score > 32767) 32767 else if (score < -32768) -32768 else @intCast(score);
    const score_bits: u16 = @bitCast(clamped);
    return (@as(u32, score_bits) << 16) | pos;
}
