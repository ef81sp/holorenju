const board = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const patterns = @import("patterns.zig");
const search = @import("search.zig");
const position_eval = @import("position_eval.zig");
const scores_mod = @import("scores.zig");
const threats_mod = @import("threats.zig");
const tt_mod = @import("tt.zig");
const vcf = @import("vcf.zig");
const zobrist = @import("zobrist.zig");

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
    writeStats(result.stats);
}

/// 探索統計バッファ（12フィールド × u32 = 48バイト）
var stats_buffer: [48]u8 = .{0} ** 48;

export fn getStatsBuffer() [*]u8 {
    return &stats_buffer;
}

fn writeStats(stats: minimax.SearchStats) void {
    const fields = [_]u32{
        stats.nodes,
        stats.tt_hits,
        stats.tt_cutoffs,
        stats.beta_cutoffs,
        stats.null_move_trials,
        stats.null_move_cutoffs,
        stats.futility_prunes,
        stats.threat_extensions,
        stats.lmr_trials,
        stats.lmr_researches,
        stats.q_search_nodes,
        stats.threat_probe_cutoffs,
    };
    for (fields, 0..) |val, i| {
        const bytes: [4]u8 = @bitCast(val);
        const base = i * 4;
        stats_buffer[base] = bytes[0];
        stats_buffer[base + 1] = bytes[1];
        stats_buffer[base + 2] = bytes[2];
        stats_buffer[base + 3] = bytes[3];
    }
}

/// TT をクリア
export fn ttClear() void {
    tt_mod.global_tt.clear();
}

const minimax = @import("minimax.zig");

// ─── PV抽出 ─────────────────────────────────────────

/// PV バッファ
/// [0]: pv_length
/// [1..]: (row, col) ペアの配列。最大31手
var pv_buffer: [64]u8 = .{0} ** 64;

export fn getResultPVBuffer() [*]u8 {
    return &pv_buffer;
}

/// 指定位置から TT の bestMove チェインを辿って PV を抽出
/// 呼び出し前に findBestMove が完了していること（TT にデータがある）
///
/// TT エントリの score_type（exact/lower_bound/upper_bound）によらず
/// best_move が記録されていればPVとして辿る。PVS+Aspiration Windows では
/// PV ライン上のノードも lower_bound/upper_bound で保存されることが多いため。
export fn extractPV(best_row: u8, best_col: u8, color: u8, max_len: u8) void {
    const cells = &board.board_cells;
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            pv_buffer[0] = 0;
            return;
        },
    };

    const effective_max: u8 = if (max_len > 31) 31 else max_len;
    var pv_len: u8 = 0;

    // 最初の手を書き込む
    const first_idx = @as(u16, best_row) * board.BOARD_SIZE + best_col;
    if (cells[first_idx] != .empty) {
        pv_buffer[0] = 0;
        return;
    }
    pv_buffer[1] = best_row;
    pv_buffer[2] = best_col;
    pv_len = 1;

    // 盤面に石を置いてハッシュを更新しながら TT を辿る
    cells[first_idx] = cell_color;
    var current_hash = zobrist.computeBoardHash(cells);
    var current_color = cell_color.opposite();

    var i: u8 = 1;
    while (i < effective_max) : (i += 1) {
        const entry = tt_mod.global_tt.probe(current_hash);
        if (entry == null) break;

        const best_move = entry.?.getBestMove();
        if (best_move == null) break;
        const move = best_move.?;

        // 盤面の有効性チェック
        const idx = @as(u16, move.row) * board.BOARD_SIZE + move.col;
        if (cells[idx] != .empty) break;

        // 脅威検証: 相手の脅威を無視する手でPVを打ち切り
        if (!isValidPVMoveZig(cells, move.row, move.col, current_color)) break;

        // PVに追加
        pv_buffer[1 + pv_len * 2] = move.row;
        pv_buffer[1 + pv_len * 2 + 1] = move.col;
        pv_len += 1;

        // 盤面更新
        cells[idx] = current_color;
        current_hash = zobrist.updateHash(current_hash, move.row, move.col, current_color);
        current_color = current_color.opposite();
    }

    pv_buffer[0] = pv_len;

    // 盤面を元に戻す（最初の手 + TT辿り分）
    cells[first_idx] = .empty;
    var j: u8 = 1;
    while (j < pv_len) : (j += 1) {
        const r = pv_buffer[1 + j * 2];
        const c = pv_buffer[1 + j * 2 + 1];
        cells[@as(u16, r) * board.BOARD_SIZE + c] = .empty;
    }
}

/// PV手の妥当性チェック（TS版 isValidPVMove の簡易版）
/// 五連が作れるか、相手の脅威を適切に処理しているかを検証
fn isValidPVMoveZig(cells: []board.Cell, row: u8, col: u8, color: board.Cell) bool {
    // 五連が作れるなら常にOK
    cells[@as(u16, row) * board.BOARD_SIZE + col] = color;
    const is_five = forbidden.checkFive(cells, row, col, color);
    cells[@as(u16, row) * board.BOARD_SIZE + col] = .empty;
    if (is_five) return true;

    const opponent = color.opposite();
    const threats = threats_mod.detectOpponentThreats(cells, opponent);

    // 相手の活四がある場合: 脅威位置を止めるかチェック
    if (threats.open_fours.len > 0) {
        return threats.open_fours.contains(row, col);
    }

    // 相手の止め四がある場合
    if (threats.fours.len > 0) {
        return threats.fours.contains(row, col);
    }

    // 相手の活三がある場合
    if (threats.open_threes.len > 0) {
        return threats.open_threes.contains(row, col);
    }

    return true;
}

// ─── VCF Sequence ──────────────────────────────────────

/// VCF手順バッファ
/// [0]: found (0 or 1)
/// [1]: sequence length
/// [2]: isForbiddenTrap (0 or 1)
/// [3..N*2+2]: row, col pairs
var vcf_seq_buffer: [256]u8 = .{0} ** 256;

export fn getVCFSequenceBuffer() [*]u8 {
    return &vcf_seq_buffer;
}

/// VCF手順全体を探索し結果を vcf_seq_buffer に書き込む
export fn findVCFSequenceWasm(color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            vcf_seq_buffer[0] = 0;
            return;
        },
    };

    const cells = &board.board_cells;
    const result = vcf.findVCFSequence(cells, cell_color, max_depth, time_limit_ms, max_nodes);

    vcf_seq_buffer[0] = if (result.found) 1 else 0;
    vcf_seq_buffer[1] = result.len;
    vcf_seq_buffer[2] = if (result.is_forbidden_trap) 1 else 0;

    if (result.found) {
        for (0..result.len) |i| {
            vcf_seq_buffer[3 + i * 2] = result.sequence[i].row;
            vcf_seq_buffer[3 + i * 2 + 1] = result.sequence[i].col;
        }
    }
}

/// 指定初手からのVCF手順を探索し結果を vcf_seq_buffer に書き込む
export fn findVCFSequenceFromFirstMoveWasm(row: u8, col: u8, color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            vcf_seq_buffer[0] = 0;
            return;
        },
    };

    const cells = &board.board_cells;
    const first_move = threats_mod.Position{ .row = row, .col = col };
    const result = vcf.findVCFSequenceFromFirstMove(cells, first_move, cell_color, max_depth, time_limit_ms, max_nodes);

    vcf_seq_buffer[0] = if (result.found) 1 else 0;
    vcf_seq_buffer[1] = result.len;
    vcf_seq_buffer[2] = if (result.is_forbidden_trap) 1 else 0;

    if (result.found) {
        for (0..result.len) |i| {
            vcf_seq_buffer[3 + i * 2] = result.sequence[i].row;
            vcf_seq_buffer[3 + i * 2 + 1] = result.sequence[i].col;
        }
    }
}

// ─── Mise-VCF Sequence ──────────────────────────────────

const mise_vcf = @import("mise_vcf.zig");

/// Mise-VCF手順バッファ
/// [0]: found (0 or 1)
/// [1]: sequence length
/// [2]: isForbiddenTrap (0 or 1)
/// [3..N*2+2]: row, col pairs
var mise_vcf_seq_buffer: [256]u8 = .{0} ** 256;

export fn getMiseVCFSequenceBuffer() [*]u8 {
    return &mise_vcf_seq_buffer;
}

/// Mise-VCF手順を探索し結果を mise_vcf_seq_buffer に書き込む
export fn findMiseVCFSequenceWasm(color: u8, time_limit_ms: u32, max_nodes: u32) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            mise_vcf_seq_buffer[0] = 0;
            return;
        },
    };

    const cells = &board.board_cells;
    const result = mise_vcf.findMiseVCFSequence(cells, cell_color, time_limit_ms, max_nodes);

    mise_vcf_seq_buffer[0] = if (result.found) 1 else 0;
    mise_vcf_seq_buffer[1] = result.len;
    mise_vcf_seq_buffer[2] = if (result.is_forbidden_trap) 1 else 0;

    if (result.found) {
        for (0..result.len) |i| {
            mise_vcf_seq_buffer[3 + i * 2] = result.sequence[i].row;
            mise_vcf_seq_buffer[3 + i * 2 + 1] = result.sequence[i].col;
        }
    }
}

// ─── VCT Sequence ──────────────────────────────────────

const vct = @import("vct.zig");

/// VCT手順バッファ（分岐情報を含むため大きめ）
/// [0]: found (0 or 1)
/// [1]: seq_len
/// [2]: isForbiddenTrap (0 or 1)
/// [3..3+seq_len*2]: row,col pairs (メインPV)
/// offset = 3 + seq_len * 2
/// [offset]: branch_count
/// [offset+1..]: 各branch:
///   [0]: defenseIndex (u8)
///   [1]: defRow
///   [2]: defCol
///   [3]: continuation_len
///   [4..4+cont_len*2]: continuation row,col pairs
var vct_seq_buffer: [2048]u8 = .{0} ** 2048;

export fn getVCTSequenceBuffer() [*]u8 {
    return &vct_seq_buffer;
}

/// VCTSequenceResult をバッファにシリアライズ
fn writeVCTResult(result: vct.VCTSequenceResult) void {
    vct_seq_buffer[0] = if (result.found) 1 else 0;
    vct_seq_buffer[1] = result.len;
    vct_seq_buffer[2] = if (result.is_forbidden_trap) 1 else 0;

    if (result.found) {
        for (0..result.len) |i| {
            vct_seq_buffer[3 + i * 2] = result.sequence[i].row;
            vct_seq_buffer[3 + i * 2 + 1] = result.sequence[i].col;
        }

        const offset = 3 + @as(usize, result.len) * 2;
        vct_seq_buffer[offset] = result.branch_count;

        var pos: usize = offset + 1;
        for (0..result.branch_count) |bi| {
            const branch = result.branches[bi];
            vct_seq_buffer[pos] = branch.defense_index;
            vct_seq_buffer[pos + 1] = branch.defense_move.row;
            vct_seq_buffer[pos + 2] = branch.defense_move.col;
            vct_seq_buffer[pos + 3] = branch.continuation_len;
            pos += 4;
            for (0..branch.continuation_len) |ci| {
                vct_seq_buffer[pos] = branch.continuation[ci].row;
                vct_seq_buffer[pos + 1] = branch.continuation[ci].col;
                pos += 2;
            }
        }
    }
}

/// VCT手順を探索し結果を vct_seq_buffer に書き込む
export fn findVCTSequenceWasm(color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32, collect_branches: u8) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            vct_seq_buffer[0] = 0;
            return;
        },
    };

    const cells = &board.board_cells;
    const result = vct.findVCTSequence(cells, cell_color, max_depth, time_limit_ms, max_nodes, collect_branches != 0);
    writeVCTResult(result);
}

/// 指定初手からのVCT手順を探索
export fn findVCTSequenceFromFirstMoveWasm(row: u8, col: u8, color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32, collect_branches: u8) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            vct_seq_buffer[0] = 0;
            return;
        },
    };

    const cells = &board.board_cells;
    const first_move = threats_mod.Position{ .row = row, .col = col };
    const result = vct.findVCTSequenceFromFirstMove(cells, first_move, cell_color, max_depth, time_limit_ms, max_nodes, collect_branches != 0);
    writeVCTResult(result);
}

/// 指定手がVCT開始手として有効かチェック
export fn isVCTFirstMoveWasm(row: u8, col: u8, color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32) u8 {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => return 0,
    };

    const cells = &board.board_cells;
    const move = threats_mod.Position{ .row = row, .col = col };
    return if (vct.isVCTFirstMove(cells, move, cell_color, max_depth, time_limit_ms, max_nodes)) 1 else 0;
}

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
