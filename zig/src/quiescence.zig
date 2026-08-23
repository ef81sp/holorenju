/// Quiescence Search（静止探索）
///
/// 末端ノード（depth=0）で脅威手（四・ブロック）が未解決の場合、
/// これらを追加探索して「静止した状態」で評価する。
/// 水平線効果を軽減する。
/// TS版 quiescence.ts に対応
const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const incremental_eval = @import("incremental_eval.zig");
const ll = @import("line_lookup.zig");
const scores = @import("scores.zig");
const threats = @import("threats.zig");
const tt_mod = @import("tt.zig");
const zobrist = @import("zobrist.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;

pub const Position = @import("threats.zig").Position;

/// Quiescence Search の最大深度（四+ブロック 2往復分）
pub const MAX_QUIESCENCE_DEPTH: u8 = 4;

/// quiescence の打ち切り制御。
///
/// **設計方針（ハードウェア非依存の決定的強度）**:
/// 強さは「総ノード数」という決定的な予算で縛る。同じノード予算なら CPU 性能に依らず
/// 同じ着手＝強さが一定。これがハングの根治でもある（旧来 `max_nodes` は minimax ノードのみ
/// 計上し quiescence ノードを数えず、q探索が実質無制限になって暴走していた＝監査の欠陥C）。
///
/// **打ち切りポリシー（2層）**:
/// - ノード予算超過 → **ローカル**打ち切り（static eval 返却のみ・フラグは立てない）。
///   探索全体の停止確定は次の minimax ノード入口の `node_count_exceeded` 判定が担う。
/// - 壁時計超過 → 共有 `timeout_flag` をセット（時間切れはグローバル事象のため）。
///
/// **出荷構成での整理**: hard(timeLimit=10s, maxNodes=1M) では典型ハードで時間が先に
/// bind し、ノード予算は病的な q爆発を決定的に頭打ちにする安全網として効く。
/// 完全に決定的な強度（計測・リプレイ用途）は timeLimit=0 のノード予算のみで運用する。
///
/// - `node_counter`: 探索全体で共有する総ノードカウンタ（`ctx.stats.nodes` を指す）。
///   minimax ノードと quiescence ノードの両方をここに計上し、`max_nodes` で**決定的に**打ち切る。
/// - `max_nodes`: グローバル総ノード上限（0 = 無制限）。これが主たる打ち切り条件。
/// - `deadline` / `absolute_deadline` / `no_time_limit` / `timeout_flag`:
///   壁時計の**安全天井**（出荷時の応答性用）。`no_time_limit=true`（計測時）では一切効かず、
///   強度は純粋にノード予算のみで決まる＝再現可能・ハードウェア非依存。
///   `no_time_limit` にデフォルトは与えない（設定し忘れで天井が黙って消えるのを防ぐ）。
pub const QLimits = struct {
    node_counter: *u32,
    max_nodes: u32 = 0,
    deadline: u32 = 0,
    absolute_deadline: u32 = 0,
    no_time_limit: bool,
    timeout_flag: *bool,
};

extern fn getTimestampMsExternal() u32;

/// 壁時計（ms）。ネイティブ（テスト）では 0 を返し時間制限なし。
fn getTimestampMs() u32 {
    if (@import("builtin").cpu.arch == .wasm32) {
        return getTimestampMsExternal();
    }
    return 0;
}

/// 四を作るかチェック（石配置済み前提、bitboard も同期済み前提）
/// TS版 threatMoves.ts の createsFour に対応
///
/// 判定基準は `threats.isFourInDirection`（四判定の SSoT）に一本化されており、
/// `getFourDefensePosition` と同一の基準になる（issue #124）。
/// すなわち `createsFour(x) == true` ⇔ `getFourDefensePosition(x) != .not_four`。
pub fn createsFour(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    for (0..DIRECTIONS.len) |i| {
        if (threats.isFourInDirection(cells, row, col, i, color)) return true;
    }
    return false;
}

/// `getFourDefensePosition` の結果（issue #124 で 3 値化）
///
/// 以前は `?Position` で、`null` が「防御不可（活四）」と「そもそも四ではない」の
/// 両方を意味していた。`vcf.zig` は `null` を即勝ちとして扱うため、四の判定側が
/// 偽陽性を出すと「四ですらない手」で VCF が成立してしまっていた。
/// wasm export（`threat_wasm.getFourDefensePositionWasm`）で使う番兵。
/// 盤上の座標は `row * 15 + col` = 0..224 なので 254/255 と衝突しない。
pub const FOUR_DEFENSE_NOT_FOUR: u8 = 254;
pub const FOUR_DEFENSE_UNSTOPPABLE: u8 = 255;

/// 方向ごとの分類（`threats.FourClass`）と同じ 3 値。issue #134 で 1 つの型に統一した。
/// - `not_four`: どの方向でも四になっていない（五点 0 個）。脅威ではない。
/// - `unstoppable`: 四だが受け点が 2 つ以上ある ＝ 活四。1 手では止められない。
/// - `block`: 止め四。この 1 点で受かる。
pub const FourDefense = threats.FourClass;

/// 四に対する防御位置を取得
/// 四は1点でしか止められないのでその位置を返す
/// 石配置済み前提、bitboard も同期済み前提。
/// TS版 threatPatterns.ts の getFourDefensePosition に対応
///
/// 連続四・跳び四を区別せず、方向ごとの分類（`threats.classifyFourInDirection`
/// ＝ 四判定・受け点の SSoT・issue #134）を 4 方向で畳み込む。
/// - `.not_four`: この方向は四ではない（黒の長連にしかならない四）→ 無視
/// - `.unstoppable`: 両方は塞げない ＝ 活四（防御不可）→ 即返す
/// - `.block`: 止め四。その点が受け（複数方向あれば最初の 1 点）
/// - どの方向も四でなかった → `.not_four`
///
/// issue #115: 以前は跳び四で `findJumpGapPosition` の返り値を検証せずに
/// 使っていたため、同一ライン上に長連ギャップと正当なギャップが併存すると
/// 長連ギャップ（＝五にできない点）を受けとして返していた。
///
/// issue #124: 戻り値を 3 値化し、「四ではない」と「防御不可」を区別した。
/// `createsFour` も同じ基準（`threats.isFourInDirection`）に統一してあるので
/// 両者は常に整合する。
pub fn getFourDefensePosition(cells: []const Cell, last_row: u8, last_col: u8, color: Cell) FourDefense {
    var first_defense: ?Position = null;

    for (0..DIRECTIONS.len) |i| {
        const result = ll.queryPatternByCell(last_row, last_col, i, color);
        switch (threats.classifyFourInDirection(cells, last_row, last_col, i, color, result, null)) {
            .not_four => {},
            .unstoppable => return .unstoppable,
            .block => |p| if (first_defense == null) {
                first_defense = p;
            },
        }
    }

    if (first_defense) |p| return .{ .block = p };
    return .not_four;
}

/// 相手の四に対する「強制ブロック」の判定結果（issue #142）
///
/// 以前は `generateTacticalMoves` が「受け 1 点」と「受けなし」を同じ
/// `count == 0 / 1` に潰していたため、**黒の受け点が禁手で打てない**ケースが
/// 「脅威手なし＝静止した局面」として stand-pat で評価されていた。
/// 実際には受けられない＝次に相手が五を作るので、その局面は現手番の負けである。
pub const ForcedBlock = union(enum) {
    /// 相手の直前手は四ではない（または活四で 1 点では受からない）→ 通常の四追いに進む
    none,
    /// 止め四。この 1 点で受かる（かつ攻め側がそこに打てる）
    block: Position,
    /// 止め四だが受け点が黒の禁手 → 受けられない＝現手番の負け
    forced_loss,
};

/// 相手の直前手が止め四のとき、その受けが打てるかを判定する（issue #142）
///
/// `color` は**受ける側（現手番）**の色。`last_move` は相手の直前手。
///
/// 黒は三三・四四・長連の点に打てないので、受け点が禁手なら黒には合法な受けが
/// 存在しない。連珠のルール上そこに打つことは「できない」（打てば反則負け）ので、
/// 受け点を打った局面を探索するのは誤り。`.forced_loss` を返して呼び出し側に
/// 終局として扱わせる。
///
/// 五連は禁手に優先するので、受け点が黒の五点でもある場合は打てる
/// （`forbidden.isPlayable` が `checkFive` を先に見る。`move_gen.zig` の
/// 黒番候補フィルタ・`vct.zig` の `blockIsPlayable` と同一の述語＝SSoT）。
///
/// `.unstoppable`（活四）は 1 点では受からないので `.none` を返し、従来どおり
/// (2) のカウンター四探索に落とす（issue #142 の対象外・挙動不変）。
pub fn forcedBlockOrLoss(cells: []Cell, color: Cell, last_move: ?Position) ForcedBlock {
    const lm = last_move orelse return .none;
    const defense_pos = getFourDefensePosition(cells, lm.row, lm.col, color.opposite());
    const dp = defense_pos.blockPos() orelse return .none;
    if (!forbidden.isPlayable(cells, dp.row, dp.col, color)) return .forced_loss;
    return .{ .block = dp };
}

/// 脅威手（四を作る手 + 相手の四へのブロック）を生成
///
/// `forced` は呼び出し側が `forcedBlockOrLoss` で 1 度だけ計算した結果を渡す
/// （`quiescenceSearch` は stand-pat の前に同じ判定が必要なので、ここで再計算すると
/// 1 ノードあたり `getFourDefensePosition` + 禁手判定が 2 回走ってしまう）。
/// `.forced_loss` は呼び出し側が終局として先に処理する想定なので、ここでは
/// 「合法な脅威手なし」＝ 0 を返す。
///
/// TS 側に静止探索の対応物は存在しない（探索本体は Zig 単一実装。TS の
/// `search/threatPatterns.ts` などは四の受け点プリミティブのみで、そちらは
/// `fourDefenseParity.wasm.test.ts` でパリティを取っている）。
pub fn generateTacticalMoves(
    cells: []Cell,
    color: Cell,
    forced: ForcedBlock,
    result_buf: *[225]Position,
) u16 {
    var count: u16 = 0;

    // 1. 相手の直前手が四を作っていれば → ブロック手のみ
    switch (forced) {
        .block => |dp| {
            result_buf[0] = dp;
            return 1;
        },
        // 受けられない（黒の禁手）→ 呼び出し側が終局として扱う。ここで四追いを
        // 続けると「受けずに自分の四で反撃できる」ことになり誤り。
        .forced_loss => return 0,
        .none => {},
    }

    // 2. 自分が四を作れる手を列挙
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 1);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // 仮配置してチェック（bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);
            const is_four = createsFour(cells, r, c, color);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (!is_four) continue;
            // 黒の禁手点は打てないので候補から外す（issue #142）。
            // `createsFour` は五点ベース（issue #124）なので長連だけの偽四は
            // すでに落ちている。ここで残るのは四四・四と三三の共存など。
            // コストは四候補にしか掛からない（大半の空点は `is_four == false`）。
            if (!forbidden.isPlayable(cells, r, c, color)) continue;

            result_buf[count] = .{ .row = r, .col = c };
            count += 1;
        }
    }
    return count;
}

/// 探索統計（quiescence用の軽量版）
pub const QSearchStats = struct {
    nodes: u32 = 0,
    q_search_nodes: u32 = 0,
};

/// Quiescence Search（静止探索）
///
/// depth=0 の末端ノードで、脅威手（四・ブロック）を追加探索し、
/// 「静止した状態」で evaluateBoard を呼ぶ。
pub fn quiescenceSearch(
    cells: []Cell,
    hash: u64,
    is_maximizing: bool,
    perspective: Cell,
    alpha_init: i32,
    beta_init: i32,
    last_move: ?Position,
    eval_options: evaluate.EvalOptions,
    q_depth: u8,
    stats: *QSearchStats,
    limits: QLimits,
    tt: *tt_mod.TranspositionTable,
) i32 {
    stats.nodes += 1;
    stats.q_search_nodes += 1;

    // TTプローブ
    const tt_entry = tt.probe(hash);
    if (tt_entry) |entry| {
        const current_tt_depth: i8 = -(@as(i8, @intCast(MAX_QUIESCENCE_DEPTH)) - @as(i8, @intCast(q_depth)) + 1);
        if (entry.depth >= current_tt_depth) {
            switch (entry.score_type) {
                .exact => return entry.score,
                .lower_bound => {
                    if (entry.score >= beta_init) return entry.score;
                },
                .upper_bound => {
                    if (entry.score <= alpha_init) return entry.score;
                },
            }
        }
    }

    // フィールドコピー（旧: 手動リテラル）ではなく eval_options を丸ごと引き継いで
    // last_mover_is_perspective だけ上書きする。これにより eval_basis 等の新規
    // フィールドが将来追加されても取りこぼさない（§3.3 の「手動コピーの罠」対応）。
    //
    // stm 供給ルール: ここは legacy/prospect どちらでも常時 is_maximizing から
    // last_mover_is_perspective を導出する（既存挙動、変更なし）。minimax.zig の
    // abortEvalOptions（打ち切り時の静的評価）は prospect のみ stm を供給し legacy は
    // .unset のまま――同じ「静的評価」でも呼び出し元によって stm 供給ルールが非対称な
    // ことに注意（minimax.zig の abortEvalOptions のコメント参照）。
    var eval_opts = eval_options;
    eval_opts.last_mover_is_perspective = if (!is_maximizing) .yes else .no;

    // 総ノード数を共有カウンタに計上（minimax と同じカウンタ）。
    limits.node_counter.* += 1;

    // 決定的ノード上限（主たる打ち切り条件・ハードウェア非依存）。
    // q探索ノードも総予算に計上されるため、密局面での q爆発が決定的に頭打ちになる。
    if (limits.max_nodes > 0 and limits.node_counter.* >= limits.max_nodes) {
        return incremental_eval.getEvaluation(cells, perspective, eval_opts);
    }

    // 壁時計の安全天井（出荷時の応答性用）。`no_time_limit` 時は無効＝計測は決定的。
    // 共有カウンタ基準なので部分木境界に依らず一定間隔で発火する（旧来の取りこぼしを修正）。
    if (!limits.no_time_limit and (limits.node_counter.* & 1023) == 0) {
        const now = getTimestampMs();
        const time_up = (limits.deadline > 0 and now >= limits.deadline) or
            (limits.absolute_deadline > 0 and now >= limits.absolute_deadline);
        if (time_up) {
            limits.timeout_flag.* = true;
        }
    }
    if (limits.timeout_flag.*) {
        return incremental_eval.getEvaluation(cells, perspective, eval_opts);
    }

    // 現在の手番
    const current_color = if (is_maximizing) perspective else perspective.opposite();

    // 終端条件: 相手の止め四に対する受けが黒の禁手 → 受けられない＝現手番の負け（issue #142）。
    //
    // stand-pat の**前**に置く。stand-pat は「何もしなければこの評価」という仮定だが、
    // ここでは「何もしない」ことが許されない（次に相手が五を作る）ので、静的評価より
    // 終局判定が優先される。スコア規約は `minimax.zig` の終端条件（五連完成）と同じで
    // perspective 基準・ply 補正なし。
    const forced = forcedBlockOrLoss(cells, current_color, last_move);
    if (forced == .forced_loss) {
        return if (current_color == perspective) -scores.FIVE else scores.FIVE;
    }

    // Stand-pat: 何もしない場合の評価（インクリメンタル評価を使用）
    const stand_pat = incremental_eval.getEvaluation(cells, perspective, eval_opts);

    var alpha = alpha_init;
    var beta = beta_init;

    // Alpha-beta cutoff（stand-pat）
    if (is_maximizing) {
        if (stand_pat >= beta) return beta;
        if (stand_pat > alpha) alpha = stand_pat;
    } else {
        if (stand_pat <= alpha) return alpha;
        if (stand_pat < beta) beta = stand_pat;
    }

    // 深度制限
    if (q_depth == 0) {
        return stand_pat;
    }

    // 脅威手生成（`forced` は stand-pat 前に計算済みのものを再利用する）
    var move_buf: [225]Position = undefined;
    const move_count = generateTacticalMoves(cells, current_color, forced, &move_buf);

    if (move_count == 0) {
        return stand_pat;
    }

    var best_score = stand_pat;
    var aborted = false;

    for (0..move_count) |mi| {
        const move = move_buf[mi];

        // 石を配置（cells, bitboard, incremental eval_state を同期更新）
        incremental_eval.placeStone(cells, move.row, move.col, current_color);
        const new_hash = zobrist.updateHash(hash, move.row, move.col, current_color);

        const score = quiescenceSearch(
            cells,
            new_hash,
            !is_maximizing,
            perspective,
            alpha,
            beta,
            move,
            eval_options,
            q_depth - 1,
            stats,
            limits,
            tt,
        );

        // 石を除去
        incremental_eval.removeStone(cells, move.row, move.col);

        // 打ち切り（ノード予算/時間切れ）が起きたら弟ノードの走査も止める。
        // これがないと打切り後も幅方向の走査が続き「眠い崩壊」で予算を大きく超過する。
        if (limits.timeout_flag.* or
            (limits.max_nodes > 0 and limits.node_counter.* >= limits.max_nodes))
        {
            aborted = true;
            break;
        }

        // Alpha-beta更新
        if (is_maximizing) {
            if (score > best_score) best_score = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
        } else {
            if (score < best_score) best_score = score;
            if (score < beta) beta = score;
            if (alpha >= beta) break;
        }
    }

    // 打ち切り時は不完全な best_score を TT に書かない（TT汚染防止）。
    if (aborted) {
        return best_score;
    }

    // TT保存: 負の可変depthで本探索と分離
    const tt_depth: i8 = -(@as(i8, @intCast(MAX_QUIESCENCE_DEPTH)) - @as(i8, @intCast(q_depth)) + 1);
    const score_type: tt_mod.ScoreType = if (best_score <= alpha_init) .upper_bound else if (best_score >= beta_init) .lower_bound else .exact;
    tt.store(hash, best_score, tt_depth, score_type, null);

    return best_score;
}

// === Tests ===

test "createsFour detects consecutive four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 横に3石: (7,5),(7,6),(7,7) + (7,8) に置くと四
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み
    bitboard.initFromCells(&cells);

    try std.testing.expect(createsFour(&cells, 7, 8, .black));
}

test "getFourDefensePosition finds defense for consecutive four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 止め四: (7,5),(7,6),(7,7),(7,8) で片端を白で塞ぐ
    cells[7 * BOARD_SIZE + 4] = .white; // 左端を塞ぐ
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getFourDefensePosition(&cells, 7, 8, .black);
    // 防御位置は (7,9) のみ
    try std.testing.expectEqual(Position{ .row = 7, .col = 9 }, defense.blockPos().?);
}

test "getFourDefensePosition returns unstoppable for open four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 活四: 両端空き → 防御不可能
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getFourDefensePosition(&cells, 7, 8, .black);
    try std.testing.expectEqual(FourDefense.unstoppable, defense);
}

test "generateTacticalMoves finds four moves" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 横に3石
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var buf: [225]Position = undefined;
    const count = generateTacticalMoves(&cells, .black, .none, &buf);
    // (7,4) と (7,8) が四を作る
    try std.testing.expect(count >= 2);
}

// --- issue #142: 静止探索の黒禁手フィルタ ---

/// 候補列に指定の点が含まれるか
fn containsMove(buf: []const Position, count: u16, row: u8, col: u8) bool {
    for (buf[0..count]) |m| {
        if (m.row == row and m.col == col) return true;
    }
    return false;
}

/// 黒が (7,7) に打つと縦と斜めの二方向で四になる（＝四四の禁手点）配置。
///
/// - 縦: (4,7) (5,7) (6,7) ＋ (7,7) → 四
/// - 斜め ↘: (4,4) (5,5) (6,6) ＋ (7,7) → 四
///
/// どちらも「4 石 + 空 1」の窓が 1 セットしかない（＝各方向 1 つの四）ので
/// 合計 2 つの四 ＝ 四四。五連にはならない。
fn setupBlackDoubleFourAt77(cells: []Cell) void {
    cells[4 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[4 * BOARD_SIZE + 4] = .black;
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[6 * BOARD_SIZE + 6] = .black;
}

/// 白の止め四 (7,3)-(7,6)（(7,2) は黒で塞がれている）＝受けは (7,7) の 1 点のみ。
fn setupWhiteBlockedFourRow7(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 2] = .black; // 左端を塞ぐ
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
}

const test_eval_options = evaluate.EvalOptions{
    .enable_leaf_mise = false,
    .last_mover_is_perspective = .unset,
    .single_four_penalty_multiplier = 100,
    .connectivity_bonus = scores.CONNECTIVITY_BONUS,
};

/// テスト用に quiescenceSearch を黒視点・黒手番で走らせる
fn runQuiescenceAsBlack(cells: []Cell, last_move: ?Position) i32 {
    incremental_eval.initFromBoard(cells, .{
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        .single_four_penalty_multiplier = 100,
    });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    return quiescenceSearch(
        cells,
        0,
        true, // is_maximizing（黒視点の黒手番）
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        last_move,
        test_eval_options,
        MAX_QUIESCENCE_DEPTH,
        &stats,
        .{ .node_counter = &node_counter, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
}

test "issue #142: 白の止め四の受け点が黒の四四なら受けられない＝黒の負け" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupWhiteBlockedFourRow7(&cells);
    setupBlackDoubleFourAt77(&cells);
    bitboard.initFromCells(&cells);

    // 前提の確認: 受けは (7,7) の 1 点で、そこは黒の禁手（四四）
    try std.testing.expectEqual(
        Position{ .row = 7, .col = 7 },
        getFourDefensePosition(&cells, 7, 6, .white).blockPos().?,
    );
    try std.testing.expect(!forbidden.checkFive(&cells, 7, 7, .black));
    try std.testing.expect(forbidden.checkForbiddenMove(&cells, 7, 7) != .none);

    try std.testing.expectEqual(ForcedBlock.forced_loss, forcedBlockOrLoss(&cells, .black, .{ .row = 7, .col = 6 }));

    // 受けられない＝次に白が五。黒視点・黒手番なので -FIVE。
    try std.testing.expectEqual(-scores.FIVE, runQuiescenceAsBlack(&cells, .{ .row = 7, .col = 6 }));
}

test "issue #142: 受け点が黒の五点なら禁手でも打てる（五が禁手に優先）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupWhiteBlockedFourRow7(&cells);
    // (7,7) は縦 (3,7)-(6,7) の五点。加えて斜め 2 方向で四を作る（＝五連が無ければ四四）。
    cells[3 * BOARD_SIZE + 7] = .black;
    cells[4 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    cells[4 * BOARD_SIZE + 4] = .black; // ↘ の三
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[6 * BOARD_SIZE + 6] = .black;
    cells[4 * BOARD_SIZE + 10] = .black; // ↙ の三
    cells[5 * BOARD_SIZE + 9] = .black;
    cells[6 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    // 前提: (7,7) は黒の五点（＝禁手判定は .none に落ちる）
    try std.testing.expect(forbidden.checkFive(&cells, 7, 7, .black));

    const forced = forcedBlockOrLoss(&cells, .black, .{ .row = 7, .col = 6 });
    try std.testing.expectEqual(Position{ .row = 7, .col = 7 }, forced.block);

    var buf: [225]Position = undefined;
    try std.testing.expectEqual(@as(u16, 1), generateTacticalMoves(&cells, .black, forced, &buf));
    try std.testing.expectEqual(Position{ .row = 7, .col = 7 }, buf[0]);

    // 受けられる＝負け確定ではない（黒は受けて五を作れる）
    try std.testing.expect(runQuiescenceAsBlack(&cells, .{ .row = 7, .col = 6 }) > -scores.FIVE);
}

test "issue #142: 黒の四四点は四候補から除外される（白は除外しない）" {
    ll.init();
    var buf: [225]Position = undefined;

    // 黒: (7,7) は四を作るが四四の禁手 → 候補に含まれない
    var black_cells = [_]Cell{.empty} ** CELL_COUNT;
    setupBlackDoubleFourAt77(&black_cells);
    bitboard.initFromCells(&black_cells);
    // 前提: (7,7) は四を作る点（＝フィルタが無ければ候補に入る）だが禁手
    black_cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.placeStone(7, 7, .black);
    const black_is_four = createsFour(&black_cells, 7, 7, .black);
    black_cells[7 * BOARD_SIZE + 7] = .empty;
    bitboard.removeStone(7, 7);
    try std.testing.expect(black_is_four);
    try std.testing.expectEqual(forbidden.ForbiddenType.double_four, forbidden.checkForbiddenMove(&black_cells, 7, 7));

    const black_count = generateTacticalMoves(&black_cells, .black, .none, &buf);
    try std.testing.expect(!containsMove(&buf, black_count, 7, 7));

    // 白: 同じ形でも白に禁手は無いので候補に含まれる
    var white_cells = [_]Cell{.empty} ** CELL_COUNT;
    setupBlackDoubleFourAt77(&white_cells);
    for (&white_cells) |*cell| {
        if (cell.* == .black) cell.* = .white;
    }
    bitboard.initFromCells(&white_cells);

    const white_count = generateTacticalMoves(&white_cells, .white, .none, &buf);
    try std.testing.expect(containsMove(&buf, white_count, 7, 7));
}

test "quiescenceSearch stand-pat on empty" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    const score = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        },
        MAX_QUIESCENCE_DEPTH,
        &stats,
        .{ .node_counter = &node_counter, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
    try std.testing.expectEqual(score, 0);
}

/// 戦術手のある局面を作る（黒が四を複数作れる）。返り値は手番色。
fn setupTacticalPosition(cells: *[CELL_COUNT]Cell) void {
    @memset(cells, .empty);
    // 横3連 (7,3)(7,4)(7,5) → (7,2)/(7,6) で四
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    // 縦3連 (5,8)(6,8)(7,8) → (4,8)/(8,8) で四
    cells[5 * BOARD_SIZE + 8] = .black;
    cells[6 * BOARD_SIZE + 8] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(cells);
}

test "quiescenceSearch: 総ノード上限=1 は最初の1ノードで打ち切る" {
    ll.init();
    var cells: [CELL_COUNT]Cell = undefined;
    setupTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    _ = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        },
        MAX_QUIESCENCE_DEPTH,
        &stats,
        .{ .node_counter = &node_counter, .max_nodes = 1, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
    // 総ノード上限=1 → ルートノードのみ訪問して即打ち切り。再帰しない。
    try std.testing.expectEqual(@as(u32, 1), stats.nodes);
    try std.testing.expectEqual(@as(u32, 1), node_counter);
    // ノード上限による打ち切りはグローバル flag を立てない（時間切れではない）。
    try std.testing.expectEqual(false, timeout_flag);
}

test "quiescenceSearch: 既定上限では戦術局面で再帰する（>1ノード）" {
    ll.init();
    var cells: [CELL_COUNT]Cell = undefined;
    setupTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var stats = QSearchStats{};
    var timeout_flag = false;
    var node_counter: u32 = 0;
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };
    tt.clear();

    _ = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        .{
            .enable_leaf_mise = false,
            .last_mover_is_perspective = .unset,
            .single_four_penalty_multiplier = 100,
            .connectivity_bonus = scores.CONNECTIVITY_BONUS,
        },
        MAX_QUIESCENCE_DEPTH,
        &stats,
        .{ .node_counter = &node_counter, .no_time_limit = true, .timeout_flag = &timeout_flag },
        &tt,
    );
    // 四が作れる戦術局面なので脅威手を展開して複数ノード訪問する。
    try std.testing.expect(stats.nodes > 1);
}

/// 密な戦術局面を作る（黒の独立した三×4本 → 四を作る手が8つ、
/// 四→受け→四… の連鎖で q木が大きく育つ）。木の途中打切りテスト用。
fn setupDenseTacticalPosition(cells: *[CELL_COUNT]Cell) void {
    @memset(cells, .empty);
    const rows = [_]u8{ 2, 5, 8, 11 };
    for (rows) |r| {
        cells[@as(u16, r) * BOARD_SIZE + 3] = .black;
        cells[@as(u16, r) * BOARD_SIZE + 4] = .black;
        cells[@as(u16, r) * BOARD_SIZE + 5] = .black;
    }
    bitboard.initFromCells(cells);
}

test "quiescenceSearch: 木の途中でノード予算が尽きても安全に巻き戻り早期停止する" {
    ll.init();
    var cells: [CELL_COUNT]Cell = undefined;
    setupDenseTacticalPosition(&cells);
    incremental_eval.initFromBoard(&cells, .{ .connectivity_bonus = scores.CONNECTIVITY_BONUS, .single_four_penalty_multiplier = 100 });
    var tt = tt_mod.TranspositionTable{
        .entries = &tt_mod.global_tt_storage,
        .current_generation = 0,
    };

    const eval_options = evaluate.EvalOptions{
        .enable_leaf_mise = false,
        .last_mover_is_perspective = .unset,
        .single_four_penalty_multiplier = 100,
        .connectivity_bonus = scores.CONNECTIVITY_BONUS,
    };

    // 無制限で全木サイズを測る
    tt.clear();
    var stats_full = QSearchStats{};
    var timeout_full = false;
    var counter_full: u32 = 0;
    _ = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        eval_options,
        MAX_QUIESCENCE_DEPTH,
        &stats_full,
        .{ .node_counter = &counter_full, .no_time_limit = true, .timeout_flag = &timeout_full },
        &tt,
    );
    // 前提: 戦術局面で木がある程度広がる（広がらないなら局面を強化すべき）
    try std.testing.expect(counter_full > 8);

    // 半分の予算で再帰の途中から打ち切られ、全木より早く停止すること
    tt.clear();
    var stats_cap = QSearchStats{};
    var timeout_cap = false;
    var counter_cap: u32 = 0;
    const cap = counter_full / 2;
    _ = quiescenceSearch(
        &cells,
        0,
        true,
        .black,
        -scores.INFINITY,
        scores.INFINITY,
        null,
        eval_options,
        MAX_QUIESCENCE_DEPTH,
        &stats_cap,
        .{ .node_counter = &counter_cap, .max_nodes = cap, .no_time_limit = true, .timeout_flag = &timeout_cap },
        &tt,
    );
    // 予算には到達した（cap未満で終わる＝打切り経路を踏んでいないテストを防ぐ）
    try std.testing.expect(counter_cap >= cap);
    // 巻き戻り中の弟ノード訪問分は超過しうるが、全木探索よりは確実に少ない
    try std.testing.expect(counter_cap < counter_full);
    // ノード予算打切りはローカル: グローバル flag は立てない
    try std.testing.expectEqual(false, timeout_cap);
}

test "getFourDefensePosition: black four with overline should not be open four" {
    ll.init();
    // C8-D8-E8-F8-(空G8)-H8(黒) の配置
    // row=7 (0-indexed), C=2, D=3, E=4, F=5, G=6(empty), H=7
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .black; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    // G8 (7*15+6) = empty
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    bitboard.initFromCells(&cells);

    // E8を基準に四判定: C8-D8-E8-F8 は四だが、G8方向はoverlineで塞がり
    // → 活四ではなく止め四（B8で防御可能）→ .unstoppable ではなく B8 を返すべき
    const defense = getFourDefensePosition(&cells, 7, 4, .black);
    try std.testing.expectEqual(Position{ .row = 7, .col = 1 }, defense.blockPos().?); // B8
}

/// issue #115 の局面（左下原点・黒先手）
///
/// 実戦 14 手 "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9" +
/// "L7 M6 L8 L6 J7 M10" + "K7 M7 N8 O8 J8"
/// 8 行目は G8 H8 _ J8 K8 L8 _ N8（黒）/ O8（白）。
/// I8 を埋めると G8..L8 の 6 連＝長連、M8 を埋めると J8..N8 の五。本物の受けは M8。
fn setupIssue115FourGapPosition(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[8 * BOARD_SIZE + 7] = .white; // H7
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[5 * BOARD_SIZE + 8] = .black; // I10
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[6 * BOARD_SIZE + 9] = .black; // J9
    cells[5 * BOARD_SIZE + 9] = .white; // J10
    cells[7 * BOARD_SIZE + 10] = .black; // K8
    cells[4 * BOARD_SIZE + 7] = .white; // H11
    cells[6 * BOARD_SIZE + 11] = .black; // L9
    cells[6 * BOARD_SIZE + 10] = .white; // K9
    cells[4 * BOARD_SIZE + 8] = .black; // I11
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 11] = .black; // L7
    cells[9 * BOARD_SIZE + 12] = .white; // M6
    cells[7 * BOARD_SIZE + 11] = .black; // L8
    cells[9 * BOARD_SIZE + 11] = .white; // L6
    cells[8 * BOARD_SIZE + 9] = .black; // J7
    cells[5 * BOARD_SIZE + 12] = .white; // M10
    cells[8 * BOARD_SIZE + 10] = .black; // K7
    cells[8 * BOARD_SIZE + 12] = .white; // M7
    cells[7 * BOARD_SIZE + 13] = .black; // N8
    cells[7 * BOARD_SIZE + 14] = .white; // O8
    cells[7 * BOARD_SIZE + 9] = .black; // J8
}

test "getFourDefensePosition: 長連ギャップではなく五になるギャップを返す（issue #115）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue115FourGapPosition(&cells);
    bitboard.initFromCells(&cells);

    // J8 は本物の四（M8 側の跳び四）。受けは M8 であって I8 ではない。
    const defense = getFourDefensePosition(&cells, 7, 9, .black);
    try std.testing.expectEqual(Position{ .row = 7, .col = 12 }, defense.blockPos().?); // M8
}

test "getFourDefensePosition: 白の _XXXX_ で片端の先が白でも活四（防御不可）" {
    ll.init();
    // C8-D8-E8-F8-(空G8)-H8(白)。白に長連の制限は無いので G8 を埋めると 6 連＝五。
    // B8 も五点なので五点は 2 つ＝活四＝防御不可（黒の同形との対比）。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .white; // C8
    cells[7 * BOARD_SIZE + 3] = .white; // D8
    cells[7 * BOARD_SIZE + 4] = .white; // E8
    cells[7 * BOARD_SIZE + 5] = .white; // F8
    cells[7 * BOARD_SIZE + 7] = .white; // H8
    bitboard.initFromCells(&cells);

    try std.testing.expectEqual(FourDefense.unstoppable, getFourDefensePosition(&cells, 7, 4, .white));
}

/// issue #124 の局面（8 行目・左下原点・黒番）
///
/// `A8白 B8白 C8黒 D8黒 E8黒 F8空 G8空 H8黒 I8空 J8黒 K8空 L8白`
/// 黒が G8 に打つと `W W B B B _ B B _ B _ W`。
/// F8 を埋めると C8..H8 の 6 連＝長連、I8 を埋めても 4 連にしかならないので
/// 黒の五点はゼロ ＝ **四ですらない**。
/// 旧実装は `findJumpFourGap` が「最も近いギャップ」I8 だけを見て長連判定を素通りし、
/// `createsFour=true` かつ受け点 0 個 → `null` → 偽 VCF になっていた。
fn setupIssue124FalseFourPosition(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 0] = .white; // A8
    cells[7 * BOARD_SIZE + 1] = .white; // B8
    cells[7 * BOARD_SIZE + 2] = .black; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    // F8 (5) / G8 (6) は空
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    // I8 (8) は空
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    // K8 (10) は空
    cells[7 * BOARD_SIZE + 11] = .white; // L8
}

test "createsFour: 五点が 0 個なら四ではない（issue #124）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue124FalseFourPosition(&cells);
    cells[7 * BOARD_SIZE + 6] = .black; // G8 に着手
    bitboard.initFromCells(&cells);

    try std.testing.expect(!createsFour(&cells, 7, 6, .black));
    try std.testing.expectEqual(FourDefense.not_four, getFourDefensePosition(&cells, 7, 6, .black));
}

test "createsFour と getFourDefensePosition は同一基準（不変条件）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue124FalseFourPosition(&cells);

    // ライン上の空点すべてに黒/白を仮置きし、四判定と受け点判定が食い違わないことを確認
    for (0..BOARD_SIZE) |c_usize| {
        const c: u8 = @intCast(c_usize);
        const idx = 7 * BOARD_SIZE + @as(u16, c);
        if (cells[idx] != .empty) continue;
        for ([_]Cell{ .black, .white }) |color| {
            cells[idx] = color;
            bitboard.initFromCells(&cells);
            const is_four = createsFour(&cells, 7, c, color);
            const defense = getFourDefensePosition(&cells, 7, c, color);
            try std.testing.expectEqual(is_four, defense != .not_four);
            cells[idx] = .empty;
        }
    }
}
