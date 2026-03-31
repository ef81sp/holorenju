/// Transposition Table（置換表）
///
/// 固定サイズハッシュテーブル。Map<bigint> ではなく [N]TTEntry。
/// TS版 transpositionTable.ts に対応

const board_mod = @import("board.zig");
const std = @import("std");

pub const Position = @import("threats.zig").Position;

/// TTエントリのスコアタイプ
pub const ScoreType = enum(u8) {
    exact = 0, // 正確な評価値
    lower_bound = 1, // 下限値（Beta cutoff）
    upper_bound = 2, // 上限値（Alpha cutoff）
};

/// Transposition Tableエントリ
pub const TTEntry = struct {
    hash: u64, // 衝突検出用
    score: i32,
    depth: i8,
    score_type: ScoreType,
    best_move_row: u8, // 255 = null
    best_move_col: u8, // 255 = null
    generation: u16,

    pub fn hasBestMove(self: *const TTEntry) bool {
        return self.best_move_row != 255;
    }

    pub fn getBestMove(self: *const TTEntry) ?Position {
        if (self.best_move_row == 255) return null;
        return .{ .row = self.best_move_row, .col = self.best_move_col };
    }
};

const EMPTY_ENTRY = TTEntry{
    .hash = 0,
    .score = 0,
    .depth = 0,
    .score_type = .exact,
    .best_move_row = 255,
    .best_move_col = 255,
    .generation = 0,
};

/// Transposition Table
/// 固定サイズの配列ベース。ハッシュの下位ビットでインデックス。
pub const TT_SIZE: u32 = 1 << 21; // 2M entries (~32MB)
const TT_MASK: u32 = TT_SIZE - 1;

pub const TranspositionTable = struct {
    entries: []TTEntry,
    current_generation: u16,

    pub fn init(allocator: std.mem.Allocator) !TranspositionTable {
        const entries = try allocator.alloc(TTEntry, TT_SIZE);
        @memset(entries, EMPTY_ENTRY);
        return .{
            .entries = entries,
            .current_generation = 0,
        };
    }

    pub fn deinit(self: *TranspositionTable, allocator: std.mem.Allocator) void {
        allocator.free(self.entries);
    }

    /// 世代を進める（新しい探索開始時）
    pub fn newGeneration(self: *TranspositionTable) void {
        self.current_generation +%= 1;
    }

    /// エントリを検索
    pub fn probe(self: *const TranspositionTable, hash: u64) ?*const TTEntry {
        const index = @as(u32, @intCast(hash & TT_MASK));
        const entry = &self.entries[index];
        if (entry.hash == hash and entry.hash != 0) {
            return entry;
        }
        return null;
    }

    /// エントリを保存
    pub fn store(
        self: *TranspositionTable,
        hash: u64,
        score_val: i32,
        depth: i8,
        score_type: ScoreType,
        best_move: ?Position,
    ) void {
        const index = @as(u32, @intCast(hash & TT_MASK));
        const existing = &self.entries[index];

        // 置換判定
        if (existing.hash != 0) {
            const should_replace =
                score_type == .exact or
                depth > existing.depth or
                (depth == existing.depth and
                score_type != .upper_bound and
                !(existing.score_type == .exact and
                existing.generation == self.current_generation)) or
                existing.generation + 2 <= self.current_generation;

            if (!should_replace) return;
        }

        self.entries[index] = .{
            .hash = hash,
            .score = score_val,
            .depth = depth,
            .score_type = score_type,
            .best_move_row = if (best_move) |m| m.row else 255,
            .best_move_col = if (best_move) |m| m.col else 255,
            .generation = self.current_generation,
        };
    }

    /// テーブルをクリア
    pub fn clear(self: *TranspositionTable) void {
        @memset(self.entries, EMPTY_ENTRY);
        self.current_generation = 0;
    }
};

/// WASM用: ページアロケータベースの TT（allocator 不要）
/// WASM では std.heap.page_allocator が使えるため、init 時にページを確保
pub var global_tt_storage: [TT_SIZE]TTEntry = [_]TTEntry{EMPTY_ENTRY} ** TT_SIZE;
pub var global_tt = TranspositionTable{
    .entries = &global_tt_storage,
    .current_generation = 0,
};

// === Tests ===

test "TT basic store and probe" {
    var tt = TranspositionTable{
        .entries = &global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    const hash: u64 = 0x123456789ABCDEF0;
    tt.store(hash, 100, 5, .exact, .{ .row = 7, .col = 7 });

    const entry = tt.probe(hash);
    try std.testing.expect(entry != null);
    try std.testing.expectEqual(entry.?.score, 100);
    try std.testing.expectEqual(entry.?.depth, 5);
    try std.testing.expectEqual(entry.?.score_type, .exact);
    try std.testing.expect(entry.?.hasBestMove());
    const bm = entry.?.getBestMove();
    try std.testing.expect(bm != null);
    try std.testing.expectEqual(bm.?.row, 7);
    try std.testing.expectEqual(bm.?.col, 7);
}

test "TT miss returns null" {
    var tt = TranspositionTable{
        .entries = &global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    const entry = tt.probe(0xDEADBEEF);
    try std.testing.expect(entry == null);
}

test "TT replacement policy: deeper replaces shallower" {
    var tt = TranspositionTable{
        .entries = &global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    const hash: u64 = 0xAAAABBBBCCCCDDDD;
    tt.store(hash, 50, 3, .lower_bound, null);
    tt.store(hash, 100, 5, .lower_bound, null);

    const entry = tt.probe(hash);
    try std.testing.expect(entry != null);
    try std.testing.expectEqual(entry.?.score, 100);
    try std.testing.expectEqual(entry.?.depth, 5);
}

test "TT generation replacement" {
    var tt = TranspositionTable{
        .entries = &global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    const hash: u64 = 0x1111222233334444;
    tt.store(hash, 50, 5, .exact, null);

    tt.newGeneration();
    tt.newGeneration();

    // Old generation entry should be replaced
    tt.store(hash, 100, 3, .lower_bound, null);
    const entry = tt.probe(hash);
    try std.testing.expect(entry != null);
    try std.testing.expectEqual(entry.?.score, 100);
}
