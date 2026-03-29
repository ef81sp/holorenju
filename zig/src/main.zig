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
/// 探索結果バッファ（WASM メモリ上）
/// [0]: row, [1]: col, [2..6]: score (i32 LE), [6]: completedDepth
var result_buffer: [8]u8 = .{0} ** 8;

/// 結果バッファのポインタを返す（JS側からメモリ読み取り用）
export fn getResultBuffer() [*]u8 {
    return &result_buffer;
}

/// 最善手を探索し、結果を result_buffer に書き込む
///
/// パラメータ:
///   color: 1=black, 2=white
///   max_depth: 探索深度
///   time_limit_ms: 時間制限（ミリ秒）、0=無制限
///   max_nodes: ノード数上限、0=無制限
export fn findBestMove(color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            writeResult(15, 15, 0, 0);
            return;
        },
    };

    const cells = &board.board_cells;

    const result = search.findBestMoveIterative(cells, cell_color, .{
        .max_depth = max_depth,
        .time_limit = time_limit_ms,
        .max_nodes = max_nodes,
    });

    writeResult(result.position.row, result.position.col, result.score, result.completed_depth);
}

/// TT をクリア
export fn ttClear() void {
    tt_mod.global_tt.clear();
}

fn writeResult(row: u8, col: u8, score: i32, completed_depth: u8) void {
    result_buffer[0] = row;
    result_buffer[1] = col;
    const score_bytes: [4]u8 = @bitCast(score);
    result_buffer[2] = score_bytes[0];
    result_buffer[3] = score_bytes[1];
    result_buffer[4] = score_bytes[2];
    result_buffer[5] = score_bytes[3];
    result_buffer[6] = completed_depth;
    result_buffer[7] = 0;
}
