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
/// [0]: row, [1]: col, [2..5]: score (i32 LE), [6]: completedDepth, [7]: candidateCount
/// [8..67]: 候補手リスト（最大10手、各6バイト: row(1) + col(1) + score(4)）
var result_buffer: [128]u8 = .{0} ** 128;

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
///   absolute_time_limit_ms: 絶対時間制限（0=デフォルト10秒）
///   aspiration_mode: 0=固定[75], 1=[75,200,500]
export fn findBestMove(color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32, absolute_time_limit_ms: u32, aspiration_mode: u8) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            writeResult(15, 15, 0, 0, null, 0);
            return;
        },
    };

    const cells = &board.board_cells;

    const result = search.findBestMoveIterative(cells, cell_color, .{
        .max_depth = max_depth,
        .time_limit = time_limit_ms,
        .max_nodes = max_nodes,
        .absolute_time_limit = if (absolute_time_limit_ms == 0) 10000 else absolute_time_limit_ms,
        .aspiration_mode = aspiration_mode,
    });

    writeResult(result.position.row, result.position.col, result.score, result.completed_depth, &result.top_candidates, result.top_candidate_count);
}

/// TT をクリア
export fn ttClear() void {
    tt_mod.global_tt.clear();
}

const minimax = @import("minimax.zig");

fn writeResult(row: u8, col: u8, score: i32, completed_depth: u8, top_candidates: ?*const [5]minimax.MoveScoreEntry, top_candidate_count: u8) void {
    result_buffer[0] = row;
    result_buffer[1] = col;
    const score_bytes: [4]u8 = @bitCast(score);
    result_buffer[2] = score_bytes[0];
    result_buffer[3] = score_bytes[1];
    result_buffer[4] = score_bytes[2];
    result_buffer[5] = score_bytes[3];
    result_buffer[6] = completed_depth;
    result_buffer[7] = top_candidate_count;

    // 候補手リスト: offset 8 から、各6バイト（row + col + score_i32_le）
    if (top_candidates) |candidates| {
        for (0..top_candidate_count) |i| {
            const base = 8 + i * 6;
            result_buffer[base] = candidates[i].move.row;
            result_buffer[base + 1] = candidates[i].move.col;
            const c_score_bytes: [4]u8 = @bitCast(candidates[i].score);
            result_buffer[base + 2] = c_score_bytes[0];
            result_buffer[base + 3] = c_score_bytes[1];
            result_buffer[base + 4] = c_score_bytes[2];
            result_buffer[base + 5] = c_score_bytes[3];
        }
    }
}
