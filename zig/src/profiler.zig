/// 関数別プロファイラ（一時的な計測用）
///
/// 各関数の累積実行時間と呼出回数を記録する。
/// WASM freestanding 環境のため、タイムスタンプは外部（JS）から取得する。

pub const TimerId = enum(u8) {
    evaluate_board,
    scan_four_three,
    stone_patterns,
    gen_tactical_moves,
    gen_sorted_moves,
    quiescence,
    minimax,
    count, // 番兵
};

const TIMER_COUNT = @intFromEnum(TimerId.count);

var cumulative_us: [TIMER_COUNT]u64 = [_]u64{0} ** TIMER_COUNT;
var call_counts: [TIMER_COUNT]u64 = [_]u64{0} ** TIMER_COUNT;

extern fn getTimestampUsExternal() u32;

pub fn start() u32 {
    return getTimestampUsExternal();
}

pub fn stop(id: TimerId, start_time: u32) void {
    const end = getTimestampUsExternal();
    const elapsed: u32 = end -% start_time;
    const idx = @intFromEnum(id);
    cumulative_us[idx] += elapsed;
    call_counts[idx] += 1;
}

pub fn getCumulativeUs(id: TimerId) u64 {
    return cumulative_us[@intFromEnum(id)];
}

pub fn getCallCount(id: TimerId) u64 {
    return call_counts[@intFromEnum(id)];
}

/// u64 を上位/下位 u32 に分割して返す（WASM は i64 返却が困難なため）
pub fn getCumulativeUsLow(id: TimerId) u32 {
    return @truncate(cumulative_us[@intFromEnum(id)]);
}

pub fn getCumulativeUsHigh(id: TimerId) u32 {
    return @truncate(cumulative_us[@intFromEnum(id)] >> 32);
}

pub fn getCallCountLow(id: TimerId) u32 {
    return @truncate(call_counts[@intFromEnum(id)]);
}

pub fn getCallCountHigh(id: TimerId) u32 {
    return @truncate(call_counts[@intFromEnum(id)] >> 32);
}

pub fn reset() void {
    @memset(&cumulative_us, 0);
    @memset(&call_counts, 0);
}
