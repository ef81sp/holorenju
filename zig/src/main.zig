const board = @import("board.zig");
const evaluate = @import("evaluate.zig");
const patterns = @import("patterns.zig");

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
