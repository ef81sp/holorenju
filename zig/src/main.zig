const std = @import("std");
const board = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const ft = @import("forced_win_tree.zig");
const jump_patterns = @import("jump_patterns.zig");
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

// --- eval 重み実行時注入（bench 専用。重みごとリビルド不要にする） ---
export fn setEvalParam(id: u32, value: i32) void {
    scores_mod.setEvalParam(id, value);
}
export fn getEvalParam(id: u32) i32 {
    return scores_mod.getEvalParam(id);
}
export fn resetEvalParams() void {
    scores_mod.resetEvalParams();
}
export fn getEvalParamName(id: u32) [*:0]const u8 {
    return scores_mod.getEvalParamName(id);
}
export fn wasmGetPatternType(count: u8, end1: u8, end2: u8) u8 {
    return patterns.wasmGetPatternType(count, end1, end2);
}

// === パリティテスト用 export（#21）===
// TS (renjuRules/patterns.ts, forbiddenMoves.ts) と Zig の連珠判定が一致することを
// CI で検証するためのオラクル。本番探索からは未使用。詳細: docs/plans/issue-21-forbidden-wasm.md
//
// 配置規約: 禁手判定は候補マスが「空き」の状態で呼ぶ（内部で黒を仮置きする）。
// パターン判定は候補マスに color を「配置済み」で呼ぶ（checkJumpFour が生 cells の
// 中心を same として読むため）。両規約を本関数内で吸収する。
//
// ビットレイアウト（u32）: dir d (0..3) が bit [d*6 .. d*6+5] を占有:
//   +0 four / +1 open4 / +2 open3 / +3 straightFour / +4 jumpFour / +5 jumpThree
// 禁手種別 (ForbiddenType 0..3, 黒のみ) は bit 24-25。
export fn classifyPointWasm(row: u8, col: u8, color: u8) u32 {
    const c: board.Cell = @enumFromInt(color);
    var bits: u32 = 0;

    // Phase A: 禁手（候補は空きのまま。黒のみ意味を持つ）
    if (color == 1) {
        const ftype = forbidden.checkForbiddenMove(&board.board_cells, row, col);
        bits |= @as(u32, @intFromEnum(ftype)) << 24;
    }

    // Phase B: パターン（候補を配置して評価し、最後に復元）
    const idx = @as(u16, row) * board.BOARD_SIZE + col;
    const original = board.board_cells[idx];
    board.board_cells[idx] = c;
    var dir: u8 = 0;
    while (dir < 4) : (dir += 1) {
        const op = jump_patterns.checkOpenPattern(&board.board_cells, row, col, dir, c);
        const sf = jump_patterns.checkStraightFour(&board.board_cells, row, col, dir, c);
        const jf = jump_patterns.checkJumpFour(&board.board_cells, row, col, dir, c);
        const jt = jump_patterns.checkJumpThree(&board.board_cells, row, col, dir, c);
        const b: u5 = @intCast(dir * 6);
        bits |= @as(u32, @intFromBool(op.four)) << b;
        bits |= @as(u32, @intFromBool(op.open4)) << (b + 1);
        bits |= @as(u32, @intFromBool(op.open3)) << (b + 2);
        bits |= @as(u32, @intFromBool(sf)) << (b + 3);
        bits |= @as(u32, @intFromBool(jf)) << (b + 4);
        bits |= @as(u32, @intFromBool(jt)) << (b + 5);
    }
    board.board_cells[idx] = original;
    return bits;
}

// 飛び三の達四点（0..1点）を返す。pack: bit0=found, bit8-15=row, bit16-23=col。
// getLine が中心を内部設定するため配置非依存。
export fn getJumpThreeStraightFourPointsWasm(row: u8, col: u8, dir_index: u8, color: u8) u32 {
    const c: board.Cell = @enumFromInt(color);
    const r = jump_patterns.getJumpThreeStraightFourPoints(&board.board_cells, row, col, dir_index, c);
    if (!r.found) return 0;
    return 1 | (@as(u32, r.point.row) << 8) | (@as(u32, r.point.col) << 16);
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
export fn findBestMove(color: u8, max_depth: u8, time_limit_ms: u32, max_nodes: u32, absolute_time_limit_ms: u32, aspiration_mode: u8, eval_options_flags: u32) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            writeResult(15, 15, 0, 0, null, 0);
            return;
        },
    };

    const cells = &board.board_cells;
    // bits 0-8: position_eval.EvalOptions（手の評価・ムーブオーダリング用）
    const eval_options = if (eval_options_flags == 0)
        position_eval.DEFAULT_EVAL_OPTIONS
    else
        position_eval.decodeEvalOptions(eval_options_flags);

    // bits 9-16: 葉評価 single_four_penalty_multiplier
    //   0   = 未指定 → デフォルト 100（ペナルティなし）
    //   255 = センチネル → 0（完全ペナルティ）
    //   1-254 = そのまま使用
    // bit 17: enable_leaf_mise
    const leaf_multiplier_raw: u8 = @intCast((eval_options_flags >> 9) & 0xFF);
    const leaf_multiplier: i32 = switch (leaf_multiplier_raw) {
        0 => 100,
        255 => 0,
        else => @as(i32, leaf_multiplier_raw),
    };
    const enable_leaf_mise = ((eval_options_flags >> 17) & 1) != 0;

    const board_eval_options = evaluate.EvalOptions{
        .enable_leaf_mise = enable_leaf_mise,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = leaf_multiplier,
        .connectivity_bonus = @import("scores.zig").CONNECTIVITY_BONUS,
    };

    const result = search.findBestMoveIterative(cells, cell_color, .{
        .max_depth = max_depth,
        .time_limit = time_limit_ms,
        .max_nodes = max_nodes,
        .absolute_time_limit = if (absolute_time_limit_ms == 0) 10000 else absolute_time_limit_ms,
        .aspiration_mode = aspiration_mode,
        .eval_options = eval_options,
        .board_eval_options = board_eval_options,
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

        // 脅威検証: 相手の脅威を無視する手は防御手に差し替え、防御不可なら打ち切り
        const validated = validatePVMove(cells, move.row, move.col, current_color) orelse break;

        // PVに追加（差し替え済みの手を使用）
        pv_buffer[1 + pv_len * 2] = validated.row;
        pv_buffer[1 + pv_len * 2 + 1] = validated.col;
        pv_len += 1;

        // 盤面更新（差し替え後の位置を使用）
        const validated_idx = @as(u16, validated.row) * board.BOARD_SIZE + validated.col;
        cells[validated_idx] = current_color;
        current_hash = zobrist.updateHash(current_hash, validated.row, validated.col, current_color);
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

const PVMove = struct { row: u8, col: u8 };

/// PV手の検証と必要に応じた差し替え
/// 五連が作れるか、相手の脅威を適切に処理しているかを検証。
/// TT手が脅威を止めない場合、止め四なら防御手に差し替え、防御不可なら null を返す。
fn validatePVMove(cells: []board.Cell, row: u8, col: u8, color: board.Cell) ?PVMove {
    // 五連が作れるなら常にOK
    cells[@as(u16, row) * board.BOARD_SIZE + col] = color;
    const is_five = forbidden.checkFive(cells, row, col, color);
    cells[@as(u16, row) * board.BOARD_SIZE + col] = .empty;
    if (is_five) return .{ .row = row, .col = col };

    const opponent = color.opposite();
    const threats = threats_mod.detectOpponentThreatsFromCells(cells, opponent);

    // 相手の活四がある場合: 防御不可（打ち切り）
    if (threats.open_fours.len > 0) {
        if (threats.open_fours.contains(row, col)) return .{ .row = row, .col = col };
        return null;
    }

    // 相手の止め四がある場合: TT手が防御していなければ防御手に差し替え
    if (threats.fours.len > 0) {
        if (threats.fours.contains(row, col)) return .{ .row = row, .col = col };
        // 防御位置が1つなら差し替え（複数四は防御不可）
        if (threats.fours.len == 1) {
            const defense = threats.fours.items[0];
            // 差し替え先が空いていることを確認
            if (cells[@as(u16, defense.row) * board.BOARD_SIZE + defense.col] == .empty) {
                return .{ .row = defense.row, .col = defense.col };
            }
        }
        return null;
    }

    // 相手の活三がある場合
    if (threats.open_threes.len > 0) {
        if (threats.open_threes.contains(row, col)) return .{ .row = row, .col = col };
        return null;
    }

    return .{ .row = row, .col = col };
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

// ─── 詰み木シリアライズ（#22 共通） ──────────────────────

/// 直列化スクラッチ（compact 済みの木の格納先）。表示用途の上限。
const MAX_SER_NODES: u16 = 1024;
const MAX_SER_DEFENSES: u16 = 2048;
var serialize_nodes: [MAX_SER_NODES]ft.TreeNode = undefined;
var serialize_defenses: [MAX_SER_DEFENSES]ft.TreeDefense = undefined;

/// 詰み木（アリーナ＋root）を buffer の start 位置から直列化する。
///
/// ワイヤ形式（little-endian u16）:
///   [start]      node_count    (u16 LE)
///   [start+2]    defense_count (u16 LE)
///   [start+4]    node_count × { row:u8, col:u8, defense_start:u16 LE, defense_count:u16 LE }  (6B)
///   [...]        defense_count × { row:u8, col:u8, child_node:u16 LE }                        (4B)
///   node[0] = root。child_node == 0xFFFF は終端（継続なし）。
///   node_count == 0 は木なし（TS 側は sequence から線形木を合成する）。
fn writeForcedWinTree(buffer: []u8, start: usize, arena: *const ft.Arena, root: u16) void {
    const r = ft.serializeCompact(arena, root, serialize_nodes[0..], serialize_defenses[0..]);
    std.mem.writeInt(u16, buffer[start..][0..2], r.node_count, .little);
    std.mem.writeInt(u16, buffer[start + 2 ..][0..2], r.defense_count, .little);
    var pos: usize = start + 4;
    for (0..r.node_count) |i| {
        const n = serialize_nodes[i];
        buffer[pos] = n.attacker.row;
        buffer[pos + 1] = n.attacker.col;
        std.mem.writeInt(u16, buffer[pos + 2 ..][0..2], n.defense_start, .little);
        std.mem.writeInt(u16, buffer[pos + 4 ..][0..2], n.defense_count, .little);
        pos += 6;
    }
    for (0..r.defense_count) |i| {
        const d = serialize_defenses[i];
        buffer[pos] = d.defender.row;
        buffer[pos + 1] = d.defender.col;
        std.mem.writeInt(u16, buffer[pos + 2 ..][0..2], d.child_node, .little);
        pos += 4;
    }
}

// ─── Mise-VCF Sequence ──────────────────────────────────

const mise_vcf = @import("mise_vcf.zig");

/// Mise-VCF手順バッファ（VCT同様、詰み木を含むため大きめ）
/// フォーマットは vct_seq_buffer と同一（writeVCTResult / writeForcedWinTree 参照）:
/// [0] found, [1] seq_len, [2] isForbiddenTrap, [3..] sequence row/col ペア,
/// その後 writeForcedWinTree の木セクション。
var mise_vcf_seq_buffer: [16384]u8 = .{0} ** 16384;

export fn getMiseVCFSequenceBuffer() [*]u8 {
    return &mise_vcf_seq_buffer;
}

/// Mise-VCF手順を探索し結果を mise_vcf_seq_buffer に書き込む
export fn findMiseVCFSequenceWasm(color: u8, time_limit_ms: u32, max_nodes: u32, collect_branches: u8) void {
    const cell_color: board.Cell = switch (color) {
        1 => .black,
        2 => .white,
        else => {
            mise_vcf_seq_buffer[0] = 0;
            return;
        },
    };

    const cells = &board.board_cells;
    const result = mise_vcf.findMiseVCFSequence(cells, cell_color, time_limit_ms, max_nodes, collect_branches != 0);

    mise_vcf_seq_buffer[0] = if (result.found) 1 else 0;
    mise_vcf_seq_buffer[1] = result.len;
    mise_vcf_seq_buffer[2] = if (result.is_forbidden_trap) 1 else 0;

    if (result.found) {
        for (0..result.len) |i| {
            mise_vcf_seq_buffer[3 + i * 2] = result.sequence[i].row;
            mise_vcf_seq_buffer[3 + i * 2 + 1] = result.sequence[i].col;
        }

        // 詰み木（VCT と同一フォーマット、writeForcedWinTree 参照）
        const offset = 3 + @as(usize, result.len) * 2;
        writeForcedWinTree(mise_vcf_seq_buffer[0..], offset, &mise_vcf.g_tree_arena, result.tree_root);
    }
}

// ─── VCT Sequence ──────────────────────────────────────

const vct = @import("vct.zig");

/// VCT手順バッファ（詰み木を含むため大きめ）
/// [0]: found (0 or 1)
/// [1]: seq_len
/// [2]: isForbiddenTrap (0 or 1)
/// [3..3+seq_len*2]: row,col pairs (メインPV = 木の defenses[0] 連鎖)
/// offset = 3 + seq_len * 2 以降: writeForcedWinTree の木セクション
///   [offset] node_count(u16 LE), [offset+2] defense_count(u16 LE),
///   nodes(各6B), defenses(各4B)。詳細は writeForcedWinTree 参照。
var vct_seq_buffer: [16384]u8 = .{0} ** 16384;

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

        // 詰み木（writeForcedWinTree 参照）
        const offset = 3 + @as(usize, result.len) * 2;
        writeForcedWinTree(vct_seq_buffer[0..], offset, &vct.g_tree_arena, result.tree_root);
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
    // 振り返り(review)用エントリは攻めの追い詰め手順提示なので lenient（main 挙動）。
    const result = vct.findVCTSequence(cells, cell_color, max_depth, time_limit_ms, max_nodes, collect_branches != 0, .lenient);
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
