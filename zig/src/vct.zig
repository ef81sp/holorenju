/// VCT（Victory by Continuous Threats）探索
///
/// 四と活三を含む脅威手を連続して打つことで勝利する手順を探索する。
/// VCFより広い脅威（活三を含む）を扱う。
/// TS版 vct.ts + vctHelpers.ts + threatMoves.ts + threatPatterns.ts に対応
const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const deadline = @import("deadline.zig");
const evaluate = @import("evaluate.zig");
const forbidden = @import("forbidden.zig");
const ft = @import("forced_win_tree.zig");
const jp = @import("jump_patterns.zig");
const ll = @import("line_lookup.zig");
const patterns = @import("patterns.zig");
const quiescence = @import("quiescence.zig");
const scores = @import("scores.zig");
const threats = @import("threats.zig");
const vcf_mod = @import("vcf.zig");
const std = @import("std");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;
const DIRECTIONS = board_mod.DIRECTIONS;
const Position = threats.Position;
const PositionList = threats.PositionList;
const TimeLimiter = vcf_mod.TimeLimiter;

/// VCT探索の最大深度
pub const VCT_MAX_DEPTH: u8 = 5;

/// VCT探索の時間制限（ミリ秒）
pub const VCT_TIME_LIMIT: u32 = 300;

/// 事前探索 VCT のノード予算（決定的モード。時間モードでは `VCT_TIME_LIMIT` のみ）
///
/// 設計メモ docs/plans/bench-fixed-nodes-2026-09-06.md §2.1。時間定数の隣に置く
/// （較正で片方だけ直す事故を防ぐ）。**未較正**の初期値。較正は §4 手順 1。
pub const VCT_PRE_NODES_DETERMINISTIC: u32 = 40_000;

/// ct=three 時のVCF深度上限
const CT_THREE_VCF_MAX_DEPTH: u8 = 6;

// =============================================================================
// 脅威分類（TS版 threatMoves.ts の classifyThreat に対応）
// =============================================================================

pub const ThreatClassification = struct {
    creates_four: bool,
    creates_open_three: bool,
};

/// 指定位置に石を置くと四/活三ができるかを1パスで判定
/// 石は配置済み前提
pub fn classifyThreat(cells: []const Cell, row: u8, col: u8, color: Cell) ThreatClassification {
    var has_four = false;
    var has_open_three = false;

    for (0..4) |i| {
        const result = ll.queryPatternByCell(row, col, i, color);

        // 四（連続四・跳び四とも `threats.isFourInDirection` に一本化・issue #124）。
        // 「あと 1 手で五にできる点がその方向にある」が四の定義であり、
        // 受け点（`collectLineFivePoints`）と同一基準になる。
        if (!has_four and threats.isFourInDirectionWithPattern(cells, row, col, i, color, result)) {
            has_four = true;
        }

        // 連続活三
        // 夏止め済み（両外側ブロックで活四にできない三）は脅威でないため除外。
        // 受け点の基準（getOpenThreeDefensePositions: 空リスト=夏止め済み）と揃え、
        // 「受けが要る三＝本物の脅威」で意味を一致させる（SSoT）。
        if (!has_open_three and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const open_three_def = threats.getOpenThreeDefensePositions(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, color);
            has_open_three = open_three_def.len > 0;
        }

        // 跳び三
        if (!has_open_three and result.count != 3 and result.has_jump_three) {
            has_open_three = true;
        }

        if (has_four and has_open_three) break;
    }

    return .{ .creates_four = has_four, .creates_open_three = has_open_three };
}

/// 活三ができるかチェック（石配置済み前提）
pub fn createsOpenThree(cells: []const Cell, row: u8, col: u8, color: Cell) bool {
    _ = cells;
    for (0..4) |i| {
        const result = ll.queryPatternByCell(row, col, i, color);

        // 連続活三
        if (result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            return true;
        }

        // 跳び三
        if (result.count != 3 and result.has_jump_three) {
            return true;
        }
    }
    return false;
}

// issue #130: `isThreat`（= `classifyThreat` の四 or 活三）は削除した。
// 唯一の用途が `getThreatDefensePositions` の `len == 0` を「防御不可」と
// 「そもそも脅威でない」に切り分けるガードで、その分岐は戻り値の 3 値化
// （`ThreatDefense`）に吸収されたため、呼び出し元がゼロになった。
// 脅威の有無が要るなら `classifyThreat` を直接使うこと。

// =============================================================================
// hasOpenThree（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 指定色が活三を持っているかチェック
///
/// 注: `isValidConsecutiveThree`（黒のウソ三除外）が仮置きのため cells は非 const。
/// 呼び出し前後で内容は変わらない。
pub fn hasOpenThree(cells: []Cell, color: Cell) bool {
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            if (cellAt(cells, @intCast(row), @intCast(col)) != color) continue;

            for (0..4) |i| {
                const result = ll.queryPatternByCell(row, col, i, color);

                // 連続活三（本物の四の一部は除外＝より強い脅威として別扱い）
                //
                // issue #121: 除外条件に LUT の `has_jump_four` をそのまま使うと、
                // 窓（中心 ±4）の外の自石でギャップ埋めが長連になる黒の形まで四扱いされ、
                // 三の検出が握り潰されていた。四かどうかは盤面を見る
                // `threats.isFourInDirection`（五点の列挙）に委ねる。
                //
                // あわせて黒のウソの三（達四にできない三）も除外する。偽の四が外れた分、
                // 「四でも三でもない」形が活三として流入してしまうため。
                // TS `vctHelpers.isConsecutiveOpenThree` と同じガード。
                if (result.count == 3 and result.end1 == 0 and result.end2 == 0) {
                    if (!threats.isFourInDirectionWithPattern(cells, row, col, i, color, result) and
                        (color != .black or
                            patterns.isValidConsecutiveThree(cells, row, col, jp.DIRECTION_INDICES[i], color)))
                    {
                        return true;
                    }
                }

                // 跳び三（黒はウソの三を除外）
                if (result.count != 3 and result.has_jump_three and
                    (color != .black or
                        patterns.isValidJumpThree(cells, row, col, jp.DIRECTION_INDICES[i], color)))
                {
                    return true;
                }
            }
        }
    }
    return false;
}

// =============================================================================
// hasFourThreeAvailable（TS版 vctHelpers.ts に対応）
// =============================================================================

/// 指定色がミセ手（1手で四三を作れる手）を持っているかチェック
pub fn hasFourThreeAvailable(cells: []Cell, color: Cell) bool {
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const row: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const col: u8 = @intCast(c_usize);
            const idx = @as(u16, row) * BOARD_SIZE + col;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, row, col)) continue;

            // 先に四三判定 → 成立した点だけ禁手確認（意味論は同値、黒での全空点
            // checkForbiddenMove を避けて 16〜22µs → 数µs に短縮）
            if (!evaluate.createsFourThree(cells, row, col, color)) continue;

            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, row, col);
                if (fr != .none) continue;
            }

            return true;
        }
    }
    return false;
}

// =============================================================================
// opponentBlocksThreePursuit
// =============================================================================

/// 相手が「三の追いを許さない脅威」（活三 or 1手四三＝ミセ手）を持つか
///
/// これが真なら、攻撃側の次の一手は四/五でなければならない。三で追っても
/// 相手は受けずに活四・四三を先行させられるため、手順が崩壊する。
/// 安いほうの hasOpenThree を先に評価して短絡する。
pub fn opponentBlocksThreePursuit(cells: []Cell, opponent: Cell) bool {
    return hasOpenThree(cells, opponent) or hasFourThreeAvailable(cells, opponent);
}

/// 相手 VCF プローブを実行するノード深さの上限（issue #118）
///
/// 全ノードで hasVCF を回すとコストが跳ねるため、根に近いノードだけに限定する。
/// 深いノードは「相手の受け手が四を作る」ケースを checkDefenseCounterThreat が
/// `.four` で拾うため、取りこぼしは「受け手の静かな石が別筋の四追いの起点になる」
/// ケースに限られる。
///
/// **実効カバレッジ**: `findVCTSequenceRecursive` は depth 0 をエントリの
/// フル深度チェックに任せるので、実際にプローブが走るのは**再帰深さ 1 の 1 層だけ**。
/// `hasVCT` はエントリガードを持たない公開 API なので depth 0 でも走る。
/// また反復深化（対局 4 回・振り返り 5 回）のイテレーション数が総コストに乗る。
const OPPONENT_VCF_PROBE_MAX_NODE_DEPTH: u8 = 1;

/// 相手 VCF プローブの探索深度上限（VCF_MAX_DEPTH=8 に対し浅く打ち切る）
const OPPONENT_VCF_PROBE_DEPTH: u8 = 4;

/// 相手 VCF プローブのノード数上限（コストが跳ねないための保険）
const OPPONENT_VCF_PROBE_MAX_NODES: u32 = 1000;

/// `opponentBlocksThreePursuit` にノード深さ依存の「浅い相手 VCF」を足した版（issue #118）
///
/// 相手が VCF（四追いの強制勝ち）を持つなら、攻撃側の三は必ず先に潰される
/// ＝三で追ってはいけない。意味論は #116 と同じ「三の攻め手のみ不可、四は継続」。
/// ただし hasVCF は活三/ミセ手判定よりずっと重いので、
/// - ノード深さ `OPPONENT_VCF_PROBE_MAX_NODE_DEPTH` 以下
/// - 深度 `OPPONENT_VCF_PROBE_DEPTH` / ノード数 `OPPONENT_VCF_PROBE_MAX_NODES` で打ち切り
/// - 三の攻め手に入る直前の遅延評価（呼び出し側）
/// の3重の制限をかける。安い述語を先に評価して短絡する。
///
/// プローブは呼び出し元 `limiter` の残り時間を継承し（`TimeLimiter.child` が SSoT。
/// issue #147 B）、消費ノードは呼び出し元へ加算する（#119 の部分払い）。
fn opponentBlocksThreePursuitWithShallowVCF(
    cells: []Cell,
    opponent: Cell,
    node_depth: u8,
    limiter: *TimeLimiter,
) bool {
    if (opponentBlocksThreePursuit(cells, opponent)) return true;
    if (node_depth > OPPONENT_VCF_PROBE_MAX_NODE_DEPTH) return false;

    var probe_limiter = limiter.child(0, OPPONENT_VCF_PROBE_MAX_NODES);
    const found = vcf_mod.hasVCF(cells, opponent, 0, &probe_limiter, OPPONENT_VCF_PROBE_DEPTH);
    limiter.charge(probe_limiter.nodes);
    return found;
}

/// エントリ（探索開始局面）用の相手脅威チェック
///
/// 開始局面は一度しか評価しないので、活三/ミセ手に加えてフル深度の VCF まで見る。
/// 真なら「三では追えない」＝VCF-only にフォールバックする（呼び出し側の責務）。
fn opponentBlocksThreePursuitAtRoot(cells: []Cell, opponent: Cell, limiter: *TimeLimiter) bool {
    return opponentBlocksThreePursuit(cells, opponent) or
        vcf_mod.hasVCF(cells, opponent, 0, limiter, vcf_mod.VCF_MAX_DEPTH);
}

// =============================================================================
// findThreatMoves（TS版 vctHelpers.ts に対応）
// =============================================================================

/// findThreatMovesCounted の結果（四の本数と総数）
pub const ThreatMoveCounts = struct {
    /// 列挙された脅威手の総数
    total: u16,
    /// うち四を作る手の本数。buf の先頭 four_count 個が四、残りが活三。
    four_count: u16,
};

/// 脅威（四・活三）を作れる位置を列挙（四を優先）
pub fn findThreatMoves(cells: []Cell, color: Cell, buf: *[225]Position) u16 {
    return findThreatMovesCounted(cells, color, buf).total;
}

/// findThreatMoves の四/活三の内訳付き版
///
/// buf は「四 → 活三」の順に詰められる。四の本数を返すことで、呼び出し側は
/// 「三の攻め手に入る直前」を検出できる（opponentBlocksThreePursuit の遅延評価用）。
pub fn findThreatMovesCounted(cells: []Cell, color: Cell, buf: *[225]Position) ThreatMoveCounts {
    var four_count: u16 = 0;
    var three_count: u16 = 0;
    // 四は前から、活三は後ろから格納
    var three_buf: [225]Position = undefined;
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            // インプレースで仮配置（bitboard も同期）
            cells[idx] = color;
            bitboard.placeStone(r, c, color);

            // 五連が作れる場合は最優先
            if (forbidden.checkFive(cells, r, c, color)) {
                cells[idx] = .empty;
                bitboard.removeStone(r, c);
                buf[four_count] = .{ .row = r, .col = c };
                four_count += 1;
                continue;
            }

            // 四と活三を1パスで判定
            const threat = classifyThreat(cells, r, c, color);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (!threat.creates_four and !threat.creates_open_three) continue;

            // 禁手チェック
            if (color == .black) {
                const fr = forbidden.checkForbiddenMove(cells, r, c);
                if (fr != .none) continue;
            }

            if (threat.creates_four) {
                buf[four_count] = .{ .row = r, .col = c };
                four_count += 1;
            } else {
                three_buf[three_count] = .{ .row = r, .col = c };
                three_count += 1;
            }
        }
    }

    // 活三を四の後ろに追加
    for (0..three_count) |i| {
        buf[four_count + i] = three_buf[i];
    }

    return .{ .total = four_count + three_count, .four_count = four_count };
}

// =============================================================================
// getThreatDefensePositions（TS版 vctHelpers.ts に対応）
// =============================================================================

// issue #134: `addJumpFourDefensePositions`（`collectLineFivePoints` の薄いラッパ）は
// 呼び出し元ゼロだったため削除した。四の分類・受け点は
// `threats.classifyFourInDirection`（SSoT）に一本化されている。

/// `getThreatDefensePositions` の結果（issue #130 で 3 値化）
///
/// 以前は `PositionList` を返し、`len == 0` が
/// 「防御不可（活四）＝攻撃側の勝ち」と「そもそも脅威ではない」の両方を意味していた。
/// 呼び出し側はいずれも `isThreat`（= `classifyThreat` 4 方向）を**もう一度**走らせて
/// 前者だけを勝ちに倒していたが、ガードを付け忘れると静かに偽 VCT になる形だった
/// （#124 のレビューで 2 箇所の付け忘れが見つかっている）。
///
/// 3 値にしたことで
/// - 呼び出し側は網羅 switch で `no_threat` を必ず明示的に扱う（勝ちにできない）
/// - `isThreat` の再計算が不要（脅威の有無は列挙の過程で分かっている）
///
/// `quiescence.FourDefense`（= `threats.FourClass`）の VCT 版にあたる。
pub const ThreatDefense = union(enum) {
    /// 四でも活三でもない ＝ そもそも脅威が成立していない。
    /// `isThreat(cells, row, col, color) == false` と同値。
    no_threat,
    /// 脅威はあるが 1 手では受からない（活四など）＝ 攻撃側の勝ち。
    unstoppable,
    /// 受け点（1 点以上）。
    positions: PositionList,
};

/// 脅威（四・活三・跳び三）に対する防御位置を列挙する
pub fn getThreatDefensePositions(cells: []const Cell, row: u8, col: u8, color: Cell) ThreatDefense {
    var defense_positions = PositionList.init();
    // 脅威（四 or 活三 or 跳び三）が成立したか。判定基準は `classifyThreat`（= `isThreat`）と
    // 同一（四: `classifyFourInDirection`、連続三: 受け点が 1 点以上、跳び三: LUT）。
    var has_threat = false;

    for (DIRECTIONS, 0..) |dir, i| {
        const result = ll.queryPatternByCell(row, col, i, color);

        // 四（連続四・跳び四）の受け点（issue #115 / #124 / #134）
        //
        // 分類は `threats.classifyFourInDirection`（四判定・受け点の SSoT）に委ねる。
        // 分類側（`classifyThreat` / `checkDefenseCounterThreat` = `isFourInDirection`）と
        // 同じ定義を見るので、「四と分類したのに受け 0 点」が構造的に起きない。
        //
        // - `.unstoppable`（五点 2 個以上）: 両方は塞げない＝活四 → 防御不可
        // - `.block`（五点 1 個）: 止め四。その 1 点が受け
        // - `.not_four`（五点 0 個）: この方向は四ではない（黒の長連にしかならない）
        //   → 四扱いをやめ、下の活三/跳び三ブランチで受けを広く列挙する
        //     （受けが広がる＝防御側に有利な健全側に倒す）
        //
        // 旧実装は連続四を端の開き（`isOverlineEnd`）で、跳び四を
        // 「最も近いギャップ 1 つ」（`isJumpFourOverline`）で見ており、
        // 同一ライン上に長連ギャップと本物の五点が併存すると四ブランチごと落ちて
        // 受け 0 点になっていた（#124 レビュー指摘）。
        var has_four = false;
        switch (threats.classifyFourInDirection(cells, row, col, i, color, result, null)) {
            // 活四 = 防御不可
            .unstoppable => return .unstoppable,
            .block => |p| {
                defense_positions.addUnique(p);
                has_four = true;
                has_threat = true;
            },
            .not_four => {},
        }

        // 活三をチェック（同方向に四がある場合は不要：四の防御が優先）
        // 両端＋夏止め位置を返す getOpenThreeDefensePositions を使用（getLineEnds は両端のみで不足）
        // 空リスト = 夏止め済み（活四にできない）＝ 脅威ではない、という基準は
        // `classifyThreat` / `checkDefenseCounterThreat` と共有している。
        if (!has_four and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const open_three_def = threats.getOpenThreeDefensePositions(cells, row, col, dir.dr, dir.dc, color);
            if (open_three_def.len > 0) has_threat = true;
            for (0..open_three_def.len) |j| {
                defense_positions.addUnique(open_three_def.items[j]);
            }
        }

        // 跳び三をチェック
        if (result.count != 3 and result.has_jump_three) {
            has_threat = true;
            const jump_defense = threats.getJumpThreeDefensePositions(cells, row, col, dir.dr, dir.dc, color);
            for (0..jump_defense.len) |j| {
                defense_positions.addUnique(jump_defense.items[j]);
            }
        }
    }

    if (!has_threat) return .no_threat;
    // 「脅威はあるのに受け点が 1 つも出せない」ケースは、4 方向 × 88 ライン × 3 オフセット ×
    // 3^9 × 両色の全列挙で**到達不能**であることを確認済み（PR #139 レビュー）。
    // ここに到達したら跳び三の判定（LUT の `has_jump_three`）と受け列挙
    // （`getJumpThreeDefensePositions`）が食い違っているということなので、
    // 保守側（＝旧実装の `len == 0` + `isThreat` ガードと同じ「防御不可」）に倒す。
    if (defense_positions.len == 0) return .unstoppable;
    return .{ .positions = defense_positions };
}

// =============================================================================
// checkDefenseCounterThreat（TS版 threatPatterns.ts に対応）
// =============================================================================

pub const CounterThreat = enum {
    win,
    four,
    three,
    none,
};

/// 防御手のカウンター脅威をチェック
pub fn checkDefenseCounterThreat(cells: []const Cell, row: u8, col: u8, opponent_color: Cell) CounterThreat {
    // 五連チェック
    if (forbidden.checkFive(cells, row, col, opponent_color)) {
        return .win;
    }

    var has_three = false;
    for (0..4) |i| {
        const result = ll.queryPatternByCell(row, col, i, opponent_color);

        // 四（連続四・跳び四とも `threats.isFourInDirection` に一本化・issue #124）。
        // ここを `getFourDefensePosition` と同一基準にしておかないと、
        // 「.four と分類されたのに受け点が 0 個」という不整合が VCT の
        // 保守側フォールバックを踏み続ける。
        if (threats.isFourInDirectionWithPattern(cells, row, col, i, opponent_color, result)) {
            return .four;
        }

        // 連続活三
        // 夏止め済み（両外側ブロックで活四にできない三）は本物のカウンター脅威でないため除外。
        // 受け点の基準（getOpenThreeDefensePositions: 空リスト=夏止め済み）と揃える（classifyThreat と同基準）。
        if (!has_three and result.count == 3 and result.end1 == 0 and result.end2 == 0) {
            const open_three_def = threats.getOpenThreeDefensePositions(cells, row, col, DIRECTIONS[i].dr, DIRECTIONS[i].dc, opponent_color);
            has_three = open_three_def.len > 0;
        }

        // 跳び三
        if (!has_three and result.count != 3 and result.has_jump_three) {
            has_three = true;
        }
    }

    return if (has_three) .three else .none;
}

/// ブロック石が攻撃継続に必要な脅威を持つか判定
fn blockHasThreat(ct: CounterThreat) bool {
    return ct != .none;
}

/// カウンター四をブロックした石で攻撃を継続できるか判定（issue #117）
///
/// 呼び出し元は `classifyBlock` だけ（issue #145 で分岐を集約した）。
/// TS 側 `src/logic/cpu/search/vctValidation.ts` の `blockThreatContinues` と
/// 同じ意味論（脅威系は二重実装。どちらかを変えたら必ず両方直すこと）。
///
/// `cells` はブロック石を配置済みの局面、`opponent` は受け手の色。
/// - `.none`: そもそも脅威なし → 継続不可
/// - `.win` / `.four`: 受けは強制 → 継続可（追加チェック不要＝コスト最小）
/// - `.three`: 受け手に受ける義務はない。受け手が活三/ミセ手、または（根に近い
///   ノードでは）VCF を持つなら、受け手はブロックの三を無視して達四・四三・
///   四追いを先行させられるので手順は崩壊する
///   （#116 の「三の攻め手のみ不可、四は継続」と同じ意味論。issue #118 の
///   浅い VCF プローブもここに掛かる＝`.three` のときだけなのでコストは小さい）。
fn blockThreatContinues(
    ct: CounterThreat,
    cells: []Cell,
    opponent: Cell,
    node_depth: u8,
    limiter: *TimeLimiter,
) bool {
    if (!blockHasThreat(ct)) return false;
    if (ct != .three) return true;
    return !opponentBlocksThreePursuitWithShallowVCF(cells, opponent, node_depth, limiter);
}

/// 攻め側がブロック点に実際に打てるか（issue #146）
///
/// 受け手のカウンター四をブロックする点は、攻め側が黒のとき禁手（三三 / 四四 / 長連）で
/// あり得る。そこには打てない＝相手の四を止められない＝その筋の VCT は不成立。
/// 受け手の防御点 `dp` 側は以前から `forbidden.checkForbiddenMove` を見ていたので、
/// この関数は攻め側の非対称を解消するもの。
///
/// 五連を作る点は禁手に優先して勝ちなので `checkFive` で先に許可する
/// （`minimax.zig` の遅延禁手判定と同じ順序）。
///
/// 長連になる点は従来 `checkDefenseCounterThreat` が `.none` を返すことで
/// **偶然**弾かれていた（長連方向は五として数えられない）。ここで明示的に弾く。
///
/// **ブロック石を置く前**（対象が空点のうち）に呼ぶこと。
/// `checkForbiddenMove` は空でないマスに対しては `.none` を返す。
///
/// 判定そのものは `forbidden.isPlayable`（「打てる点か」の SSoT）に委譲する。
/// 同じ述語を `move_gen` の候補生成と `quiescence`（issue #142）も使う。
fn blockIsPlayable(cells: []Cell, bp: Position, color: Cell) bool {
    return forbidden.isPlayable(cells, bp.row, bp.col, color);
}

/// カウンター四をブロックしたあとの分岐（issue #145）
pub const BlockOutcome = enum {
    /// ブロックできない（禁手 / 脅威なし / 三しか作らず受け手に反撃がある）＝この筋は不成立
    stop,
    /// ブロック石が五連 → その場で勝ち。受けの列挙に進まない（issue #140）
    win_now,
    /// 受け（`processBlockDefenses` / `processBlockDefensesSeq`）の列挙に進む
    continue_search,
};

/// カウンター四をブロックしたあとの分岐を 1 箇所に集約する（issue #145）
///
/// `block_ct` を計算していた 4 箇所（`evaluateCounterThreat` / `findVCTSequenceRecursive` /
/// `buildBlockDefSubSequence` / `findVCTSequenceFromFirstMove`）が同じ 3 分岐を手で
/// 書き下していたため、#117 / #130 / #140 / #146 がいずれも「4 箇所同時編集」になっていた。
/// 呼び出し元は網羅 `switch` で 3 値を受けるだけになり、直し漏れが構造的に起きない。
///
/// TS 側 `src/logic/cpu/search/vctValidation.ts` の `classifyBlock` と 1 対 1
/// （脅威系は二重実装。どちらかを変えたら必ず両方直すこと）。
///
/// `cells` はブロック点 `bp` が**空のまま**の局面を渡すこと
/// （禁手判定は空点でしかできない）。判定のあいだだけブロック石を置いて外すので、
/// 戻ったときの `cells` / bitboard は呼び出し前と同一。`continue_search` を返したときだけ、
/// 呼び出し元がブロック石を置き直して受けの列挙に進む。
///
/// `processBlockDefenses(Seq)` の `no_threat` が到達不能である根拠
/// （`.none` は `stop`、`.win` は `win_now` でここを通らない）も、この関数 1 つに閉じた。
fn classifyBlock(
    cells: []Cell,
    bp: Position,
    color: Cell,
    node_depth: u8,
    limiter: *TimeLimiter,
) BlockOutcome {
    // 攻め側が黒でブロック点が禁手 → そこには打てない＝四を止められない（issue #146）
    if (!blockIsPlayable(cells, bp, color)) return .stop;

    const idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
    cells[idx] = color;
    bitboard.placeStone(bp.row, bp.col, color);
    defer {
        cells[idx] = .empty;
        bitboard.removeStone(bp.row, bp.col);
    }

    const ct = checkDefenseCounterThreat(cells, bp.row, bp.col, color);
    // 五連は受けを列挙するまでもなく勝ち（issue #140）。
    // `blockThreatContinues` より前に見る（`.win` は無条件継続なので結果は同じ・
    // 呼び出しコストも省ける。TS 側 `vctValidation.ts` と位置を揃えてある）。
    if (ct == .win) return .win_now;
    // 脅威なし / 三しか作らず受け手が活三・ミセ手・浅い VCF を持つ（issue #117 / #118）
    if (!blockThreatContinues(ct, cells, color.opposite(), node_depth, limiter)) return .stop;
    return .continue_search;
}

// =============================================================================
// カウンターフォー耐性検証（TS版 vctValidation.ts に対応）
//
// VCT手順を見つけても、相手は防御位置ではなくカウンターフォー（任意の四を作る手）
// で応じる可能性がある。我々の活三を打った後で相手にカウンターフォーがあると、
// 速度負けで手順が崩壊する（活三＝5を作るのに2手 vs カウンターフォー＝5を作るのに1手）。
//
// この検証は findVCTSequence の事後処理として実行する。
// =============================================================================

/// 白に三三または四四の勝ち手があるかスキャン（CF+ブロック後の脅威判定用）
fn hasDoubleThreeForWhite(cells: []Cell) bool {
    const near_mask = threats.computeNearMask(threats.computeOccupiedRows(cells), 2);
    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;
            if (!threats.isNearFromMask(near_mask, r, c)) continue;

            cells[idx] = .white;
            bitboard.placeStone(r, c, .white);
            const winning = threats.checkWhiteWinningPattern(cells, r, c);
            cells[idx] = .empty;
            bitboard.removeStone(r, c);

            if (winning) return true;
        }
    }
    return false;
}

/// CF+ブロック配置下で残りの手順の防御 ct 値が破壊的に変化するか検査
///
/// TS版 checkSequenceBreaksByCF を拡張: 防御配置後に相手が活三/ミセ手を持つ場合、
/// 次の攻撃手が四/五でなければ手順が崩壊する。
/// （カウンターフォーで相手に間接的に活三/ミセ手が生まれるケースを検出する）
fn checkSequenceBreaksByCF(
    cells: []Cell,
    color: Cell,
    sequence: []const Position,
    start_index: usize,
) bool {
    const opponent = color.opposite();

    var placed_buf: [64]Position = undefined;
    var placed_len: usize = 0;

    var breaks = false;
    var i: usize = start_index;
    while (i < sequence.len) : (i += 1) {
        const pos = sequence[i];
        const idx = @as(u16, pos.row) * BOARD_SIZE + pos.col;

        // CF/ブロックが占有済みの位置はスキップ（lenient方向）
        if (cells[idx] != .empty) continue;

        const is_defense = (i % 2) == 1;
        const stone_color: Cell = if (is_defense) opponent else color;

        cells[idx] = stone_color;
        bitboard.placeStone(pos.row, pos.col, stone_color);
        placed_buf[placed_len] = pos;
        placed_len += 1;

        if (is_defense) {
            const ct = checkDefenseCounterThreat(cells, pos.row, pos.col, opponent);
            if (ct == .win) {
                breaks = true;
                break;
            }
            if (ct == .four) {
                // .not_four / .unstoppable いずれも「この筋は追えない」＝保守側（#124）
                const four_block_pos = quiescence.getFourDefensePosition(cells, pos.row, pos.col, opponent).blockPos();
                if (four_block_pos == null) {
                    breaks = true;
                    break;
                }
                const fbp = four_block_pos.?;
                const next_idx = i + 1;
                if (next_idx >= sequence.len) {
                    breaks = true;
                    break;
                }
                const next_pos = sequence[next_idx];
                if (next_pos.row != fbp.row or next_pos.col != fbp.col) {
                    breaks = true;
                    break;
                }
                continue;
            }

            // 相手の活三/ミセ手チェック: 次の攻撃手が四/五でなければ手順崩壊
            if (opponentBlocksThreePursuit(cells, opponent)) {
                const next_idx = i + 1;
                if (next_idx >= sequence.len) {
                    breaks = true;
                    break;
                }
                const next_pos = sequence[next_idx];
                const n_idx = @as(u16, next_pos.row) * BOARD_SIZE + next_pos.col;
                if (cells[n_idx] != .empty) {
                    // CF/ブロックと衝突 → 手順崩壊
                    breaks = true;
                    break;
                }
                cells[n_idx] = color;
                bitboard.placeStone(next_pos.row, next_pos.col, color);
                const makes_five = forbidden.checkFive(cells, next_pos.row, next_pos.col, color);
                const makes_four = quiescence.createsFour(cells, next_pos.row, next_pos.col, color);
                cells[n_idx] = .empty;
                bitboard.removeStone(next_pos.row, next_pos.col);
                if (!makes_five and !makes_four) {
                    breaks = true;
                    break;
                }
            }
        }
    }

    // 盤面を元に戻す
    var j: usize = placed_len;
    while (j > 0) {
        j -= 1;
        const p = placed_buf[j];
        const idx = @as(u16, p.row) * BOARD_SIZE + p.col;
        cells[idx] = .empty;
        bitboard.removeStone(p.row, p.col);
    }

    return breaks;
}

/// カウンターフォー耐性検証の厳格度。
/// - lenient: main 既定。攻めの追い詰め探索で使用（真正VCTを取りこぼさない）。
/// - strict: 防御側の被詰み判定で使用。相手の四(Tier1)がノリ手で先手を奪い
///   ブロック自体が四以上の先手にならない場合も手順崩壊として棄却する。
///   攻守両用パスに strict を流すと真正VCTまで棄却され弱体化するため、
///   minimax の防御ノード(!is_maximizing)経由でのみ strict を渡すこと。
pub const ResilienceMode = enum { lenient, strict };

/// 攻撃手（活三のみ）の段階で、相手のカウンターフォーが残り手順を破壊するか検査
///
/// TS版 hasBreakingCounterFour を移植・拡張。
/// CF を仮置きしてその場での五連完成 / 防御不可（活四）/ ブロック後の即時勝ち手段（VCF/4-3）/
/// ブロック後の手順崩壊を順に判定。
fn hasBreakingCounterFour(
    cells: []Cell,
    color: Cell,
    sequence: []const Position,
    attack_index: usize,
    mode: ResilienceMode,
    limiter: ?*TimeLimiter,
) bool {
    const opponent = color.opposite();

    var four_buf: [225]Position = undefined;
    const four_count = vcf_mod.findFourMoves(cells, opponent, &four_buf);

    for (0..four_count) |i| {
        const cf = four_buf[i];
        const cf_idx = @as(u16, cf.row) * BOARD_SIZE + cf.col;

        cells[cf_idx] = opponent;
        bitboard.placeStone(cf.row, cf.col, opponent);

        // CF が五連を作るならその場で勝ち（手順崩壊）
        if (forbidden.checkFive(cells, cf.row, cf.col, opponent)) {
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            return true;
        }

        // ブロック位置取得（null = 活四 → 防御不可）
        const block_pos_opt = quiescence.getFourDefensePosition(cells, cf.row, cf.col, opponent).blockPos();
        if (block_pos_opt == null) {
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            return true;
        }
        const bp = block_pos_opt.?;
        const bp_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;

        cells[bp_idx] = color;
        bitboard.placeStone(bp.row, bp.col, color);

        // ブロック石が五を作るなら、その CF は手順を壊さない（攻撃側がその場で勝つ）。
        // 以降の「CF+ブロック後に相手が即時勝ち手段を持つか」を見る意味はないので次の CF へ
        // （issue #140 の ct=four 短絡と同型。`return false` にしないのは、
        //   別の CF が手順を壊す可能性が残るため）。
        //
        // 判別テストが無いのは構造的な理由による: ブロック点 E は「CF の四」と同じ 5 窓に
        // 入るので、相手は必ず E 自身にも四を持つ（{A,B,C,D} が四なら {A,B,C,E} も四）。
        // つまりこの短絡が効く局面では E を CF とする分岐が別に走り、関数全体の戻り値は
        // そちらで決まってしまう。ここは ct=four 側と意味論を揃えるための一貫性の担保。
        if (forbidden.checkFive(cells, bp.row, bp.col, color)) {
            cells[bp_idx] = .empty;
            bitboard.removeStone(bp.row, bp.col);
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            continue;
        }

        // ノリ手Tierゲート（strict時のみ・連珠テンポ理論）:
        // この攻撃手は三(Tier2)のみ（呼び出し元 isResilientToCounterFours が
        // 四/五の攻撃手を除外済み）。相手の四(Tier1)はノリ手で先手を奪い、
        // 攻撃側は四をブロックさせられる。そのブロック自体が四以上の先手
        // （= 再逆転のノリ手）でなければテンポは相手に渡り手順は崩壊する。
        // 攻めの探索(lenient)ではこのゲートで真正VCTまで棄却され弱体化するため、
        // 防御側の被詰み判定(strict)でのみ発火させる。
        // （五を作るブロックは直前の短絡で処理済みなので、ここでは四かどうかだけ見る）
        if (mode == .strict) {
            const block_makes_four = quiescence.createsFour(cells, bp.row, bp.col, color);
            if (!block_makes_four) {
                cells[bp_idx] = .empty;
                bitboard.removeStone(bp.row, bp.col);
                cells[cf_idx] = .empty;
                bitboard.removeStone(cf.row, cf.col);
                return true;
            }
        }

        // CF+ブロック後に相手が即時勝ち手段を持つか（4-3/活四/VCF/白の三三）
        // 元手順は相手が "受け身の防御" を打つ前提だが、CF後に強力な攻撃が生まれるなら
        // 相手は防御せずその攻撃を選ぶ → 元手順は崩壊
        const opp_has_threat = blk: {
            if (hasFourThreeAvailable(cells, opponent)) break :blk true;
            // 白相手の場合、三三・四四も即勝ち
            if (opponent == .white and hasDoubleThreeForWhite(cells)) break :blk true;
            // 親の残り予算を継承した子 limiter（issue #147 B）
            var probe_limiter = if (limiter) |l|
                l.child(0, COUNTER_FOUR_VCF_PROBE_MAX_NODES)
            else
                TimeLimiter{
                    .start_time = 0,
                    .time_limit = 0,
                    .nodes = 0,
                    .max_nodes = COUNTER_FOUR_VCF_PROBE_MAX_NODES,
                };
            const found = vcf_mod.hasVCF(cells, opponent, 0, &probe_limiter, vcf_mod.VCF_MAX_DEPTH);
            // プローブの消費ノードも親の予算に計上する（issue #119）
            if (limiter) |l| l.charge(probe_limiter.nodes);
            break :blk found;
        };
        if (opp_has_threat) {
            cells[bp_idx] = .empty;
            bitboard.removeStone(bp.row, bp.col);
            cells[cf_idx] = .empty;
            bitboard.removeStone(cf.row, cf.col);
            return true;
        }

        const breaks = checkSequenceBreaksByCF(cells, color, sequence, attack_index + 1);

        // Undo
        cells[bp_idx] = .empty;
        bitboard.removeStone(bp.row, bp.col);
        cells[cf_idx] = .empty;
        bitboard.removeStone(cf.row, cf.col);

        if (breaks) return true;
    }

    return false;
}

/// VCT手順がカウンターフォー耐性を持つか検証
///
/// TS版 isResilientToCounterFours を移植。
/// 各攻撃手（活三）の段階で、相手のカウンターフォーが手順を破壊しないことを確認する。
/// 四・五を作る攻撃手はチェック対象外（相手は必ず防御を強いられるため）。
/// カウンターフォー耐性検証の相手 VCF プローブのノード上限
const COUNTER_FOUR_VCF_PROBE_MAX_NODES: u32 = 3000;

pub fn isResilientToCounterFours(
    cells: []Cell,
    color: Cell,
    sequence: []const Position,
    mode: ResilienceMode,
    limiter: ?*TimeLimiter,
) bool {
    const opponent = color.opposite();

    var placed_buf: [64]Position = undefined;
    var placed_len: usize = 0;

    var resilient = true;
    var i: usize = 0;
    while (i < sequence.len) : (i += 1) {
        const pos = sequence[i];
        const idx = @as(u16, pos.row) * BOARD_SIZE + pos.col;
        if (cells[idx] != .empty) {
            // sequence上のpositionが既存石と衝突するケース：lenient方向でスキップ
            continue;
        }

        const is_attack = (i % 2) == 0;
        const stone_color: Cell = if (is_attack) color else opponent;

        cells[idx] = stone_color;
        bitboard.placeStone(pos.row, pos.col, stone_color);
        placed_buf[placed_len] = pos;
        placed_len += 1;

        // 攻撃手かつ五・四でない（=活三のみ）の場合のみカウンターフォーをチェック
        if (is_attack) {
            const is_five = forbidden.checkFive(cells, pos.row, pos.col, color);
            const is_four = quiescence.createsFour(cells, pos.row, pos.col, color);
            if (!is_five and !is_four) {
                if (hasBreakingCounterFour(cells, color, sequence, i, mode, limiter)) {
                    resilient = false;
                    break;
                }
            }
        }
    }

    // 盤面を元に戻す
    var j: usize = placed_len;
    while (j > 0) {
        j -= 1;
        const p = placed_buf[j];
        const idx = @as(u16, p.row) * BOARD_SIZE + p.col;
        cells[idx] = .empty;
        bitboard.removeStone(p.row, p.col);
    }

    return resilient;
}

// =============================================================================
// evaluateCounterThreat（TS版 vct.ts に対応）
// =============================================================================

/// 防御手のカウンター脅威に応じてVCT継続を判定
fn evaluateCounterThreat(
    ct: CounterThreat,
    cells: []Cell,
    color: Cell,
    defense_pos: Position,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) bool {
    const opponent = color.opposite();

    switch (ct) {
        .win => return false,
        .four => {
            // 防御のカウンター四に対してブロック
            const block_pos = quiescence.getFourDefensePosition(cells, defense_pos.row, defense_pos.col, opponent).blockPos();
            if (block_pos == null) {
                // 活四でブロック不可 → VCT不成立
                return false;
            }
            const bp = block_pos.?;

            switch (classifyBlock(cells, bp, color, depth, limiter)) {
                .stop => return false,
                .win_now => return true,
                .continue_search => {},
            }

            // ブロック配置（bitboard も同期）
            const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
            cells[block_idx] = color;
            bitboard.placeStone(bp.row, bp.col, color);

            // ブロックの脅威に対する防御をチェック
            const block_ok = processBlockDefenses(cells, bp, color, depth, max_depth, limiter);

            cells[block_idx] = .empty;
            bitboard.removeStone(bp.row, bp.col);
            return block_ok;
        },
        .three => {
            // 防御側が活三 → VCFのみで勝てるか
            if (limiter.exceeded()) return false;
            const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
            return vcf_mod.hasVCF(cells, color, 0, limiter, vcf_depth);
        },
        .none => {
            // 通常の再帰
            return hasVCT(cells, color, depth + 1, limiter, max_depth);
        },
    }
}

/// 予算判定・ノード計上は `TimeLimiter` のメソッド（vcf.zig）が SSoT。
///
/// VCT 経路は #119 以前 `bump` 相当を一切呼んでおらず `max_nodes` がノーオペだった
/// （`vcf_mod.hasVCF` に共有 limiter を渡したときだけ進んでいた）。
/// いまは攻め手（OR ノード）を 1 手展開するごとに 1 ノードとして数える。

// =============================================================================
// processBlockDefenses
// =============================================================================

/// ブロック石は必ず四か活三を持つ、という不変条件のチェック（issue #140）
///
/// `processBlockDefenses` / `processBlockDefensesSeq` の呼び出し元はいずれも
/// `classifyBlock` が `.continue_search` を返したときだけここに来る（issue #145）。
/// `.none` は `stop`、`.win` は `win_now` なので、ブロック石は必ず四か活三を持っており、
/// `getThreatDefensePositions` の `no_threat` は**到達不能**。
/// 到達したら `checkDefenseCounterThreat` と `getThreatDefensePositions` の脅威判定基準が
/// 食い違っているということ（両者は同一基準。PR #139 で 1 対 1 対応を確認済み）。
///
/// Debug / ReleaseSafe（= `zig build test`）では食い違いをその場で落として検出する。
/// wasm ビルド（ReleaseFast）では分岐ごと畳まれるので UB にもコスト増にもならず、
/// 万一到達しても呼び出し元は**旧挙動（`.unstoppable` と束ねていた頃と同じ「勝ち」）**を
/// 維持する。issue #140 が挙げた「保守側 = false に倒す」を採らなかったのは、
/// 到達不能を確信していることと、挙動不変にしておくほうが bench で二分しやすいため。
fn assertBlockHasThreat() void {
    if (std.debug.runtime_safety) {
        @panic("block stone must have four/three threat (#140)");
    }
}

/// ブロックの脅威に対する防御サイクルを処理
fn processBlockDefenses(
    cells: []Cell,
    block_pos: Position,
    color: Cell,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
) bool {
    const opponent = color.opposite();

    const block_def_positions = switch (getThreatDefensePositions(cells, block_pos.row, block_pos.col, color)) {
        // 防御不可 → ブロックの脅威で勝ち
        .unstoppable => return true,
        .no_threat => {
            assertBlockHasThreat();
            return true;
        },
        .positions => |p| p,
    };

    for (0..block_def_positions.len) |i| {
        const bd_pos = block_def_positions.items[i];

        // 白番: 黒の防御位置が禁手ならスキップ（攻撃側の勝ち）
        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, bd_pos.row, bd_pos.col);
            if (fr != .none) continue;
        }

        const bd_idx = @as(u16, bd_pos.row) * BOARD_SIZE + bd_pos.col;
        cells[bd_idx] = opponent;
        bitboard.placeStone(bd_pos.row, bd_pos.col, opponent);

        const bd_ct = checkDefenseCounterThreat(cells, bd_pos.row, bd_pos.col, opponent);

        if (bd_ct == .win) {
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
            return false;
        }

        const vct_ok = evaluateCounterThreat(bd_ct, cells, color, bd_pos, depth, limiter, max_depth);

        cells[bd_idx] = .empty;
        bitboard.removeStone(bd_pos.row, bd_pos.col);

        if (!vct_ok) return false;
    }

    return true;
}

// =============================================================================
// hasVCT
// =============================================================================

/// VCTが成立するかチェック
pub fn hasVCT(
    cells: []Cell,
    color: Cell,
    depth: u8,
    limiter: *TimeLimiter,
    max_depth: u8,
) bool {
    if (depth >= max_depth) return false;
    if (limiter.exceeded()) return false;

    // まずVCFを試す
    if (vcf_mod.hasVCF(cells, color, 0, limiter, vcf_mod.VCF_MAX_DEPTH)) {
        return true;
    }

    const opponent = color.opposite();

    var threat_buf: [225]Position = undefined;
    const threat_moves = findThreatMovesCounted(cells, color, &threat_buf);
    const threat_count = threat_moves.total;
    if (threat_count == 0) return false;

    for (0..threat_count) |i| {
        // 三の攻め手に入る直前で一度だけ判定（buf は四→活三の順）。
        // 相手が活三/ミセ手/（根に近いノードでは）VCF を持つなら三で追っても
        // 手順が崩壊するため、残り（すべて三）は打ち切る。四で受けを強制して
        // 相手の脅威を潰してから三で追う手順は、四を先に試すことで保存される。
        // hasVCT は公開 API でエントリガードを持たないため depth 0 でもプローブする。
        if (i == @as(usize, threat_moves.four_count) and
            opponentBlocksThreePursuitWithShallowVCF(cells, opponent, depth, limiter)) break;

        // 攻め手 1 手 = 1 ノード（#119）
        limiter.bump();
        if (limiter.exceeded()) return false;

        const move = threat_buf[i];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連チェック
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            return true;
        }

        // issue #130: 3 値なので「脅威でない手」を勝ちにできない（`isThreat` の再計算も不要）
        const defense_positions = switch (getThreatDefensePositions(cells, move.row, move.col, color)) {
            .unstoppable => {
                // 防御不可 → 勝ち
                cells[move_idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                return true;
            },
            .no_threat => {
                // 四でも活三でもない ＝ 追い詰めの手ではない
                cells[move_idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                continue;
            },
            .positions => |p| p,
        };

        // 全防御に対してVCTが継続するかチェック
        var all_defense_leads_to_vct = true;

        for (0..defense_positions.len) |j| {
            const dp = defense_positions.items[j];

            // 白番: 黒の防御位置が禁手ならスキップ
            if (color == .white) {
                const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
                if (fr != .none) continue;
            }

            const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
            cells[def_idx] = opponent;
            bitboard.placeStone(dp.row, dp.col, opponent);

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);
            const vct_ok = evaluateCounterThreat(ct, cells, color, dp, depth, limiter, max_depth);

            cells[def_idx] = .empty;
            bitboard.removeStone(dp.row, dp.col);

            if (!vct_ok) {
                all_defense_leads_to_vct = false;
                break;
            }
        }

        cells[move_idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        if (all_defense_leads_to_vct and defense_positions.len > 0) {
            return true;
        }
    }

    return false;
}

// =============================================================================
// findVCTMove（反復深化）
// =============================================================================

/// VCT勝ち手を探索
pub fn findVCTMove(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32) ?Position {
    return findVCTMoveWithBudget(cells, color, max_depth, time_limit, 0);
}

/// VCT勝ち手を探索（ノード数制限付き）
/// max_nodes=0 は無制限
///
/// 内部で findVCTSequence を呼び出し、その手順の先頭手を返す。
/// findVCTSequence にはカウンターフォー耐性検証が含まれるため、
/// VCT手順が相手のカウンターフォーで崩壊するケースを除外できる。
pub fn findVCTMoveWithBudget(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32, max_nodes: u32) ?Position {
    const seq_result = findVCTSequence(cells, color, max_depth, time_limit, max_nodes, false, .lenient);
    if (seq_result.found and seq_result.len > 0) {
        return seq_result.sequence[0];
    }
    return null;
}

/// 防御側（被詰み判定）専用の VCT 探索。strict 耐性検証で相手のノリ手による
/// 手順崩壊（偽の追い詰め＝幻の被詰み）を棄却する。攻めには使わないこと。
/// findVCTSequence 内部の耐性検証を strict で一度だけ実行するため二重検証は無い。
pub fn findVCTMoveWithBudgetStrict(cells: []Cell, color: Cell, max_depth: u8, time_limit: u32, max_nodes: u32) ?Position {
    const seq_result = findVCTSequence(cells, color, max_depth, time_limit, max_nodes, false, .strict);
    if (seq_result.found and seq_result.len > 0) {
        return seq_result.sequence[0];
    }
    return null;
}

/// 親 limiter の残り予算を継承した子 limiter で VCT 勝ち手を探す
/// （`findVCFSequenceWithParent` と同型。設計メモ bench-fixed-nodes §2.2）
///
/// 子の消費ノードは呼び出し後に親へ計上するので、呼び出し側で `charge()` を
/// 重ねて呼んではいけない。消費量は `parent.nodes` の差分で観測できる。
pub fn findVCTMoveWithParent(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    own_time_limit: u32,
    own_max_nodes: u32,
    parent: *TimeLimiter,
    mode: ResilienceMode,
) ?Position {
    const seq_result = findVCTSequenceWithParent(cells, color, max_depth, own_time_limit, own_max_nodes, parent, false, mode);
    if (seq_result.found and seq_result.len > 0) {
        return seq_result.sequence[0];
    }
    return null;
}

// =============================================================================
// findVCTSequence（手順蓄積版）
// =============================================================================

pub const VCTBranch = struct {
    defense_index: u8,
    defense_move: Position,
    continuation: [16]Position,
    continuation_len: u8,
};

pub const VCTSequenceResult = struct {
    sequence: [64]Position,
    len: u8,
    is_forbidden_trap: bool,
    found: bool,
    branches: [20]VCTBranch,
    branch_count: u8,
    /// 詰み木 root node index（g_tree_arena 内）。TREE_TERMINAL = 木なし。
    /// collect_branches 有効時のみ構築される。
    tree_root: u16 = ft.TREE_TERMINAL,
    /// この探索が消費したノード数（呼び出し側の共有 limiter へ加算するため。issue #119）
    nodes: u32 = 0,
};

/// 詰み木アリーナ（review 専用・collect_branches 時のみ構築）。
/// 単一スレッド WASM 前提でグローバル保持しスタック肥大を避ける。
pub var g_tree_arena: ft.Arena = .{};

/// 再帰コンテキスト（分岐収集用）
const VCTRecursiveContext = struct {
    is_forbidden_trap: bool,
    collect_branches: bool,
    branches: [20]VCTBranch,
    branch_count: u8,
    /// この部分木の root node index（collect_branches 時のみ設定）
    out_node: u16 = ft.TREE_TERMINAL,
};

/// 防御ごとの手順エントリ
const DefenseSeqEntry = struct {
    defense: Position,
    seq: [64]Position,
    seq_len: u8,
    child_branches: [20]VCTBranch,
    child_branch_count: u8,
    is_forbidden_trap: bool,
    /// この防御後の継続ノード index（collect_branches 時のみ設定）
    child_node: u16 = ft.TREE_TERMINAL,
};

/// 1ノードあたりの受け手の最大数（詰み木の SSoT は forced_win_tree.zig）
const MAX_DEFENSE_ENTRIES = ft.MAX_DEFENSES_PER_NODE;

/// 手順長 α カットの「上限なし」
///
/// カットは「`max_len` 未満なら採用」なので、sequence バッファ長 64 ちょうどの
/// 手順も採用できるように 65 にする（64 にすると長さ 64 の手順だけ落ちる）。
const SEQ_LEN_UNBOUNDED: u8 = 65;

/// 受けエントリを 1 件確保する（issue #122 レバー4 / レビュー should-12）
///
/// 収集モードのときだけエントリを積む。`MAX_DEFENSE_ENTRIES` に達していたら
/// アリーナの `defense_truncated` を立てて null を返す（超過分は木から落ちる。
/// 詰み判定は壊れないが表示の受け分岐が欠ける）。
fn pushDefenseEntry(
    entries: *[MAX_DEFENSE_ENTRIES]DefenseSeqEntry,
    count: *u8,
    collect_branches: bool,
) ?*DefenseSeqEntry {
    if (!collect_branches) return null;
    if (count.* >= MAX_DEFENSE_ENTRIES) {
        g_tree_arena.defense_truncated = true;
        return null;
    }
    const entry = &entries[count.*];
    count.* += 1;
    return entry;
}

/// VCT手順全体を返す（反復深化）
pub fn findVCTSequence(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
    collect_branches: bool,
    mode: ResilienceMode,
) VCTSequenceResult {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    // 詰み木アリーナを初期化（collect_branches 時のみ構築する）
    if (collect_branches) g_tree_arena.reset();

    return findVCTSequenceWithLimiter(cells, color, max_depth, &limiter, collect_branches, mode);
}

/// VCT 勝ち手を探す（limiter を受け取る版・トップレベルエントリ）
///
/// 呼び出し側が limiter を用意して消費ノード（`limiter.nodes`）を観測したいとき
/// （脅威プローブ）に使う。bitboard を同期し、詰み木は構築しない。
pub fn findVCTMoveWithLimiter(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    limiter: *TimeLimiter,
    mode: ResilienceMode,
) ?Position {
    bitboard.initFromCells(cells);
    ll.init();
    const seq_result = findVCTSequenceWithLimiter(cells, color, max_depth, limiter, false, mode);
    if (seq_result.found and seq_result.len > 0) {
        return seq_result.sequence[0];
    }
    return null;
}

/// `findVCTSequence` の親 limiter 版（トップレベルエントリ）
///
/// `parent.child(own_time_limit, own_max_nodes)` で子 limiter を作り、探索後に消費ノードを
/// 親へ計上する（`findVCFSequenceWithParent` と同型）。
pub fn findVCTSequenceWithParent(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    own_time_limit: u32,
    own_max_nodes: u32,
    parent: *TimeLimiter,
    collect_branches: bool,
    mode: ResilienceMode,
) VCTSequenceResult {
    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = parent.child(own_time_limit, own_max_nodes);

    // 詰み木アリーナを初期化（collect_branches 時のみ構築する）
    if (collect_branches) g_tree_arena.reset();

    const result = findVCTSequenceWithLimiter(cells, color, max_depth, &limiter, collect_branches, mode);
    parent.chargeChild(&limiter, own_time_limit == 0 and own_max_nodes == 0);
    return result;
}

/// findVCTSequence の本体（limiter 共有版）
///
/// bitboard/line_lookup の初期化と詰み木アリーナの reset は行わない。
/// 呼び出し元がすでに探索中で、アリーナへノードを積んでいる途中でも呼べるようにするため
/// （`findVCTSequenceFromFirstMove` の collect モードから使う）。
fn findVCTSequenceWithLimiter(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    limiter: *TimeLimiter,
    collect_branches: bool,
    mode: ResilienceMode,
) VCTSequenceResult {
    // どの return 経路でも消費ノードが埋まるように薄く包む
    // （呼び出し元が親 limiter へ加算するため。`defer` は戻り値のコピー後に
    //   走るので result への代入が反映されない）
    const nodes_at_entry = limiter.nodes;
    var result = findVCTSequenceInner(cells, color, max_depth, limiter, collect_branches, mode);
    result.nodes = limiter.nodes - nodes_at_entry;
    return result;
}

fn findVCTSequenceInner(
    cells: []Cell,
    color: Cell,
    max_depth: u8,
    limiter: *TimeLimiter,
    collect_branches: bool,
    mode: ResilienceMode,
) VCTSequenceResult {
    var result = VCTSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
        .branches = undefined,
        .branch_count = 0,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT不成立（四追いでしか勝てない）
    if (opponentBlocksThreePursuitAtRoot(cells, opponent, limiter)) {
        return tryVCFOnly(cells, color, limiter, &result, collect_branches);
    }

    // VCFが先に成立する場合はVCF手順を返す（予算は親の残額。issue #147 B）
    const vcf_seq = vcf_mod.findVCFSequenceWithParent(cells, color, vcf_mod.VCF_MAX_DEPTH, 0, 0, limiter);
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            result.sequence[i] = vcf_seq.sequence[i];
        }
        result.len = vcf_seq.len;
        result.is_forbidden_trap = vcf_seq.is_forbidden_trap;
        result.found = true;
        // VCF は受け一意の線形手順 → 線形チェイン木
        if (collect_branches) result.tree_root = g_tree_arena.buildLinearChain(result.sequence[0..], result.len);
        return result;
    }

    // 反復深化
    var depth: u8 = 1;
    while (depth <= max_depth) : (depth += 1) {
        if (limiter.exceeded()) return result;

        var seq_len: u8 = 0;
        var context = VCTRecursiveContext{
            .is_forbidden_trap = false,
            .collect_branches = collect_branches,
            .branches = undefined,
            .branch_count = 0,
        };
        const found = findVCTSequenceRecursive(cells, color, 0, depth, limiter, &result.sequence, &seq_len, &context, SEQ_LEN_UNBOUNDED);
        if (found) {
            // カウンターフォー耐性検証: 活三を打つ段階で相手のカウンターフォーが
            // 残り手順を破壊するならVCT不成立扱い → VCF-onlyにフォールバック
            //
            // 深い反復に進んでも先頭の活三は同じで再度棄却されるため早期終了する。
            if (!isResilientToCounterFours(cells, color, result.sequence[0..seq_len], mode, limiter)) {
                var fallback = VCTSequenceResult{
                    .sequence = undefined,
                    .len = 0,
                    .is_forbidden_trap = false,
                    .found = false,
                    .branches = undefined,
                    .branch_count = 0,
                };
                return tryVCFOnly(cells, color, limiter, &fallback, collect_branches);
            }
            result.len = seq_len;
            result.is_forbidden_trap = context.is_forbidden_trap;
            result.found = true;
            result.branch_count = context.branch_count;
            var bi: u8 = 0;
            while (bi < context.branch_count) : (bi += 1) {
                result.branches[bi] = context.branches[bi];
            }
            // 再帰で構築した詰み木の root（collect_branches 時のみ）
            result.tree_root = context.out_node;
            return result;
        }
    }
    return result;
}

/// VCF-onlyフォールバック: 相手にVCT阻害要因があるとき
fn tryVCFOnly(cells: []Cell, color: Cell, limiter: *TimeLimiter, result: *VCTSequenceResult, collect_branches: bool) VCTSequenceResult {
    const vcf_seq = vcf_mod.findVCFSequenceWithParent(cells, color, vcf_mod.VCF_MAX_DEPTH, 0, 0, limiter);
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            result.sequence[i] = vcf_seq.sequence[i];
        }
        result.len = vcf_seq.len;
        result.is_forbidden_trap = vcf_seq.is_forbidden_trap;
        result.found = true;
        // VCF-only は線形手順 → 線形チェイン木
        if (collect_branches) result.tree_root = g_tree_arena.buildLinearChain(result.sequence[0..], result.len);
    }
    return result.*;
}

/// VCT手順の再帰探索
///
/// `max_len` は「この部分木が返してよい手順長の上限（この値未満）」。
/// 呼び出し元がすでに長さ `max_len` の手順を持っているなら、それ以上に長い
/// 手順は採用されないので、途中で打ち切ってよい（手順長の α カット。issue #122）。
/// 最短性は保存される（純粋に「採用されない枝」だけを捨てる健全カット）。
/// 上限なしは `SEQ_LEN_UNBOUNDED`。
fn findVCTSequenceRecursive(
    cells: []Cell,
    color: Cell,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
    sequence: *[64]Position,
    seq_len: *u8,
    context: *VCTRecursiveContext,
    max_len: u8,
) bool {
    if (depth >= max_depth) return false;
    if (limiter.exceeded()) return false;
    // 採用されうる最短の手順は「五連 1 手」＝長さ 1 なので、max_len<=1 では
    // どんな手順も採用されない。重い VCF 探索に入る前に落とす（issue #122 レバー2）。
    if (max_len <= 1) return false;

    // VCF手順に委譲。
    //
    // 探索深さを `max_len / 2` で頭打ちにする案（レビュー should-6(b)）は**採らない**。
    // このノードの意味論は「VCF があればそれを返す / 無ければ脅威手を探索する」で、
    // 深さを絞ると「VCF は在るが長すぎる」と「VCF が無い」を区別できなくなり、
    // 前者のとき脅威手探索に落ちて**より短い別解**を返してしまう（＝結果が変わる）。
    // 長すぎる VCF はここで false にして親に捨てさせるのが α カットの健全な形。
    const vcf_seq = vcf_mod.findVCFSequenceWithParent(cells, color, vcf_mod.VCF_MAX_DEPTH, 0, 0, limiter);
    if (vcf_seq.found and vcf_seq.len >= max_len) return false;
    if (vcf_seq.found) {
        var i: u8 = 0;
        while (i < vcf_seq.len) : (i += 1) {
            if (seq_len.* + i < 64) {
                sequence[seq_len.* + i] = vcf_seq.sequence[i];
            }
        }
        seq_len.* += vcf_seq.len;
        if (vcf_seq.is_forbidden_trap) {
            context.is_forbidden_trap = true;
        }
        // VCF は受け一意の線形手順 → 線形チェイン木
        if (context.collect_branches) context.out_node = g_tree_arena.buildLinearChain(vcf_seq.sequence[0..], vcf_seq.len);
        return true;
    }

    const opponent = color.opposite();

    var threat_buf: [225]Position = undefined;
    const threat_moves = findThreatMovesCounted(cells, color, &threat_buf);
    const threat_count = threat_moves.total;
    if (threat_count == 0) return false;

    // 最短手順の候補を保持（全脅威手を試して最短を選ぶ）
    var best_seq: [64]Position = undefined;
    // 「これ未満の長さでなければ採用しない」上限。呼び出し元の α 値で初期化し、
    // 短い手順が見つかるたびに絞り込む（issue #122 レバー2）。
    var best_seq_len: u8 = max_len;
    var best_root: u16 = ft.TREE_TERMINAL;
    var best_context = VCTRecursiveContext{
        .is_forbidden_trap = false,
        .collect_branches = context.collect_branches,
        .branches = undefined,
        .branch_count = 0,
    };
    var has_best = false;

    for (0..threat_count) |ti| {
        // 受けのある攻め手の候補手順長は最短でも 3（攻め手 + 受け手 + 継続 1 手）。
        // すでに 3 以下の手順を持っているなら、残りの攻め手は改善しえない。
        // ただし「1 手で終わる攻め手」（五連・受け不能）は best を経由せず即 return
        // するので、それが混ざる四の区間（buf は四→活三の順）を抜けてから適用する。
        if (ti >= @as(usize, threat_moves.four_count) and best_seq_len <= 3) break;

        // 三の攻め手に入る直前で一度だけ判定（buf は四→活三の順）。
        // 相手が活三/ミセ手/（根に近いノードでは）VCF を持つなら三で追っても
        // 手順が崩壊するため、残り（すべて三）は打ち切る。四で受けを強制して
        // 相手の脅威を潰してから三で追う手順は、四を先に試すことで保存される。
        // 石は未配置・アリーナも未取得の位置なので break して安全。
        // depth 0 は同一盤面をエントリ（findVCTSequence / findVCTSequenceFromFirstMove）が
        // フル深度の hasVCF で確認済み。反復深化の各イテレーションで弱いプローブを
        // 重ねても無駄なので、ここでは安い述語だけにする。
        if (ti == @as(usize, threat_moves.four_count)) {
            const blocked = if (depth == 0)
                opponentBlocksThreePursuit(cells, opponent)
            else
                opponentBlocksThreePursuitWithShallowVCF(cells, opponent, depth, limiter);
            if (blocked) break;
        }

        // 攻め手 1 手 = 1 ノード（#119）。予算切れなら「ここまでの best」を返す。
        limiter.bump();
        if (limiter.exceeded()) break;

        // この脅威手の探索でアリーナへ積むノードの起点。採用されなければ巻き戻す。
        const threat_snap = g_tree_arena.snapshot();
        const move = threat_buf[ti];
        const move_idx = @as(u16, move.row) * BOARD_SIZE + move.col;
        cells[move_idx] = color;
        bitboard.placeStone(move.row, move.col, color);

        // 五連チェック — 1手で終わるので即返却（これ以上短い手順はない）
        if (forbidden.checkFive(cells, move.row, move.col, color)) {
            cells[move_idx] = .empty;
            bitboard.removeStone(move.row, move.col);
            sequence[seq_len.*] = move;
            seq_len.* += 1;
            // 五連で終端（受けなし）
            if (context.collect_branches) context.out_node = g_tree_arena.addNode(move, 0, 0);
            return true;
        }

        // issue #130: 3 値なので「脅威でない手」を勝ちにできない（`isThreat` の再計算も不要）
        const defense_positions = switch (getThreatDefensePositions(cells, move.row, move.col, color)) {
            .unstoppable => {
                cells[move_idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                // 1手で終わるので即返却
                sequence[seq_len.*] = move;
                seq_len.* += 1;
                // 受け不能の脅威で終端
                if (context.collect_branches) context.out_node = g_tree_arena.addNode(move, 0, 0);
                return true;
            },
            .no_threat => {
                cells[move_idx] = .empty;
                bitboard.removeStone(move.row, move.col);
                continue;
            },
            .positions => |p| p,
        };

        // 全防御に対してVCTが継続するかチェック
        var all_defense_leads_to_vct = true;
        var defense_entries: [MAX_DEFENSE_ENTRIES]DefenseSeqEntry = undefined;
        var defense_entry_count: u8 = 0;
        var first_defense_seq: [64]Position = undefined;
        var first_defense_seq_len: u8 = 0;
        var has_first_defense = false;

        for (0..defense_positions.len) |j| {
            const dp = defense_positions.items[j];

            if (color == .white) {
                const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
                if (fr != .none) continue;
            }

            const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
            cells[def_idx] = opponent;
            bitboard.placeStone(dp.row, dp.col, opponent);

            const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

            if (ct == .win) {
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);
                all_defense_leads_to_vct = false;
                break;
            }

            // ct=four: ブロック配置
            if (ct == .four) {
                const block_pos = quiescence.getFourDefensePosition(cells, dp.row, dp.col, opponent).blockPos();
                if (block_pos == null) {
                    cells[def_idx] = .empty;
                    bitboard.removeStone(dp.row, dp.col);
                    all_defense_leads_to_vct = false;
                    break;
                }
                const bp = block_pos.?;

                const block_ok = switch (classifyBlock(cells, bp, color, depth, limiter)) {
                    .stop => {
                        cells[def_idx] = .empty;
                        bitboard.removeStone(dp.row, dp.col);
                        all_defense_leads_to_vct = false;
                        break;
                    },
                    // ブロック石が五 → その場で勝ち（issue #140）。手順はブロック石で確定。
                    .win_now => blockWinSeqResult(),
                    .continue_search => blk: {
                        const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
                        cells[block_idx] = color;
                        bitboard.placeStone(bp.row, bp.col, color);
                        const seq_result = processBlockDefensesSeq(cells, bp, color, depth, max_depth, limiter, context.collect_branches or !has_first_defense);
                        cells[block_idx] = .empty;
                        bitboard.removeStone(bp.row, bp.col);
                        break :blk seq_result;
                    },
                };

                if (block_ok.found) {
                    if (pushDefenseEntry(&defense_entries, &defense_entry_count, context.collect_branches)) |entry| {
                        entry.defense = dp;
                        entry.seq[0] = bp;
                        var si: u8 = 0;
                        while (si < block_ok.seq_len) : (si += 1) {
                            entry.seq[1 + si] = block_ok.seq[si];
                        }
                        entry.seq_len = 1 + block_ok.seq_len;
                        entry.child_branch_count = 0;
                        entry.is_forbidden_trap = block_ok.is_forbidden_trap;
                        // ブロック四追いは受け一意の線形手順 → 線形チェイン木
                        entry.child_node = g_tree_arena.buildLinearChain(entry.seq[0..], entry.seq_len);
                    }
                    if (!has_first_defense and block_ok.seq_len_valid) {
                        first_defense_seq[0] = dp;
                        first_defense_seq[1] = bp;
                        var si: u8 = 0;
                        while (si < block_ok.seq_len) : (si += 1) {
                            first_defense_seq[2 + si] = block_ok.seq[si];
                        }
                        first_defense_seq_len = 2 + block_ok.seq_len;
                        has_first_defense = true;
                    }
                }

                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);

                if (!block_ok.found) {
                    all_defense_leads_to_vct = false;
                    break;
                }
                continue;
            }

            if (ct == .three) {
                // ct=three: VCFのみで勝てるか
                const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
                if (context.collect_branches or !has_first_defense) {
                    const vcf_result = vcf_mod.findVCFSequenceWithParent(cells, color, vcf_depth, 0, 0, limiter);
                    if (!vcf_result.found) {
                        cells[def_idx] = .empty;
                        bitboard.removeStone(dp.row, dp.col);
                        all_defense_leads_to_vct = false;
                        break;
                    }
                    if (pushDefenseEntry(&defense_entries, &defense_entry_count, context.collect_branches)) |entry| {
                        entry.defense = dp;
                        var si: u8 = 0;
                        while (si < vcf_result.len) : (si += 1) {
                            entry.seq[si] = vcf_result.sequence[si];
                        }
                        entry.seq_len = vcf_result.len;
                        entry.child_branch_count = 0;
                        entry.is_forbidden_trap = vcf_result.is_forbidden_trap;
                        // 三防御後の VCF は受け一意の線形手順 → 線形チェイン木
                        entry.child_node = g_tree_arena.buildLinearChain(entry.seq[0..], entry.seq_len);
                    }
                    if (!has_first_defense) {
                        first_defense_seq[0] = dp;
                        var si: u8 = 0;
                        while (si < vcf_result.len) : (si += 1) {
                            first_defense_seq[1 + si] = vcf_result.sequence[si];
                        }
                        first_defense_seq_len = 1 + vcf_result.len;
                        has_first_defense = true;
                    }
                } else {
                    if (!vcf_mod.hasVCF(cells, color, 0, limiter, vcf_depth)) {
                        cells[def_idx] = .empty;
                        bitboard.removeStone(dp.row, dp.col);
                        all_defense_leads_to_vct = false;
                        break;
                    }
                }
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);
                continue;
            }

            // ct=none: 通常の再帰
            if (context.collect_branches or !has_first_defense) {
                var sub_context = VCTRecursiveContext{
                    .is_forbidden_trap = false,
                    .collect_branches = context.collect_branches,
                    .branches = undefined,
                    .branch_count = 0,
                };
                var sub_seq: [64]Position = undefined;
                var sub_len: u8 = 0;
                // 手順長の α カット（issue #122 レバー2）。
                // この攻め手の候補手順長は `1（攻め手）+ 1（受け手）+ sub_len` なので、
                // `sub_len >= best_seq_len - 2` の部分木は採用されない＝探索不要。
                // 収集モードは全受けを完全展開して木を作る必要があり、この節点の
                // 候補長は「最短の受け」で決まるため、長い受けを打ち切ると
                // 「受けきれない」と誤判定しうる。よって非収集モードにのみ適用する。
                const sub_max_len: u8 = if (context.collect_branches)
                    SEQ_LEN_UNBOUNDED
                else if (best_seq_len > 2) best_seq_len - 2 else 0;
                const found = findVCTSequenceRecursive(cells, color, depth + 1, max_depth, limiter, &sub_seq, &sub_len, &sub_context, sub_max_len);

                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);

                if (!found) {
                    all_defense_leads_to_vct = false;
                    break;
                }

                if (pushDefenseEntry(&defense_entries, &defense_entry_count, context.collect_branches)) |entry| {
                    entry.defense = dp;
                    var si: u8 = 0;
                    while (si < sub_len) : (si += 1) {
                        entry.seq[si] = sub_seq[si];
                    }
                    entry.seq_len = sub_len;
                    entry.child_branch_count = sub_context.branch_count;
                    var bi: u8 = 0;
                    while (bi < sub_context.branch_count) : (bi += 1) {
                        entry.child_branches[bi] = sub_context.branches[bi];
                    }
                    entry.is_forbidden_trap = sub_context.is_forbidden_trap;
                    // ct=none: 子は再帰で構築した部分木
                    entry.child_node = sub_context.out_node;
                } else if (sub_context.is_forbidden_trap) {
                    context.is_forbidden_trap = true;
                }
                if (!has_first_defense) {
                    first_defense_seq[0] = dp;
                    var si: u8 = 0;
                    while (si < sub_len) : (si += 1) {
                        first_defense_seq[1 + si] = sub_seq[si];
                    }
                    first_defense_seq_len = 1 + sub_len;
                    has_first_defense = true;
                }
            } else {
                // hasVCTでチェックのみ
                const vct_ok = hasVCT(cells, color, depth + 1, limiter, max_depth);
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);
                if (!vct_ok) {
                    all_defense_leads_to_vct = false;
                    break;
                }
            }
        }

        cells[move_idx] = .empty;
        bitboard.removeStone(move.row, move.col);

        var kept = false;
        if (all_defense_leads_to_vct and defense_positions.len > 0 and has_first_defense) {
            // この脅威手での手順長を計算
            var candidate_seq: [64]Position = undefined;
            var candidate_len: u8 = 0;
            var candidate_context = VCTRecursiveContext{
                .is_forbidden_trap = false,
                .collect_branches = context.collect_branches,
                .branches = undefined,
                .branch_count = 0,
            };
            var candidate_root: u16 = ft.TREE_TERMINAL;

            if (context.collect_branches and defense_entry_count > 0) {
                const shortest_idx = selectShortestDefense(&defense_entries, defense_entry_count);
                buildBranches(&defense_entries, defense_entry_count, shortest_idx, &candidate_seq, &candidate_len, move, &candidate_context);

                // アリーナ: この攻め手ノードを構築。defenses[0] = 最短防御（前出し）。
                var tree_defenses: [MAX_DEFENSE_ENTRIES]ft.TreeDefense = undefined;
                var ei: u8 = 0;
                while (ei < defense_entry_count) : (ei += 1) {
                    tree_defenses[ei] = .{
                        .defender = defense_entries[ei].defense,
                        .child_node = defense_entries[ei].child_node,
                    };
                }
                candidate_root = g_tree_arena.addNodeMainFirst(move, tree_defenses[0..defense_entry_count], shortest_idx);
            } else {
                candidate_seq[0] = move;
                candidate_len = 1;
                var fi: u8 = 0;
                while (fi < first_defense_seq_len) : (fi += 1) {
                    if (candidate_len < 64) {
                        candidate_seq[candidate_len] = first_defense_seq[fi];
                        candidate_len += 1;
                    }
                }
            }

            // 最短の候補を保持（α 値の更新も兼ねる）
            if (candidate_len < best_seq_len) {
                var ci: u8 = 0;
                while (ci < candidate_len) : (ci += 1) {
                    best_seq[ci] = candidate_seq[ci];
                }
                best_seq_len = candidate_len;
                best_context = candidate_context;
                best_root = candidate_root;
                has_best = true;
                kept = true;
            }
        }
        // 採用しなかった脅威手のアリーナノードは破棄（superseded best は dead node として残り
        // シリアライズ時の compact で除外される）
        if (context.collect_branches and !kept) {
            g_tree_arena.rollback(threat_snap);
        }
    }

    if (has_best) {
        var ci: u8 = 0;
        while (ci < best_seq_len) : (ci += 1) {
            if (seq_len.* < 64) {
                sequence[seq_len.*] = best_seq[ci];
                seq_len.* += 1;
            }
        }
        context.is_forbidden_trap = best_context.is_forbidden_trap;
        context.branch_count = best_context.branch_count;
        var bi: u8 = 0;
        while (bi < best_context.branch_count) : (bi += 1) {
            context.branches[bi] = best_context.branches[bi];
        }
        context.out_node = best_root;
        return true;
    }

    return false;
}

/// ブロック防御のシーケンス版結果
const BlockDefSeqResult = struct {
    found: bool,
    seq: [64]Position,
    seq_len: u8,
    seq_len_valid: bool,
    is_forbidden_trap: bool,
};

/// ブロック石が五を作った（`block_ct == .win`）ときの手順収集結果（issue #140）
///
/// 五を作った時点で攻撃側の勝ちなので、ブロック石より先の手順は存在しない。
/// 呼び出し元がブロック石自身を手順の先頭に積むため、ここは空手順で `found` を立てる。
fn blockWinSeqResult() BlockDefSeqResult {
    return BlockDefSeqResult{
        .found = true,
        .seq = undefined,
        .seq_len = 0,
        .seq_len_valid = true,
        .is_forbidden_trap = false,
    };
}

/// processBlockDefenses のシーケンス収集版
fn processBlockDefensesSeq(
    cells: []Cell,
    block_pos: Position,
    color: Cell,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
    need_sequence: bool,
) BlockDefSeqResult {
    var result = BlockDefSeqResult{
        .found = false,
        .seq = undefined,
        .seq_len = 0,
        .seq_len_valid = false,
        .is_forbidden_trap = false,
    };

    const opponent = color.opposite();
    const block_def_positions = switch (getThreatDefensePositions(cells, block_pos.row, block_pos.col, color)) {
        // 防御不可 → ブロックの脅威で勝ち
        .unstoppable => {
            result.found = true;
            result.seq_len_valid = true;
            return result;
        },
        .no_threat => {
            assertBlockHasThreat();
            result.found = true;
            result.seq_len_valid = true;
            return result;
        },
        .positions => |p| p,
    };

    var longest_seq: [64]Position = undefined;
    var longest_len: u8 = 0;
    var has_longest = false;

    for (0..block_def_positions.len) |i| {
        const bd_pos = block_def_positions.items[i];

        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, bd_pos.row, bd_pos.col);
            if (fr != .none) continue;
        }

        const bd_idx = @as(u16, bd_pos.row) * BOARD_SIZE + bd_pos.col;
        cells[bd_idx] = opponent;
        bitboard.placeStone(bd_pos.row, bd_pos.col, opponent);

        const bd_ct = checkDefenseCounterThreat(cells, bd_pos.row, bd_pos.col, opponent);

        if (bd_ct == .win) {
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
            return result; // found=false
        }

        if (need_sequence) {
            const sub = buildBlockDefSubSequence(bd_ct, cells, color, bd_pos, depth, max_depth, limiter);
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
            if (!sub.found) return result;
            // candidate = [bd_pos, sub.seq...]
            const candidate_len = 1 + sub.seq_len;
            if (!has_longest or candidate_len > longest_len) {
                longest_seq[0] = bd_pos;
                var si: u8 = 0;
                while (si < sub.seq_len) : (si += 1) {
                    longest_seq[1 + si] = sub.seq[si];
                }
                longest_len = candidate_len;
                has_longest = true;
                result.is_forbidden_trap = sub.is_forbidden_trap;
            }
        } else {
            const vct_ok = evaluateCounterThreat(bd_ct, cells, color, bd_pos, depth, limiter, max_depth);
            cells[bd_idx] = .empty;
            bitboard.removeStone(bd_pos.row, bd_pos.col);
            if (!vct_ok) return result;
        }
    }

    result.found = true;
    if (has_longest) {
        var si: u8 = 0;
        while (si < longest_len) : (si += 1) {
            result.seq[si] = longest_seq[si];
        }
        result.seq_len = longest_len;
        result.seq_len_valid = true;
    }
    return result;
}

/// ブロック防御のサブシーケンス構築
const SubSeqResult = struct {
    found: bool,
    seq: [64]Position,
    seq_len: u8,
    is_forbidden_trap: bool,
};

fn buildBlockDefSubSequence(
    ct: CounterThreat,
    cells: []Cell,
    color: Cell,
    defense_pos: Position,
    depth: u8,
    max_depth: u8,
    limiter: *TimeLimiter,
) SubSeqResult {
    var result = SubSeqResult{
        .found = false,
        .seq = undefined,
        .seq_len = 0,
        .is_forbidden_trap = false,
    };

    switch (ct) {
        .win => return result,
        .three => {
            const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
            const vcf_result = vcf_mod.findVCFSequenceWithParent(cells, color, vcf_depth, 0, 0, limiter);
            if (!vcf_result.found) return result;
            var i: u8 = 0;
            while (i < vcf_result.len) : (i += 1) {
                result.seq[i] = vcf_result.sequence[i];
            }
            result.seq_len = vcf_result.len;
            result.is_forbidden_trap = vcf_result.is_forbidden_trap;
            result.found = true;
            return result;
        },
        .four => {
            const opponent = color.opposite();
            const nested_block = quiescence.getFourDefensePosition(cells, defense_pos.row, defense_pos.col, opponent).blockPos();
            if (nested_block == null) return result;
            const nb = nested_block.?;

            const nested = switch (classifyBlock(cells, nb, color, depth +| 1, limiter)) {
                .stop => return result,
                // ブロック石が五 → その場で勝ち（issue #140）。手順は nb で確定。
                .win_now => blockWinSeqResult(),
                .continue_search => blk: {
                    const nb_idx = @as(u16, nb.row) * BOARD_SIZE + nb.col;
                    cells[nb_idx] = color;
                    bitboard.placeStone(nb.row, nb.col, color);
                    const seq_result = processBlockDefensesSeq(cells, nb, color, depth + 1, max_depth, limiter, true);
                    cells[nb_idx] = .empty;
                    bitboard.removeStone(nb.row, nb.col);
                    break :blk seq_result;
                },
            };
            if (!nested.found) return result;

            result.seq[0] = nb;
            var i: u8 = 0;
            while (i < nested.seq_len) : (i += 1) {
                result.seq[1 + i] = nested.seq[i];
            }
            result.seq_len = 1 + nested.seq_len;
            result.is_forbidden_trap = nested.is_forbidden_trap;
            result.found = true;
            return result;
        },
        .none => {
            var sub_seq: [64]Position = undefined;
            var sub_len: u8 = 0;
            var sub_context = VCTRecursiveContext{
                .is_forbidden_trap = false,
                .collect_branches = false,
                .branches = undefined,
                .branch_count = 0,
            };
            const found = findVCTSequenceRecursive(cells, color, depth + 1, max_depth, limiter, &sub_seq, &sub_len, &sub_context, SEQ_LEN_UNBOUNDED);
            if (!found) return result;
            var i: u8 = 0;
            while (i < sub_len) : (i += 1) {
                result.seq[i] = sub_seq[i];
            }
            result.seq_len = sub_len;
            result.is_forbidden_trap = sub_context.is_forbidden_trap;
            result.found = true;
            return result;
        },
    }
}

/// 最短の防御継続を選択（攻撃側の最短勝ちラインをメインPVにする）
fn selectShortestDefense(entries: *const [MAX_DEFENSE_ENTRIES]DefenseSeqEntry, count: u8) u8 {
    var shortest_idx: u8 = 0;
    var shortest_len: u8 = if (count > 0) entries[0].seq_len else 0;
    var i: u8 = 1;
    while (i < count) : (i += 1) {
        if (entries[i].seq_len < shortest_len) {
            shortest_len = entries[i].seq_len;
            shortest_idx = i;
        }
    }
    return shortest_idx;
}

/// メインPVとサイド分岐を構築
fn buildBranches(
    entries: *const [MAX_DEFENSE_ENTRIES]DefenseSeqEntry,
    entry_count: u8,
    main_idx: u8,
    sequence: *[64]Position,
    seq_len: *u8,
    move: Position,
    context: *VCTRecursiveContext,
) void {
    const main_entry = entries[main_idx];
    const defense_index_in_seq = seq_len.* + 1; // +1 for attack move

    if (main_entry.is_forbidden_trap) {
        context.is_forbidden_trap = true;
    }

    // push attack move
    sequence[seq_len.*] = move;
    seq_len.* += 1;
    // push defense + continuation
    sequence[seq_len.*] = main_entry.defense;
    seq_len.* += 1;
    var si: u8 = 0;
    while (si < main_entry.seq_len) : (si += 1) {
        if (seq_len.* < 64) {
            sequence[seq_len.*] = main_entry.seq[si];
            seq_len.* += 1;
        }
    }

    // メインPVの子分岐を親に統合
    const sub_seq_offset = defense_index_in_seq + 1;
    var ci: u8 = 0;
    while (ci < main_entry.child_branch_count) : (ci += 1) {
        if (context.branch_count < 20) {
            var branch = main_entry.child_branches[ci];
            branch.defense_index = @intCast(sub_seq_offset + branch.defense_index);
            context.branches[context.branch_count] = branch;
            context.branch_count += 1;
        }
    }

    // 残りの防御を分岐として記録
    var ei: u8 = 0;
    while (ei < entry_count) : (ei += 1) {
        if (ei == main_idx) {
            ei += 0; // skip
            continue;
        }
        if (context.branch_count >= 20) break;
        const entry = entries[ei];
        var branch = VCTBranch{
            .defense_index = @intCast(defense_index_in_seq),
            .defense_move = entry.defense,
            .continuation = undefined,
            .continuation_len = @min(entry.seq_len, 16),
        };
        var bi: u8 = 0;
        while (bi < branch.continuation_len) : (bi += 1) {
            branch.continuation[bi] = entry.seq[bi];
        }
        context.branches[context.branch_count] = branch;
        context.branch_count += 1;
    }
}

// =============================================================================
// findVCTSequenceFromFirstMove
// =============================================================================

/// 指定初手からのVCT手順を返す
pub fn findVCTSequenceFromFirstMove(
    cells: []Cell,
    first_move: Position,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
    collect_branches: bool,
) VCTSequenceResult {
    var result = VCTSequenceResult{
        .sequence = undefined,
        .len = 0,
        .is_forbidden_trap = false,
        .found = false,
        .branches = undefined,
        .branch_count = 0,
    };

    const idx = @as(u16, first_move.row) * BOARD_SIZE + first_move.col;
    if (cells[idx] != .empty) return result;

    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    // 詰み木アリーナを初期化（collect_branches 時のみ構築する。issue #122 レバー1）
    if (collect_branches) g_tree_arena.reset();

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT開始手として無効
    if (opponentBlocksThreePursuitAtRoot(cells, opponent, &limiter)) return result;

    // 仮配置（bitboard も同期）
    cells[idx] = color;
    bitboard.placeStone(first_move.row, first_move.col, color);

    // 五連チェック → 即勝ち
    if (forbidden.checkFive(cells, first_move.row, first_move.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(first_move.row, first_move.col);
        result.sequence[0] = first_move;
        result.len = 1;
        result.found = true;
        return result;
    }

    // 防御位置を列挙（issue #130: 脅威判定は列挙と同時に返るので `isThreat` は不要）
    const defense_positions = switch (getThreatDefensePositions(cells, first_move.row, first_move.col, color)) {
        .no_threat => {
            // 四でも活三でもない ＝ 追い詰めの初手ではない
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            return result;
        },
        .unstoppable => {
            // 防御不可の脅威 → 1 手で勝ち
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            result.sequence[0] = first_move;
            result.len = 1;
            result.found = true;
            return result;
        },
        .positions => |p| p,
    };

    // 全防御に対してVCT継続＆最短継続を記録（攻撃側の最短勝ちライン）
    var main_defense: ?Position = null;
    var main_continuation_seq: [64]Position = undefined;
    var main_continuation_len: u8 = 0;
    var main_is_forbidden_trap = false;

    // 詰み木用: 受けごとの継続ノード（collect_branches 時のみ。issue #122 レバー1）。
    // アリーナの defenses は「同一ノードぶんが連続していること」が前提なので、
    // ループ中はここに溜めておき、全受けを見終わってから addNodeMainFirst でまとめて積む。
    var tree_defenses: [MAX_DEFENSE_ENTRIES]ft.TreeDefense = undefined;
    var tree_defense_count: u8 = 0;

    for (0..defense_positions.len) |j| {
        const dp = defense_positions.items[j];

        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) continue;
        }

        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
        cells[def_idx] = opponent;
        bitboard.placeStone(dp.row, dp.col, opponent);

        const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);

        if (ct == .win) {
            cells[def_idx] = .empty;
            bitboard.removeStone(dp.row, dp.col);
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            return result;
        }

        var continuation_found = false;
        var cont_seq: [64]Position = undefined;
        var cont_len: u8 = 0;
        var cont_is_forbidden = false;
        // この受けに対する継続の詰み木 root（収集モードのときだけ構築する）
        var cont_node: u16 = ft.TREE_TERMINAL;
        // 受けエントリの上限に達していたら木は作らない（作っても捨てるだけ）。
        // 木を作らないぶん子探索も収集モードにしない（findVCTSequenceRecursive と同じ方針）。
        const use_collect = collect_branches and tree_defense_count < MAX_DEFENSE_ENTRIES;
        if (collect_branches and !use_collect) g_tree_arena.defense_truncated = true;
        // 採用されなかった／切り捨てられた受けの部分木は巻き戻す
        const def_snap = g_tree_arena.snapshot();

        if (ct == .four) {
            const block_pos = quiescence.getFourDefensePosition(cells, dp.row, dp.col, opponent).blockPos();
            if (block_pos == null) {
                cells[def_idx] = .empty;
                bitboard.removeStone(dp.row, dp.col);
                cells[idx] = .empty;
                bitboard.removeStone(first_move.row, first_move.col);
                return result;
            }
            const bp = block_pos.?;

            // `stop`（ブロック点が禁手 / ブロックしても攻めが続かない）なら
            // continuation_found が false のままになり、この受けで手順が切れる。
            const block_ok: ?BlockDefSeqResult = switch (classifyBlock(cells, bp, color, 0, &limiter)) {
                .stop => null,
                // ブロック石が五 → その場で勝ち（issue #140）。手順はブロック石で確定。
                .win_now => blockWinSeqResult(),
                .continue_search => blk: {
                    const block_idx = @as(u16, bp.row) * BOARD_SIZE + bp.col;
                    cells[block_idx] = color;
                    bitboard.placeStone(bp.row, bp.col, color);
                    const seq_result = processBlockDefensesSeq(cells, bp, color, 0, max_depth, &limiter, true);
                    cells[block_idx] = .empty;
                    bitboard.removeStone(bp.row, bp.col);
                    break :blk seq_result;
                },
            };

            if (block_ok) |ok| {
                if (ok.found and ok.seq_len_valid) {
                    cont_seq[0] = bp;
                    var si: u8 = 0;
                    while (si < ok.seq_len) : (si += 1) {
                        cont_seq[1 + si] = ok.seq[si];
                    }
                    cont_len = 1 + ok.seq_len;
                    cont_is_forbidden = ok.is_forbidden_trap;
                    continuation_found = true;
                    // ブロック四追いは受け一意の線形手順 → 線形チェイン木
                    if (use_collect) cont_node = g_tree_arena.buildLinearChain(cont_seq[0..], cont_len);
                }
            }
        } else if (ct == .three) {
            const vcf_depth = @min(CT_THREE_VCF_MAX_DEPTH, vcf_mod.VCF_MAX_DEPTH);
            const vcf_result = vcf_mod.findVCFSequenceWithParent(cells, color, vcf_depth, 0, 0, &limiter);
            if (vcf_result.found) {
                var si: u8 = 0;
                while (si < vcf_result.len) : (si += 1) {
                    cont_seq[si] = vcf_result.sequence[si];
                }
                cont_len = vcf_result.len;
                cont_is_forbidden = vcf_result.is_forbidden_trap;
                continuation_found = true;
                // 三防御後の VCF は受け一意の線形手順 → 線形チェイン木
                if (use_collect) cont_node = g_tree_arena.buildLinearChain(cont_seq[0..], cont_len);
            }
        } else {
            // ct=none: 通常のVCT探索
            // 共有 limiter の開始時刻・予算を引き継いだ子 limiter で回す（#119）。
            // 従来は findVCTSequence を呼び直しており、受けごとに time_limit が
            // まるごとリセットされていた（＝予算が受けの数だけ倍加していた）。
            // アリーナを reset しない内部版を使うのは、collect 時に
            // ここまで積んだ詰み木ノードを壊さないため（#122 レバー1）。
            var sub_limiter = limiter.child(0, 0);
            const sub = findVCTSequenceWithLimiter(cells, color, max_depth, &sub_limiter, use_collect, .lenient);
            limiter.charge(sub_limiter.nodes);
            if (sub.found) {
                var si: u8 = 0;
                while (si < sub.len) : (si += 1) {
                    cont_seq[si] = sub.sequence[si];
                }
                cont_len = sub.len;
                cont_is_forbidden = sub.is_forbidden_trap;
                continuation_found = true;
                cont_node = sub.tree_root;
            }
        }

        cells[def_idx] = .empty;
        bitboard.removeStone(dp.row, dp.col);

        // 木に載せない受けの部分木はアリーナから巻き戻す
        if (!continuation_found or !use_collect) g_tree_arena.rollback(def_snap);

        if (!continuation_found) {
            cells[idx] = .empty;
            bitboard.removeStone(first_move.row, first_move.col);
            return result;
        }

        // 最短の継続をメインラインとして記録（攻撃側の最短勝ちライン）
        if (main_defense == null or cont_len < main_continuation_len) {
            main_defense = dp;
            var si: u8 = 0;
            while (si < cont_len) : (si += 1) {
                main_continuation_seq[si] = cont_seq[si];
            }
            main_continuation_len = cont_len;
            main_is_forbidden_trap = cont_is_forbidden;
        }

        if (use_collect) {
            tree_defenses[tree_defense_count] = .{ .defender = dp, .child_node = cont_node };
            tree_defense_count += 1;
        }
    }

    cells[idx] = .empty;
    bitboard.removeStone(first_move.row, first_move.col);

    if (main_defense == null) return result;

    // 手順を組み立て: [初手, 防御手, 継続手順...]
    result.sequence[0] = first_move;
    result.sequence[1] = main_defense.?;
    var i: u8 = 0;
    while (i < main_continuation_len) : (i += 1) {
        if (2 + i < 64) {
            result.sequence[2 + i] = main_continuation_seq[i];
        }
    }
    result.len = 2 + main_continuation_len;
    result.is_forbidden_trap = main_is_forbidden_trap;
    result.found = true;

    // 初手ノードを構築。defenses[0] = メインライン（最短継続）を前出しする。
    // メインラインが受けの切り捨てで木に載っていない場合は 0（最初の受け）に倒す
    // （addNodeMainFirst 側でも範囲外は 0 に丸めるので二重に安全）。
    if (collect_branches and tree_defense_count > 0) {
        var main_tree_index: usize = 0;
        if (main_defense) |md| {
            var di: u8 = 0;
            while (di < tree_defense_count) : (di += 1) {
                const d = tree_defenses[di].defender;
                if (d.row == md.row and d.col == md.col) {
                    main_tree_index = di;
                    break;
                }
            }
        }
        result.tree_root = g_tree_arena.addNodeMainFirst(first_move, tree_defenses[0..tree_defense_count], main_tree_index);
    }
    result.nodes = limiter.nodes;
    return result;
}

// =============================================================================
// isVCTFirstMove
// =============================================================================

/// 指定手がVCT開始手として有効かチェック
pub fn isVCTFirstMove(
    cells: []Cell,
    move_pos: Position,
    color: Cell,
    max_depth: u8,
    time_limit: u32,
    max_nodes: u32,
) bool {
    const idx = @as(u16, move_pos.row) * BOARD_SIZE + move_pos.col;
    if (cells[idx] != .empty) return false;

    // トップレベルエントリ: bitboard を cells と同期
    bitboard.initFromCells(cells);
    ll.init();

    var limiter = TimeLimiter{
        .start_time = getTimestampMs(),
        .time_limit = time_limit,
        .nodes = 0,
        .max_nodes = max_nodes,
    };

    const opponent = color.opposite();

    // 相手に活三・ミセ手・VCFがあればVCT開始手として無効
    if (opponentBlocksThreePursuitAtRoot(cells, opponent, &limiter)) return false;

    // 仮配置（bitboard も同期）
    cells[idx] = color;
    bitboard.placeStone(move_pos.row, move_pos.col, color);

    // 五連チェック
    if (forbidden.checkFive(cells, move_pos.row, move_pos.col, color)) {
        cells[idx] = .empty;
        bitboard.removeStone(move_pos.row, move_pos.col);
        return true;
    }

    // 防御位置を列挙（issue #130: 脅威判定は列挙と同時に返るので `isThreat` は不要）
    const defense_positions = switch (getThreatDefensePositions(cells, move_pos.row, move_pos.col, color)) {
        .no_threat => {
            // 四でも活三でもない ＝ 追い詰めの手ではない
            cells[idx] = .empty;
            bitboard.removeStone(move_pos.row, move_pos.col);
            return false;
        },
        .unstoppable => {
            // 防御不可の脅威 → 勝ち
            cells[idx] = .empty;
            bitboard.removeStone(move_pos.row, move_pos.col);
            return true;
        },
        .positions => |p| p,
    };

    // 全防御に対してVCTが継続するか
    for (0..defense_positions.len) |j| {
        const dp = defense_positions.items[j];

        if (color == .white) {
            const fr = forbidden.checkForbiddenMove(cells, dp.row, dp.col);
            if (fr != .none) continue;
        }

        const def_idx = @as(u16, dp.row) * BOARD_SIZE + dp.col;
        cells[def_idx] = opponent;
        bitboard.placeStone(dp.row, dp.col, opponent);

        const ct = checkDefenseCounterThreat(cells, dp.row, dp.col, opponent);
        const vct_ok = evaluateCounterThreat(ct, cells, color, dp, 1, &limiter, max_depth);

        cells[def_idx] = .empty;
        bitboard.removeStone(dp.row, dp.col);

        if (!vct_ok) {
            cells[idx] = .empty;
            bitboard.removeStone(move_pos.row, move_pos.col);
            return false;
        }
    }

    cells[idx] = .empty;
    bitboard.removeStone(move_pos.row, move_pos.col);
    return true;
}

// =============================================================================
// ユーティリティ
// =============================================================================

fn cellAt(cells: []const Cell, r: i16, c: i16) Cell {
    return cells[@intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)))];
}

// =============================================================================
// タイムスタンプ取得
// =============================================================================

/// 壁時計（ms）。時計の SSoT は `deadline.nowMs`（ネイティブテストでは擬似時計）。
fn getTimestampMs() u32 {
    return deadline.nowMs();
}

// === Tests ===

const testing = std.testing;

/// テスト用: 受け点が列挙されていることを確認して一覧を取り出す。
/// `no_threat` / `unstoppable` ならテスト失敗（意図した分岐かを明示させる）。
fn expectPositions(defense: ThreatDefense) !PositionList {
    return switch (defense) {
        .positions => |p| p,
        .no_threat => error.UnexpectedNoThreat,
        .unstoppable => error.UnexpectedUnstoppable,
    };
}

test "classifyThreat: four detection" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連: (7,5),(7,6),(7,7) + 仮配置 (7,8)
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み
    bitboard.initFromCells(&cells);

    const result = classifyThreat(&cells, 7, 8, .black);
    try testing.expect(result.creates_four);
}

test "classifyThreat: open three detection" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒2連 + 仮配置で3連: (7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black; // 仮配置済み
    bitboard.initFromCells(&cells);

    const result = classifyThreat(&cells, 7, 8, .black);
    try testing.expect(result.creates_open_three);
}

test "hasOpenThree: basic" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活三: (7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    try testing.expect(hasOpenThree(&cells, .black));
    try testing.expect(!hasOpenThree(&cells, .white));
}

test "getThreatDefensePositions: four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,5),(7,6),(7,7),(7,8) 片端ブロック
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = try expectPositions(getThreatDefensePositions(&cells, 7, 8, .black));
    // 止め四: (7,9) の1点で防御
    try testing.expect(defense.len == 1);
    try testing.expectEqual(defense.items[0].col, 9);
}

test "getThreatDefensePositions: open four" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の活四: (7,5),(7,6),(7,7),(7,8) 両端空き
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.initFromCells(&cells);

    const defense = getThreatDefensePositions(&cells, 7, 8, .black);
    // 活四: 防御不可（issue #130 で「脅威なし」と区別）
    try testing.expectEqual(ThreatDefense.unstoppable, defense);
}

test "checkDefenseCounterThreat: basic" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白が3連 → 防御の仮配置で4連に
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[7 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 8] = .white; // 防御石配置
    bitboard.initFromCells(&cells);

    const ct = checkDefenseCounterThreat(&cells, 7, 8, .white);
    try testing.expect(ct == .four);
}

test "hasVCT: immediate five via VCF" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: VCFで即勝ち
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    const result = hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH);
    try testing.expect(result);
}

test "hasVCT: no threat" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    const result = hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH);
    try testing.expect(!result);
}

test "findVCTMove: immediate via VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTMove(&cells, .black, VCT_MAX_DEPTH, 0);
    try testing.expect(result != null);
}

test "findThreatMoves: four prioritized" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の3連 → 四を作れる
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    var buf: [225]Position = undefined;
    const count = findThreatMoves(&cells, .black, &buf);
    try testing.expect(count >= 2);
}

// === findVCTSequence Tests ===

test "findVCTSequence: immediate five via VCF" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: VCFで即勝ち
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(result.found);
    try testing.expect(result.len >= 1);
}

test "findVCTSequence: グローバル絶対デッドライン超過で即打ち切り（#147）" {
    // 「immediate five via VCF」と同じ盤面。通常は found=true。
    // 壁時計無制限（time_limit=0）で呼んでも、グローバル絶対デッドラインで止まる。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    try testing.expect(findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient).found);

    deadline.test_now_ms = 5000;
    defer deadline.test_now_ms = 0;
    deadline.set(1000);
    defer deadline.clear();

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
    try testing.expectEqual(@as(u8, 0), result.len);
}

test "findVCTSequence: no VCT" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
}

test "findVCTSequenceFromFirstMove: immediate five" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連: (7,4),(7,5),(7,6),(7,7)
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 1), result.len);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].row);
    try testing.expectEqual(@as(u8, 8), result.sequence[0].col);
}

test "findVCTSequenceFromFirstMove: occupied cell returns not found" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 7 }, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(!result.found);
}

test "isVCTFirstMove: immediate five" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 黒の4連
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = isVCTFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCT_MAX_DEPTH, 0, 0);
    try testing.expect(result);
}

test "isVCTFirstMove: not a threat" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;

    const result = isVCTFirstMove(&cells, .{ .row = 0, .col = 0 }, .black, VCT_MAX_DEPTH, 0, 0);
    try testing.expect(!result);
}

test "findVCTMove: 5-stone opening should not find VCT for white" {
    // 棋譜: H8 H9 J10 I9 G7
    // Black: H8(7,7), J10(5,9), G7(8,6)
    // White: H9(6,7), I9(6,8)
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[5 * BOARD_SIZE + 9] = .black; // J10
    cells[6 * BOARD_SIZE + 8] = .white; // I9
    cells[8 * BOARD_SIZE + 6] = .black; // G7

    // White should NOT have VCT in this early position
    const move = findVCTMove(&cells, .white, VCT_MAX_DEPTH, 5000);
    try testing.expect(move == null);
}

test "findVCTSequence: 5-stone opening should not find VCT for white" {
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .white;
    cells[5 * BOARD_SIZE + 9] = .black;
    cells[6 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 6] = .black;

    const result = findVCTSequence(&cells, .white, VCT_MAX_DEPTH, 5000, 500000, false, .lenient);
    try testing.expect(!result.found);
}

test "getThreatDefensePositions: black four with overline should not be undefendable" {
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

    // E8を基準に脅威防御判定: G8方向はoverlineで塞がり
    // → 防御不可（空リスト）ではなく、B8を含む防御位置を返すべき
    const defense = try expectPositions(getThreatDefensePositions(&cells, 7, 4, .black));
    try testing.expect(defense.len > 0); // 防御可能
    try testing.expectEqual(defense.items[0].row, 7);
    try testing.expectEqual(defense.items[0].col, 1); // B8
}

/// Issue #27 局面（10手目まで）をセットアップする共通ヘルパ
fn setupIssue27Position(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[6 * BOARD_SIZE + 6] = .white; // G9
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[7 * BOARD_SIZE + 5] = .white; // F8
    cells[5 * BOARD_SIZE + 7] = .black; // H10
    cells[6 * BOARD_SIZE + 7] = .white; // H9
    cells[6 * BOARD_SIZE + 8] = .black; // I9
    cells[6 * BOARD_SIZE + 5] = .white; // F9
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[4 * BOARD_SIZE + 6] = .white; // G11
}

test "findVCTMove: open three rejected when opponent has counter-four (issue #27)" {
    // 棋譜: H8 G9 G8 F8 H10 H9 I9 F9 J8 G11 (10手目まで)
    // 11手目の黒に勝ちVCTはない (J10活三は白E9のカウンターフォーで速度負けする)
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);
    bitboard.initFromCells(&cells);

    // 黒の勝ちVCTは存在しない（活三・四追いとも成立しない）
    const move = findVCTMoveWithBudget(&cells, .black, VCT_MAX_DEPTH, 0, 50000);
    try testing.expect(move == null);
}

test "findVCTSequence: rejects sequence broken by counter-four (issue #27)" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);
    bitboard.initFromCells(&cells);

    // 手順自体が見つからないこと（VCF-onlyフォールバック含めて勝ち手順なし）
    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 50000, false, .lenient);
    try testing.expect(!result.found);
}

test "isResilientToCounterFours: J10 sequence rejected by counter-four (issue #27)" {
    // 修正前にVCT探索が返していた手順 (J10で始まる活三起点)
    // 単独でカウンターフォー耐性検証関数を呼び、Resilientでないこと（false）を確認する
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);
    bitboard.initFromCells(&cells);

    // 旧VCT探索が誤って返していたシーケンス
    const seq = [_]Position{
        .{ .row = 5, .col = 9 }, // J10 (黒活三)
        .{ .row = 8, .col = 6 }, // G7 (白の "防御"想定)
        .{ .row = 4, .col = 10 }, // K11 (黒)
        .{ .row = 3, .col = 11 }, // L12 (白)
        .{ .row = 7, .col = 10 }, // K8 (黒)
        .{ .row = 7, .col = 8 }, // I8 (白)
        .{ .row = 8, .col = 10 }, // K7 (黒)
        .{ .row = 9, .col = 11 }, // L6 (白)
        .{ .row = 5, .col = 10 }, // K10 (黒)
        .{ .row = 6, .col = 10 }, // K9 (白)
        .{ .row = 5, .col = 8 }, // I10 (黒)
    };

    try testing.expect(!isResilientToCounterFours(&cells, .black, &seq, .lenient, null));
}

test "isResilientToCounterFours: empty sequence is trivially resilient" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    bitboard.initFromCells(&cells);

    const seq = [_]Position{};
    try testing.expect(isResilientToCounterFours(&cells, .black, &seq, .lenient, null));
}

test "isResilientToCounterFours: VCF (four-only) sequence is resilient" {
    // 全ての攻撃手が四ならカウンターフォー耐性チェックの対象外（trivially resilient）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    cells[7 * BOARD_SIZE + 6] = .black; // G8
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    bitboard.initFromCells(&cells);

    // I8 は四+五連完成手（VCF）。攻撃手はすべて四以上なら resilient
    const seq = [_]Position{
        .{ .row = 7, .col = 8 }, // I8 (五連完成)
    };

    try testing.expect(isResilientToCounterFours(&cells, .black, &seq, .lenient, null));
}

test "phantom: 偽の追い詰め(VCT)を防御側strictのみ棄却・攻めlenientは検出（非対称ゲート）" {
    // 実コーパス局面（hard★4 game4 ply13 相当）。黒の追い詰めは白のカウンター四
    // （ノリ手＝先手を奪う四）でテンポを奪われ崩壊する＝偽の追い詰め。
    // Rapfi-15s では白 -269〜-413（詰まない）ため我々の被詰み判定は偽陽性。
    //
    // 非対称の核心:
    //   lenient（攻めの探索）= 従来どおり検出（真正VCTを取りこぼさないため改変しない）
    //   strict（防御の被詰み判定）= ノリ手Tierゲートで棄却（幻の被詰みを解消）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const blacks = [_][2]u8{ .{ 6, 9 }, .{ 5, 8 }, .{ 7, 10 }, .{ 7, 9 }, .{ 9, 7 }, .{ 5, 9 }, .{ 7, 7 } };
    const whites = [_][2]u8{ .{ 9, 6 }, .{ 9, 5 }, .{ 4, 7 }, .{ 9, 4 }, .{ 10, 4 }, .{ 8, 9 }, .{ 7, 8 } };
    for (blacks) |b| cells[@as(usize, b[0]) * BOARD_SIZE + b[1]] = .black;
    for (whites) |w| cells[@as(usize, w[0]) * BOARD_SIZE + w[1]] = .white;
    bitboard.initFromCells(&cells);

    // ノード予算は 0（無制限）で比較する。#119 で VCT 経路がノードを計上する
    // ようになり、旧来ここで使っていた 500 ノードは本当に効く上限になったため
    // （この局面の lenient VCT は 500 ノードでは見つからない）。この検査の主眼は
    // 予算ではなく lenient / strict の非対称なので、予算差を排除して比べる。
    // lenient（攻め）は手を返す＝攻めの探索力は不変
    try testing.expect(findVCTMoveWithBudget(&cells, .black, 4, 0, 0) != null);
    // strict（防御）は null ＝幻の被詰みを棄却
    try testing.expect(findVCTMoveWithBudgetStrict(&cells, .black, 4, 0, 0) == null);
}

test "getThreatDefensePositions: 活三の受けに夏止め位置を含む（片側ブロック）" {
    // 盤面: (7,5)(7,6)(7,7) 横並び活三（方向 dr=0,dc=+1: 正方向=col増加）
    // 負方向外側(7,3)に白石でブロック → 夏止めは正方向(7,9)側のみ
    // 受け点は: 端(7,4)、端(7,8)、夏止め(7,9) の3点
    // （旧 getLineEnds 使用時は端の2点しか返らなかった）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 3] = .white; // 負方向外側をブロック → 正方向(7,9)に夏止めが発生
    bitboard.initFromCells(&cells);

    const defense = try expectPositions(getThreatDefensePositions(&cells, 7, 6, .black));
    // 端 (7,4) と (7,8) は必ず含む
    var has_end1 = false;
    var has_end2 = false;
    // 夏止め (7,9) を含む（負方向外側がブロックされたため正方向に夏止め）
    var has_natsudome = false;
    for (0..defense.len) |i| {
        const p = defense.items[i];
        if (p.row == 7 and p.col == 4) has_end1 = true;
        if (p.row == 7 and p.col == 8) has_end2 = true;
        if (p.row == 7 and p.col == 9) has_natsudome = true;
    }
    try testing.expect(has_end1);
    try testing.expect(has_end2);
    try testing.expect(has_natsudome);
}

test "getThreatDefensePositions: 夏止め済みの活三は緊急の受け不要" {
    // 盤面: 両外側(7,3)(7,9)に白石を置いた形（X_●●●_X）
    // 活三は活四にできないため、この方向からの受け点が追加されない
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 3] = .white; // 正方向の夏止め済み
    cells[7 * BOARD_SIZE + 9] = .white; // 負方向の夏止め済み
    bitboard.initFromCells(&cells);

    // getOpenThreeDefensePositions は空リストを返す（夏止め済み）
    // → この方向から受け点が追加されないことを確認
    // 他方向（縦・斜め）にも脅威がないので「脅威なし」（issue #130 で活四と区別）
    const defense = getThreatDefensePositions(&cells, 7, 6, .black);
    try testing.expectEqual(ThreatDefense.no_threat, defense);
}

test "checkDefenseCounterThreat: 夏止め済みの三のみを作る石は .none" {
    // 盤面: X_●●●_X（白(7,3)(7,9)、黒(7,5)(7,6)(7,7)）
    // ブロック石が「夏止め済みの三」のみを作る場合、活四にできない＝本物の
    // カウンター脅威でないため .three でなく .none を返すべき。
    // .three のままだと processBlockDefenses で受け点空リスト→偽勝ちの残存経路になる。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black; // ブロック石（夏止め済み三のみを作る）
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&cells);

    const ct = checkDefenseCounterThreat(&cells, 7, 7, .black);
    try testing.expect(ct == .none);
}

test "classifyThreat: 夏止め済みの三は活三でない（脅威手に含まれない）" {
    // 盤面: X_●●●_X（白(7,3)(7,9)、黒(7,5)(7,6)(7,7)）
    // 両外側がブロックされた三は活四にできないため脅威ではない。
    // creates_open_three=true のままだと受け点が空リスト（夏止め済み）と組み合わさり
    // 「防御不能＝VCT成立」と誤断定される（偽VCT）。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black; // 黒が最後の1石を置いた形
    cells[7 * BOARD_SIZE + 3] = .white; // 負方向外側ブロック
    cells[7 * BOARD_SIZE + 9] = .white; // 正方向外側ブロック
    bitboard.initFromCells(&cells);

    const result = classifyThreat(&cells, 7, 7, .black);
    try testing.expect(!result.creates_open_three);
    try testing.expect(!result.creates_four);
}

test "hasVCT: 夏止め済みの三しか作れない局面で偽VCTが成立しない" {
    // 盤面: X_●●_._X（白(7,3)(7,9)、黒(7,5)(7,6)）
    // 黒の唯一の「三を作る手」は(7,7)だが、できる三は夏止め済み（X_●●●_X）で
    // 活四にできない＝脅威でない。受け点が空リストでも「防御不能＝勝ち」と
    // 誤断定してはならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH));
}

/// issue #116 の実戦棋譜の 17 石局面（左下原点・黒先手・白番）
///
/// "H8 H9 J10 I9 G9 I7 I8 J8 H10 K9 L10 K7 K10 I10 J9 H7 J7"
fn setupIssue116Position(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // 1. H8
    cells[6 * BOARD_SIZE + 7] = .white; // 2. H9
    cells[5 * BOARD_SIZE + 9] = .black; // 3. J10
    cells[6 * BOARD_SIZE + 8] = .white; // 4. I9
    cells[6 * BOARD_SIZE + 6] = .black; // 5. G9
    cells[8 * BOARD_SIZE + 8] = .white; // 6. I7
    cells[7 * BOARD_SIZE + 8] = .black; // 7. I8
    cells[7 * BOARD_SIZE + 9] = .white; // 8. J8
    cells[5 * BOARD_SIZE + 7] = .black; // 9. H10
    cells[6 * BOARD_SIZE + 10] = .white; // 10. K9
    cells[5 * BOARD_SIZE + 11] = .black; // 11. L10
    cells[8 * BOARD_SIZE + 10] = .white; // 12. K7
    cells[5 * BOARD_SIZE + 10] = .black; // 13. K10
    cells[5 * BOARD_SIZE + 8] = .white; // 14. I10
    cells[6 * BOARD_SIZE + 9] = .black; // 15. J9
    cells[8 * BOARD_SIZE + 7] = .white; // 16. H7
    cells[8 * BOARD_SIZE + 9] = .black; // 17. J7
}

test "hasVCT: 相手にミセ手がある局面で三の追いでは偽VCTが成立しない（issue #116）" {
    // 上記17石局面に、偽VCT手順の分岐 18.白M5 19.黒L6 20.白G8 21.黒J11 を
    // 進めた局面（白番）。この局面で黒は四三点 J12 を持つ（ミセ手）。
    // 白は四追いで勝てないため、三で追う手順は黒の四三に先行されて崩れる
    // ＝VCTは不成立でなければならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue116Position(&cells);
    cells[10 * BOARD_SIZE + 12] = .white; // 18. M5
    cells[9 * BOARD_SIZE + 11] = .black; // 19. L6
    cells[7 * BOARD_SIZE + 6] = .white; // 20. G8
    cells[4 * BOARD_SIZE + 9] = .black; // 21. J11
    bitboard.initFromCells(&cells);

    // 前提: 黒に活三はないがミセ手はある（＝活三チェックだけでは弾けない）
    try testing.expect(!hasOpenThree(&cells, .black));
    try testing.expect(hasFourThreeAvailable(&cells, .black));

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasVCT(&cells, .white, 0, &limiter, VCT_MAX_DEPTH));
}

test "findVCTSequence: 途中でミセ手を持たれる三の手順をVCTとして返さない（issue #116）" {
    // 17石局面（白番）。開始局面では黒に活三・ミセ手・VCFがないため
    // エントリのガードは通過するが、手順の途中（21.黒J11 の後）で黒がミセ手を得る。
    // 白にVCFはないので、VCTとしても成立してはならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue116Position(&cells);
    // bitboard は findVCTSequence がトップレベルエントリで initFromCells する

    const result = findVCTSequence(&cells, .white, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
}

test "hasVCT: 四で相手の活三を潰してから三で追う手順は成立する（issue #116 の意味論）" {
    // 1. の意味論（ノード単位の棄却ではなく「三の攻め手のみ不可」）の正当化。
    // 修正前（相手に活三があれば即 return false）ではこの局面は VCT なしと判定される。
    //
    // 白（攻め）: 行7に (7,4)(7,5)(7,6)。(7,3) は黒石なので夏止めの三＝活三ではない。
    //             (7,7) に打つと四（受けは (7,8) の一点）。
    //             さらに (7,7) は黒の斜め活三の伸び先でもあるので、この四で黒の活三が消える。
    // 黒（受け）: 斜めに (4,4)(5,5)(6,6) の活三（伸び先 (3,3)/(7,7)）。
    // 受けを強制したあと、白は (10,7) の三三で勝つ。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 白の四の種（行7）
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    // 白の三三の種: 行10 と 列7 が (10,7) で交差
    cells[10 * BOARD_SIZE + 5] = .white;
    cells[10 * BOARD_SIZE + 6] = .white;
    cells[11 * BOARD_SIZE + 7] = .white;
    cells[12 * BOARD_SIZE + 7] = .white;
    // 黒: 行7の三の片端を止める石と、斜めの活三
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[4 * BOARD_SIZE + 4] = .black;
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[6 * BOARD_SIZE + 6] = .black;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 前提: 黒は活三を持つ（＝旧実装ならこの時点で VCT 不成立と判定された）
    try testing.expect(opponentBlocksThreePursuit(&cells, .black));
    // 前提: 白に VCF はない（四追いだけでは勝てない ＝ 三の追いが必要）
    try testing.expect(!vcf_mod.hasVCF(&cells, .white, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));

    try testing.expect(hasVCT(&cells, .white, 0, &limiter, VCT_MAX_DEPTH));
}

/// issue #115 の実戦棋譜の 20 石局面（左下原点・黒先手・黒番）
///
/// 実戦 14 手 "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9" に
/// 偽 VCT 手順の先頭 "15.L7 16.M6 17.L8 18.L6 19.J7 20.M10" を進めた局面。
/// 8 行目は G8 H8 _ J8 K8 L8（黒）で、黒が I8 に打つと 6 連＝長連になるため
/// J8 は「跳び四」ではなく三でしかない。
fn setupIssue115BranchPosition(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black; // 1. H8
    cells[8 * BOARD_SIZE + 7] = .white; // 2. H7
    cells[7 * BOARD_SIZE + 6] = .black; // 3. G8
    cells[6 * BOARD_SIZE + 6] = .white; // 4. G9
    cells[5 * BOARD_SIZE + 8] = .black; // 5. I10
    cells[6 * BOARD_SIZE + 7] = .white; // 6. H9
    cells[6 * BOARD_SIZE + 9] = .black; // 7. J9
    cells[5 * BOARD_SIZE + 9] = .white; // 8. J10
    cells[7 * BOARD_SIZE + 10] = .black; // 9. K8
    cells[4 * BOARD_SIZE + 7] = .white; // 10. H11
    cells[6 * BOARD_SIZE + 11] = .black; // 11. L9
    cells[6 * BOARD_SIZE + 10] = .white; // 12. K9
    cells[4 * BOARD_SIZE + 8] = .black; // 13. I11
    cells[6 * BOARD_SIZE + 8] = .white; // 14. I9
    cells[8 * BOARD_SIZE + 11] = .black; // 15. L7
    cells[9 * BOARD_SIZE + 12] = .white; // 16. M6
    cells[7 * BOARD_SIZE + 11] = .black; // 17. L8
    cells[9 * BOARD_SIZE + 11] = .white; // 18. L6
    cells[8 * BOARD_SIZE + 9] = .black; // 19. J7
    cells[5 * BOARD_SIZE + 12] = .white; // 20. M10
}

test "getThreatDefensePositions: 長連にしかならない跳び四は受けを1点に絞らない（issue #115）" {
    // 20 石局面（黒番）に黒 J8 を置いた局面。
    // 8 行目: G8 H8 _ J8 K8 L8 で、ギャップ I8 は黒が打つと 6 連＝長連。
    // よって J8 は四ではなく三であり（classifyThreat と同基準）、
    // 受けを跳び四のギャップ I8 の 1 点に絞ってはならない。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue115BranchPosition(&cells);
    cells[7 * BOARD_SIZE + 9] = .black; // 21. J8
    bitboard.initFromCells(&cells);

    // 前提: 分類側は長連補正済みで「四ではない三」と判定している
    const classification = classifyThreat(&cells, 7, 9, .black);
    try testing.expect(!classification.creates_four);
    try testing.expect(classification.creates_open_three);

    // 受け点も同基準でなければならない: I8 の 1 点強制ではなく M8 / I8 / N8
    const defense = try expectPositions(getThreatDefensePositions(&cells, 7, 9, .black));
    try testing.expectEqual(@as(usize, 3), defense.len);

    var has_m8 = false;
    var has_i8 = false;
    var has_n8 = false;
    for (0..defense.len) |i| {
        const p = defense.items[i];
        if (p.row == 7 and p.col == 12) has_m8 = true; // M8
        if (p.row == 7 and p.col == 8) has_i8 = true; // I8
        if (p.row == 7 and p.col == 13) has_n8 = true; // N8
    }
    try testing.expect(has_m8);
    try testing.expect(has_i8);
    try testing.expect(has_n8);
}

test "getThreatDefensePositions: 同一ラインに長連ギャップと正当なギャップが併存する場合は後者を受けにする（issue #115）" {
    // 上記 20 石局面に 21.黒K7 22.白M7 23.黒N8 24.白O8 25.黒J8 を進めた局面。
    // 8 行目は G8 H8 _ J8 K8 L8 _ N8（黒）/ O8（白）。
    //   - I8 側の窓 (G8 H8 _ J8 K8): 埋めると G8..L8 の 6 連＝長連で五にならない
    //   - M8 側の窓 (J8 K8 L8 _ N8): 埋めると J8..N8 の五 ＝ こちらが本物の跳び四
    // J8 は本物の四なので受けは 1 点に絞ってよいが、その 1 点は M8 であって I8 ではない。
    // findJumpGapPosition は 5 マス窓をラインの先頭から走査して最初のギャップを返すため、
    // 素通しだと長連ギャップ I8 を受けとして返してしまう。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue115BranchPosition(&cells);
    cells[8 * BOARD_SIZE + 10] = .black; // 21. K7
    cells[8 * BOARD_SIZE + 12] = .white; // 22. M7
    cells[7 * BOARD_SIZE + 13] = .black; // 23. N8
    cells[7 * BOARD_SIZE + 14] = .white; // 24. O8
    cells[7 * BOARD_SIZE + 9] = .black; // 25. J8
    bitboard.initFromCells(&cells);

    // 前提: J8 は本物の四（M8 側の跳び四）
    try testing.expect(classifyThreat(&cells, 7, 9, .black).creates_four);

    // 受けは M8 の 1 点のみ（I8 は埋めると長連なので五点ではない）
    const defense = try expectPositions(getThreatDefensePositions(&cells, 7, 9, .black));
    try testing.expectEqual(@as(usize, 1), defense.len);
    try testing.expectEqual(@as(u8, 7), defense.items[0].row);
    try testing.expectEqual(@as(u8, 12), defense.items[0].col); // M8
}

test "getThreatDefensePositions: 最も近いギャップが長連でも遠い五点を受けとして返す（issue #124 レビュー）" {
    // 8 行目（row=7）: C8白 D8黒 E8黒 F8黒 G8空 H8黒(着手) I8空 J8黒 K8黒 L8黒 M8黒 N8白
    //
    // H8 の連は 1 石（G8/I8 が空）。跳び四パターンは D8..H8 の `B B B _ B`。
    // - 最も近いギャップ I8 を埋めると H8..M8 の 6 連＝長連（五にならない）
    // - 遠いギャップ G8 を埋めると D8..H8 の五 ＝ **本物の受け**
    //
    // 旧実装の `isJumpFourOverline` は「+方向の最初のギャップ」＝ I8 だけを見て
    // 「長連だから四ではない」と判断し、跳び四ブランチごと落としていた。
    // H8 の連は 3 でも 4 でもないので活三フォールバックも効かず、受け 0 点になる。
    // 一方 `classifyThreat` は（#124 の SSoT 化後）G8 を五点として四と分類するため、
    // 「四なのに受け 0 点」＝呼び出し側が防御不可（＝偽 VCT）と誤認する穴が開く。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .white; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    // G8 (6) は空
    cells[7 * BOARD_SIZE + 7] = .black; // H8（着手）
    // I8 (8) は空
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[7 * BOARD_SIZE + 10] = .black; // K8
    cells[7 * BOARD_SIZE + 11] = .black; // L8
    cells[7 * BOARD_SIZE + 12] = .black; // M8
    cells[7 * BOARD_SIZE + 13] = .white; // N8
    bitboard.initFromCells(&cells);

    // 前提: 分類側は四と言う（G8 が五点）
    try testing.expect(classifyThreat(&cells, 7, 7, .black).creates_four);

    // 受け点は G8 を含むこと（0 点＝防御不可にしてはならない）
    const defense = try expectPositions(getThreatDefensePositions(&cells, 7, 7, .black));
    try testing.expect(defense.len > 0);
    var has_g8 = false;
    for (0..defense.len) |i| {
        if (defense.items[i].row == 7 and defense.items[i].col == 6) has_g8 = true;
    }
    try testing.expect(has_g8);
}

test "hasOpenThree: 偽跳び四の裏はウソ三なので活三としない（issue #121）" {
    ll.init();
    // 8 行目に黒 C8 D8 _ F8 G8 H8（col = 2,3,[4],5,6,7）。
    // LUT は F8/G8/H8 から `D8 _ F8 G8 H8` を跳び四と報告するが、窓（中心 ±4）の外の
    // C8 のせいで E8 を埋めると 6 連＝長連。四ではない。
    // かつ F8 G8 H8 は達四にできない（E8 側は長連・I8 側は止め四）ウソ三でもある。
    // 四判定を五点列挙に寄せた（#121）だけだとここが活三として流入するので、
    // 黒のウソ三ガードも併せて入れてある。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    for ([_]u8{ 2, 3, 5, 6, 7 }) |c| {
        cells[7 * BOARD_SIZE + c] = .black;
    }
    bitboard.initFromCells(&cells);

    try testing.expect(!hasOpenThree(&cells, .black));
}

test "hasOpenThree: 窓外の石が無ければ同じ 3 連は本物の活三（対比・issue #121）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    for ([_]u8{ 5, 6, 7 }) |c| {
        cells[7 * BOARD_SIZE + c] = .black;
    }
    bitboard.initFromCells(&cells);

    try testing.expect(hasOpenThree(&cells, .black));
}

test "hasOpenThree: 本物の跳び四は三として数えない（回帰）" {
    ll.init();
    // 白 E8 F8 G8 _ I8（col = 4,5,6,[7],8）。H8 を埋めれば五 ＝ 本物の跳び四。
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    for ([_]u8{ 4, 5, 6, 8 }) |c| {
        cells[7 * BOARD_SIZE + c] = .white;
    }
    bitboard.initFromCells(&cells);

    try testing.expect(!hasOpenThree(&cells, .white));
}

// =============================================================================
// issue #117 / #118 の回帰テスト
// =============================================================================

/// issue #117 の再現局面（白番・攻めは白）
///
/// - 行3: 黒(3,3) / 白(3,4)(3,5)(3,6) / 空(3,7)(3,8) / 黒(3,9)(3,10)(3,11) / 空(3,12)
///   白 (3,7) が四（受けは (3,8) 一点）。黒 (3,8) は黒の四（受けは (3,12) 一点）。
/// - 白 (4,12)(5,12) と (4,11)(5,10): ブロック点 (3,12) に打つと縦横斜めの活三が 2 本
///   できる（＝block_ct は .three。四ではないので黒に受ける義務はない）。
/// - 黒 (10,4)(10,5)(10,6): ブロック後の局面で黒が持つ活三。黒は白の三を無視して
///   達四を作れるため、白の「三の追い」は間に合わない＝VCT は不成立。
fn setupIssue117Position(cells: []Cell) void {
    cells[3 * BOARD_SIZE + 3] = .black;
    cells[3 * BOARD_SIZE + 4] = .white;
    cells[3 * BOARD_SIZE + 5] = .white;
    cells[3 * BOARD_SIZE + 6] = .white;
    cells[3 * BOARD_SIZE + 9] = .black;
    cells[3 * BOARD_SIZE + 10] = .black;
    cells[3 * BOARD_SIZE + 11] = .black;
    cells[4 * BOARD_SIZE + 12] = .white;
    cells[5 * BOARD_SIZE + 12] = .white;
    cells[4 * BOARD_SIZE + 11] = .white;
    cells[5 * BOARD_SIZE + 10] = .white;
    cells[10 * BOARD_SIZE + 4] = .black;
    cells[10 * BOARD_SIZE + 5] = .black;
    cells[10 * BOARD_SIZE + 6] = .black;
}

test "issue #117 前提: カウンター四のブロック石は三しか作らず、その局面で相手は活三を持つ" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue117Position(&cells);
    bitboard.initFromCells(&cells);

    // 白の四 (3,7) の受けは (3,8) 一点
    cells[3 * BOARD_SIZE + 7] = .white;
    bitboard.placeStone(3, 7, .white);
    const def = try expectPositions(getThreatDefensePositions(&cells, 3, 7, .white));
    try testing.expectEqual(@as(usize, 1), def.len);
    try testing.expectEqual(@as(u8, 3), def.items[0].row);
    try testing.expectEqual(@as(u8, 8), def.items[0].col);

    // 黒 (3,8) はカウンター四、受けは (3,12) 一点
    cells[3 * BOARD_SIZE + 8] = .black;
    bitboard.placeStone(3, 8, .black);
    try testing.expectEqual(CounterThreat.four, checkDefenseCounterThreat(&cells, 3, 8, .black));
    const bp = quiescence.getFourDefensePosition(&cells, 3, 8, .black).blockPos();
    try testing.expect(bp != null);
    try testing.expectEqual(@as(u8, 3), bp.?.row);
    try testing.expectEqual(@as(u8, 12), bp.?.col);

    // ブロック石 (3,12) は四ではなく三しか作らない
    cells[3 * BOARD_SIZE + 12] = .white;
    bitboard.placeStone(3, 12, .white);
    try testing.expectEqual(CounterThreat.three, checkDefenseCounterThreat(&cells, 3, 12, .white));
    // その局面で黒は活三を持つ（＝白の三を無視して達四を作れる）
    try testing.expect(opponentBlocksThreePursuit(&cells, .black));
}

test "hasVCT: カウンター四のブロックが三しか作らず相手に活三がある場合は偽VCT（issue #117）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue117Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasVCT(&cells, .white, 0, &limiter, VCT_MAX_DEPTH));
}

test "findVCTSequence: ct=four ブロック経路の偽VCTを返さない（issue #117）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue117Position(&cells);

    const result = findVCTSequence(&cells, .white, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
}

/// issue #118 の再現局面（黒番・攻めは黒、受けの白が VCF を持つ）
///
/// - 黒 (7,7)(7,8) と斜めの種 (8,5)(9,4) / (8,11)(9,12):
///   黒 (7,9) で活三ができ、白がどちらの端を受けても黒は四三で勝てる
///   ＝「三の追い」だけで成立する VCT（四の初手はない）。
/// - 白 (1,1)(1,2)(1,3)（左は黒(1,0)で止まり）＋ (2,4)(3,4)(4,4)（下は黒(5,4)で止まり）:
///   白 (1,4) が四四になるため白には VCF がある。ただし白に活三もミセ手もないので
///   #116 のガード（活三 or ミセ手）では検出できない。
fn setupIssue118Position(cells: []Cell) void {
    // 黒（攻め）
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[8 * BOARD_SIZE + 5] = .black;
    cells[9 * BOARD_SIZE + 4] = .black;
    cells[8 * BOARD_SIZE + 11] = .black;
    cells[9 * BOARD_SIZE + 12] = .black;
    // 白（受け）の VCF: (1,4) が四四
    cells[1 * BOARD_SIZE + 1] = .white;
    cells[1 * BOARD_SIZE + 2] = .white;
    cells[1 * BOARD_SIZE + 3] = .white;
    cells[2 * BOARD_SIZE + 4] = .white;
    cells[3 * BOARD_SIZE + 4] = .white;
    cells[4 * BOARD_SIZE + 4] = .white;
    cells[1 * BOARD_SIZE + 0] = .black;
    cells[5 * BOARD_SIZE + 4] = .black;
}

test "issue #118 前提: 相手は活三もミセ手も持たないが VCF を持つ" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue118Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasOpenThree(&cells, .white));
    try testing.expect(!hasFourThreeAvailable(&cells, .white));
    try testing.expect(!opponentBlocksThreePursuit(&cells, .white));
    try testing.expect(vcf_mod.hasVCF(&cells, .white, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));
    // 攻め側（黒）に VCF はない＝三で追うしかない
    try testing.expect(!vcf_mod.hasVCF(&cells, .black, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));
}

test "hasVCT: 相手が VCF を持つ局面で三の追いによる偽VCTが成立しない（issue #118）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue118Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH));
}

test "findVCTSequence: 相手 VCF を持つ局面の三の追いを VCT として返さない（issue #118）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue118Position(&cells);

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
}

test "blockThreatContinues: 三のブロックは相手の活三で不成立・四/五なら継続（issue #117）" {
    // issue #117 の再現局面のブロック直後（白(3,7)四 → 黒(3,8)カウンター四 → 白(3,12)ブロック）
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue117Position(&cells);
    cells[3 * BOARD_SIZE + 7] = .white;
    cells[3 * BOARD_SIZE + 8] = .black;
    cells[3 * BOARD_SIZE + 12] = .white;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // ブロック石は三しか作らない ＆ 黒は活三を持つ → 継続不可
    try testing.expectEqual(CounterThreat.three, checkDefenseCounterThreat(&cells, 3, 12, .white));
    try testing.expect(!blockThreatContinues(.three, &cells, .black, 0, &limiter));
    // 四/五なら受けは強制なので相手の活三と無関係に継続可
    try testing.expect(blockThreatContinues(.four, &cells, .black, 0, &limiter));
    try testing.expect(blockThreatContinues(.win, &cells, .black, 0, &limiter));
    // 脅威なしは継続不可
    try testing.expect(!blockThreatContinues(.none, &cells, .black, 0, &limiter));

    // 黒の活三（行10）を消すと、三のブロックでも継続可
    cells[10 * BOARD_SIZE + 4] = .empty;
    cells[10 * BOARD_SIZE + 5] = .empty;
    cells[10 * BOARD_SIZE + 6] = .empty;
    bitboard.initFromCells(&cells);
    try testing.expect(blockThreatContinues(.three, &cells, .black, 0, &limiter));
}

test "findVCTSequenceFromFirstMove: ct=four ブロック経路でも偽VCTを返さない（issue #117）" {
    // findVCTByFirstMoveIteration（振り返り）から wasm 経由で呼ばれる live 経路。
    // この局面はエントリのガード（黒の活三）で棄却されるため修正前から緑だが、
    // 判別力のあるテストは上の hasVCT / blockThreatContinues 側にある。
    // エントリをすり抜ける局面（ブロック後にはじめて受け手が脅威を得る形）は、
    // 「受け手の counter-four の石が新たに脅威を作る」＝その石が根の時点で
    // 四三点（ミセ手）になるため、エントリのミセ手ガードが必ず先に発火する。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue117Position(&cells);

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 3, .col = 7 }, .white, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(!result.found);
}

test "opponentBlocksThreePursuitWithShallowVCF: 相手VCFはノード深さ1まで検出しそれ以降は見ない（issue #118）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue118Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 白は活三もミセ手も持たないので、検出できるのは VCF プローブのみ
    try testing.expect(!opponentBlocksThreePursuit(&cells, .white));
    try testing.expect(opponentBlocksThreePursuitWithShallowVCF(&cells, .white, 0, &limiter));
    try testing.expect(opponentBlocksThreePursuitWithShallowVCF(&cells, .white, OPPONENT_VCF_PROBE_MAX_NODE_DEPTH, &limiter));
    try testing.expect(!opponentBlocksThreePursuitWithShallowVCF(&cells, .white, OPPONENT_VCF_PROBE_MAX_NODE_DEPTH + 1, &limiter));
    // プローブの消費ノードは呼び出し元 limiter に加算される（#119 の部分払い）
    try testing.expect(limiter.nodes > 0);
}

// =============================================================================
// issue #119: VCT 経路のノード計上
// =============================================================================

/// 四が一切作れない（＝VCF 経路がノードを消費しない）局面を作る。
///
/// 黒 (7,7)(7,8) の 2 連だけ。脅威手は活三を作る手のみで四は無いので、
/// `vcf_mod.hasVCF` は四手の列挙で 0 手＝ノード消費 0 になる。
/// したがって計上されたノードはすべて VCT 経路由来と言い切れる。
fn setupThreeOnlyPosition(cells: []Cell) void {
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .black;
}

test "hasVCT: 四の無い局面でも攻め手をノードとして計上する（issue #119）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupThreeOnlyPosition(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 前提: 黒に四は無い＝VCF はノードを消費しない（修正前はここが 0 のままだった）
    try testing.expect(!vcf_mod.hasVCF(&cells, .black, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));
    try testing.expectEqual(@as(u32, 0), limiter.nodes);

    _ = hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH);
    try testing.expect(limiter.nodes > 0);
}

test "hasVCT: max_nodes が探索を打ち切る（issue #119）" {
    // 「四で相手の活三を潰してから三で追う」ケース（無制限なら true）と同じ局面。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[7 * BOARD_SIZE + 6] = .white;
    cells[10 * BOARD_SIZE + 5] = .white;
    cells[10 * BOARD_SIZE + 6] = .white;
    cells[11 * BOARD_SIZE + 7] = .white;
    cells[12 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 3] = .black;
    cells[4 * BOARD_SIZE + 4] = .black;
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[6 * BOARD_SIZE + 6] = .black;
    bitboard.initFromCells(&cells);

    var unlimited = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };
    try testing.expect(hasVCT(&cells, .white, 0, &unlimited, VCT_MAX_DEPTH));

    var tight = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 1 };
    try testing.expect(!hasVCT(&cells, .white, 0, &tight, VCT_MAX_DEPTH));
}

test "findVCTSequence: 消費ノード数を結果に返す（issue #119）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupThreeOnlyPosition(&cells);

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
    // 修正前は VCT 経路が一切ノードを進めなかったため 0 だった
    try testing.expect(result.nodes > 0);
}

test "findVCTSequence: max_nodes が探索を打ち切る（issue #119）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue27Position(&cells);

    const unlimited = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    const tight = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 1, false, .lenient);
    // 予算 1 ノードでは無制限探索より消費が小さい（＝上限が機能している）
    try testing.expect(tight.nodes < unlimited.nodes);
}

test "findVCTSequenceFromFirstMove: collect_branches で詰み木を構築する（issue #122）" {
    // 収集モードの重い統合テストの定位置は `vct_tree_test.zig`（test-slow）だが、
    // これは 8 石の合成局面で即座に終わる軽量テストなので pre-commit 側に置く。
    // 修正前は `_ = collect_branches;` で引数が黙って捨てられており、
    // wasm から collect_branches=1 を渡しても木は返らなかった。
    // 行7: 黒 (7,2) が端を止めた白 3 連 → 白 (7,6) が四（受けは (7,7) 一点）。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .black;
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[10 * BOARD_SIZE + 6] = .white;
    cells[10 * BOARD_SIZE + 7] = .white;
    cells[11 * BOARD_SIZE + 8] = .white;
    cells[12 * BOARD_SIZE + 8] = .white;

    const first_move = Position{ .row = 7, .col = 6 };

    const without_tree = findVCTSequenceFromFirstMove(&cells, first_move, .white, 6, 0, 0, false);
    try testing.expect(without_tree.found);
    try testing.expectEqual(ft.TREE_TERMINAL, without_tree.tree_root);

    const with_tree = findVCTSequenceFromFirstMove(&cells, first_move, .white, 6, 0, 0, true);
    try testing.expect(with_tree.found);
    try testing.expect(with_tree.tree_root != ft.TREE_TERMINAL);
    // 木の根は初手そのもの
    try testing.expectEqual(first_move.row, g_tree_arena.nodes[with_tree.tree_root].attacker.row);
    try testing.expectEqual(first_move.col, g_tree_arena.nodes[with_tree.tree_root].attacker.col);
    // 根の受けは 1 点以上あり、メインライン（手順の 2 手目）が defenses[0]
    const root = g_tree_arena.nodes[with_tree.tree_root];
    try testing.expect(root.defense_count > 0);
    try testing.expectEqual(with_tree.sequence[1].row, g_tree_arena.defenses[root.defense_start].defender.row);
    try testing.expectEqual(with_tree.sequence[1].col, g_tree_arena.defenses[root.defense_start].defender.col);
}

test "findVCTSequenceRecursive: max_len 未満の手順しか返さない（issue #122 レバー2）" {
    // 行7: 黒 (7,2) が端を止めた白 3 連 → 白 (7,6) の四から手順長 5 で詰む局面。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .black;
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[10 * BOARD_SIZE + 6] = .white;
    cells[10 * BOARD_SIZE + 7] = .white;
    cells[11 * BOARD_SIZE + 8] = .white;
    cells[12 * BOARD_SIZE + 8] = .white;

    // 上限なしの手順長を基準にする
    const full = findVCTSequence(&cells, .white, 6, 0, 0, false, .lenient);
    try testing.expect(full.found);
    const full_len = full.len;
    try testing.expect(full_len > 1);

    bitboard.initFromCells(&cells);
    var limiter = TimeLimiter{ .start_time = 0, .time_limit = 0, .nodes = 0, .max_nodes = 0 };

    // 上限 = 実際の手順長 → 「これ未満」を満たせないので見つからない
    {
        var context = VCTRecursiveContext{
            .is_forbidden_trap = false,
            .collect_branches = false,
            .branches = undefined,
            .branch_count = 0,
        };
        var seq: [64]Position = undefined;
        var len: u8 = 0;
        try testing.expect(!findVCTSequenceRecursive(&cells, .white, 0, 6, &limiter, &seq, &len, &context, full_len));
    }

    // 上限 = 手順長 + 1 → 従来どおり同じ手順が見つかる
    {
        var context = VCTRecursiveContext{
            .is_forbidden_trap = false,
            .collect_branches = false,
            .branches = undefined,
            .branch_count = 0,
        };
        var seq: [64]Position = undefined;
        var len: u8 = 0;
        try testing.expect(findVCTSequenceRecursive(&cells, .white, 0, 6, &limiter, &seq, &len, &context, full_len + 1));
        try testing.expectEqual(full_len, len);
        var i: u8 = 0;
        while (i < len) : (i += 1) {
            try testing.expectEqual(full.sequence[i].row, seq[i].row);
            try testing.expectEqual(full.sequence[i].col, seq[i].col);
        }
    }
}

test "VCT探索は委譲した VCF のノードも予算に計上する（issue #119）" {
    // VCT 経路は VCF を独自 limiter で回すので、その消費を親へ加算しないと
    // 予算が実態より小さく見える（＝ max_nodes が緩む）。
    // 白 (7,6) の四から始まる局面は VCF 探索が実際に走る。
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .black;
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 4] = .white;
    cells[7 * BOARD_SIZE + 5] = .white;
    cells[10 * BOARD_SIZE + 6] = .white;
    cells[10 * BOARD_SIZE + 7] = .white;
    cells[11 * BOARD_SIZE + 8] = .white;
    cells[12 * BOARD_SIZE + 8] = .white;
    bitboard.initFromCells(&cells);

    // 同一局面の VCF 単体の消費ノード
    const vcf_only = vcf_mod.findVCFSequence(&cells, .white, vcf_mod.VCF_MAX_DEPTH, 0, 0);
    try testing.expect(vcf_only.nodes > 0);

    const vct = findVCTSequence(&cells, .white, 6, 0, 0, false, .lenient);
    try testing.expect(vct.found);
    // VCT は入口で同じ VCF を回すので、少なくともその消費ぶんは計上されていなければ
    // ならない（この局面は入口の VCF で解決するので両者は一致する。委譲先の消費を
    // 加算していなかった #119 以前はここが 0 になる）。
    try testing.expect(vct.nodes >= vcf_only.nodes);

    // 三の追いが要る局面（入口の活三ガードで VCF-only に落ちる）でも、
    // 委譲先の VCF ぶんが計上されていること
    var cells2 = [_]Cell{.empty} ** CELL_COUNT;
    cells2[7 * BOARD_SIZE + 4] = .white;
    cells2[7 * BOARD_SIZE + 5] = .white;
    cells2[7 * BOARD_SIZE + 6] = .white;
    cells2[7 * BOARD_SIZE + 3] = .black;
    cells2[4 * BOARD_SIZE + 4] = .black;
    cells2[5 * BOARD_SIZE + 5] = .black;
    cells2[6 * BOARD_SIZE + 6] = .black;
    const vcf_only2 = vcf_mod.findVCFSequence(&cells2, .white, vcf_mod.VCF_MAX_DEPTH, 0, 0);
    try testing.expect(vcf_only2.nodes > 0);
    const vct2 = findVCTSequence(&cells2, .white, 6, 0, 0, false, .lenient);
    try testing.expect(vct2.nodes >= vcf_only2.nodes);
}

// === issue #130: getThreatDefensePositions の 3 値化 ===

test "issue #130: 脅威でない手は no_threat（活四の防御不可と区別する）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 孤立した黒石: 四でも三でもない
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.initFromCells(&cells);

    try testing.expectEqual(ThreatDefense.no_threat, getThreatDefensePositions(&cells, 7, 7, .black));
    // 分類側とも一致（脅威ゼロ）
    const c = classifyThreat(&cells, 7, 7, .black);
    try testing.expect(!c.creates_four and !c.creates_open_three);
}

test "issue #130: 偽跳び四の裏のウソ三も no_threat（issue #121 の形）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    // 8 行目に黒 C8 D8 _ F8 G8 H8。E8 を埋めると 6 連＝長連なので四ではなく、
    // F8 G8 H8 も達四にできないウソ三。つまり脅威が成立していない。
    for ([_]u8{ 2, 3, 5, 6, 7 }) |c| {
        cells[7 * BOARD_SIZE + c] = .black;
    }
    bitboard.initFromCells(&cells);

    // 旧実装ではこの手の受け点は「G8 の連続三の受け」が出るので positions になるが、
    // 四としては成立していない（受けが広い＝防御側有利の健全側）。
    // 少なくとも「受け 0 点 ＝ 防御不可（＝攻撃側の勝ち）」にはならないことを固定する。
    switch (getThreatDefensePositions(&cells, 7, 6, .black)) {
        .unstoppable => return error.FalseUnstoppable,
        .no_threat, .positions => {},
    }
}

test "issue #130: 活四は unstoppable・止め四は positions（#129 レビューの再現形）" {
    // 8 行目（row=7）: C8白 D8黒 E8黒 F8黒 G8空 H8黒 I8空 J8黒 K8黒 L8黒 M8黒 N8白
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 2] = .white; // C8
    cells[7 * BOARD_SIZE + 3] = .black; // D8
    cells[7 * BOARD_SIZE + 4] = .black; // E8
    cells[7 * BOARD_SIZE + 5] = .black; // F8
    cells[7 * BOARD_SIZE + 7] = .black; // H8
    cells[7 * BOARD_SIZE + 9] = .black; // J8
    cells[7 * BOARD_SIZE + 10] = .black; // K8
    cells[7 * BOARD_SIZE + 11] = .black; // L8
    cells[7 * BOARD_SIZE + 12] = .black; // M8
    cells[7 * BOARD_SIZE + 13] = .white; // N8
    bitboard.initFromCells(&cells);

    // H8 は止め四（受けは G8。I8 は埋めると長連なので五点ではない）
    const h8 = try expectPositions(getThreatDefensePositions(&cells, 7, 7, .black));
    try testing.expect(h8.contains(7, 6));

    // N8 の白石は孤立（黒に挟まれているだけ）＝脅威なし
    try testing.expectEqual(ThreatDefense.no_threat, getThreatDefensePositions(&cells, 7, 13, .white));

    // 白の活四は unstoppable
    var open4 = [_]Cell{.empty} ** CELL_COUNT;
    for ([_]u8{ 5, 6, 7, 8 }) |c| {
        open4[7 * BOARD_SIZE + c] = .white;
    }
    bitboard.initFromCells(&open4);
    try testing.expectEqual(ThreatDefense.unstoppable, getThreatDefensePositions(&open4, 7, 8, .white));
}

test "issue #130: 脅威でない初手から VCT は成立しない（isVCTFirstMove / findVCTSequenceFromFirstMove）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[9 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&cells);

    // (0,0) は孤立点＝四でも活三でもないので VCT の初手になり得ない
    // （3 値化前は `getThreatDefensePositions` の空リストを「防御不可」と読み違えると
    //   ここが true になった。ガードではなく型で防いでいることの固定）
    try testing.expect(!isVCTFirstMove(&cells, .{ .row = 0, .col = 0 }, .black, 4, 0, 0));

    const seq = findVCTSequenceFromFirstMove(&cells, .{ .row = 0, .col = 0 }, .black, 4, 0, 0, false);
    try testing.expect(!seq.found);
}

// =============================================================================
// issue #140 の回帰テスト
// =============================================================================

/// issue #140 の再現局面（黒番・攻めは黒）
///
/// 主筋: 黒 (7,7) は「列7の止め四（受けは (8,7) 一点）＋ 行7の活三（受けに (7,8) を含む）」。
/// - 白が (7,8) で活三を受けると、同時に斜め (4,11)(5,10)(6,9)(7,8) の**カウンター四**に
///   なる（黒 (3,12) が上端を止めているので五点は (8,7) 一点）。
/// - 黒はそのカウンター四を (8,7) でブロックする。この石は列7を (4,7)〜(8,7) の**五連**に
///   する＝その場で黒の勝ち（`block_ct == .win`）。
/// - ところが (8,7) は斜め (7,6)(8,7)(9,8) の活三も同時に作るので
///   `getThreatDefensePositions` は `.positions` を返す。`.win` を早期 return しないと
///   受けの列挙に入り、そこで白 (10,9)（列9の四）に切り返されて「不成立」と判定される
///   ＝すでに五連ができている勝ちを取りこぼす（偽陰性 = issue #140）。
///
/// 攻めを黒にしているのは、五連ができた後の盤面から**もう一度勝ち直せない**ようにするため
/// （白なら列7を伸ばして長連でも勝てるので、偽陰性が偶然埋め合わされてしまう）。
/// 白の (5,9)(6,8)(8,6)（跳び三・活四にはできない）は、黒が (8,7) から四で追い始めるのを
/// 止めるための細工: 黒 (8,7) の四に白が (7,7) で受けるとカウンター四になるので、
/// 黒に根の VCF は無く、勝ちはこの VCT 手順しかない。
fn setupIssue140Position(cells: []Cell) void {
    // 黒（攻め）: 列7の三（上端は白 (3,7) 止め）
    cells[4 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
    // 黒: 行7の二（(7,7) を打つと活三）
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    // 黒: 斜めの相方（ブロック点 (8,7) を打つと (7,6)(8,7)(9,8) の活三＝五連と同時にできる別方向の脅威）
    cells[9 * BOARD_SIZE + 8] = .black;
    // 黒: 白の斜め四の上端止め（白のカウンター四の五点を (8,7) 一点にする）
    cells[3 * BOARD_SIZE + 12] = .black;
    // 黒: 白の跳び三の上端止め（白のカウンター四の五点を (9,5) 一点にする）
    cells[4 * BOARD_SIZE + 10] = .black;
    // 白（受け）
    cells[3 * BOARD_SIZE + 7] = .white;
    // 白: (7,8) でカウンター四になる斜め
    cells[4 * BOARD_SIZE + 11] = .white;
    cells[5 * BOARD_SIZE + 10] = .white;
    cells[6 * BOARD_SIZE + 9] = .white;
    // 白: (7,7) でカウンター四になる跳び三（黒の根 VCF 封じ。五点は (9,5)）
    cells[5 * BOARD_SIZE + 9] = .white;
    cells[6 * BOARD_SIZE + 8] = .white;
    cells[8 * BOARD_SIZE + 6] = .white;
}

test "issue #140 前提: ブロック石が五連＋別方向の活三を同時に作る" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue140Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 受け手（白）はエントリのガードに掛からない（活三・ミセ手・VCF なし）
    try testing.expect(!opponentBlocksThreePursuitAtRoot(&cells, .white, &limiter));
    // 攻め手（黒）に根の VCF はない＝この局面の勝ちは VCT 経路でしか出ない
    try testing.expect(!vcf_mod.hasVCF(&cells, .black, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));

    // 黒 (7,7): 列7の止め四 ＋ 行7の活三 → 受けに (8,7) と (7,8) を含む
    cells[7 * BOARD_SIZE + 7] = .black;
    bitboard.placeStone(7, 7, .black);
    const def = try expectPositions(getThreatDefensePositions(&cells, 7, 7, .black));
    try testing.expect(def.contains(8, 7));
    try testing.expect(def.contains(7, 8));

    // 白 (7,8) はカウンター四、受けは (8,7) 一点
    cells[7 * BOARD_SIZE + 8] = .white;
    bitboard.placeStone(7, 8, .white);
    try testing.expectEqual(CounterThreat.four, checkDefenseCounterThreat(&cells, 7, 8, .white));
    const bp = quiescence.getFourDefensePosition(&cells, 7, 8, .white).blockPos();
    try testing.expect(bp != null);
    try testing.expectEqual(@as(u8, 8), bp.?.row);
    try testing.expectEqual(@as(u8, 7), bp.?.col);

    // ブロック石 (8,7) は列7の五連＝ .win。かつ斜めの活三も作るので受け点が返る
    // （＝ `.win` を早期 return しないと受けの列挙に入ってしまう形）
    cells[8 * BOARD_SIZE + 7] = .black;
    bitboard.placeStone(8, 7, .black);
    try testing.expectEqual(CounterThreat.win, checkDefenseCounterThreat(&cells, 8, 7, .black));
    const block_def = try expectPositions(getThreatDefensePositions(&cells, 8, 7, .black));
    try testing.expect(block_def.contains(10, 9));
}

test "evaluateCounterThreat: ブロック石が五連なら受けを列挙せず勝ち（issue #140）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue140Position(&cells);
    // 黒 (7,7) の四三 → 白 (7,8) のカウンター四まで進めた局面
    cells[7 * BOARD_SIZE + 7] = .black;
    cells[7 * BOARD_SIZE + 8] = .white;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 五連なのだから探索深度に依らず勝ち。修正前はブロック石 (8,7) の斜め活三の受けを
    // 列挙して再帰していたため、深度 1（＝これ以上潜れない）では false を返していた。
    try testing.expect(evaluateCounterThreat(
        .four,
        &cells,
        .black,
        .{ .row = 7, .col = 8 },
        0,
        &limiter,
        1,
    ));
    try testing.expect(evaluateCounterThreat(
        .four,
        &cells,
        .black,
        .{ .row = 7, .col = 8 },
        0,
        &limiter,
        VCT_MAX_DEPTH,
    ));
}

test "hasVCT: ブロック石が五連になる VCT を取りこぼさない（issue #140）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue140Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 手順は「(7,7) → 受け → 継続」の 2 手 + 受けなので浅い深度で足りる。
    // 修正前は (7,8) の受けに対して五連の勝ちを取りこぼし、その埋め合わせに
    // 深い探索が必要だった。
    try testing.expect(hasVCT(&cells, .black, 0, &limiter, 2));
    try testing.expect(hasVCT(&cells, .black, 0, &limiter, VCT_MAX_DEPTH));
}

test "findVCTSequence: ブロック石が五連になる VCT を取りこぼさない（issue #140）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue140Position(&cells);

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].row);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].col);
}

test "findVCTSequenceFromFirstMove: ブロック石が五連になる VCT を取りこぼさない（issue #140）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue140Position(&cells);

    const shallow = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 7 }, .black, 2, 0, 0, false);
    try testing.expect(shallow.found);

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 7 }, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(result.found);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].row);
    try testing.expectEqual(@as(u8, 7), result.sequence[0].col);
}

// =============================================================================
// issue #146 の回帰テスト
// =============================================================================

/// issue #146 の再現局面（黒番・攻めは黒）
///
/// 主筋: 黒 (7,8) は行7の止め四（受けは (7,9) 一点）。
/// - 白 (7,9) はその受けであると同時に、列9 (7,9)(8,9)(9,9)(10,9) の**カウンター四**に
///   なる（黒 (11,9) が下端を止めているので五点は (6,9) 一点）。
/// - 黒はこのカウンター四を (6,9) でブロックしたい。この石は行6 (6,9)〜(6,12) の四と
///   斜め (8,7)(7,8)(6,9)(5,10) の四を同時に作る＝**四四の禁手**なので、実戦では黒は
///   そこに打てない。つまり黒は白の四を止められず、この筋の VCT は不成立。
/// - ところが修正前は `getFourDefensePosition` の結果をそのまま置石しており、
///   ブロック点の禁手を確認していなかった。ブロック石は `.four` と分類され、
///   四四（受け点 2 個を両方は塞げない）で「勝ち」と判定される＝**偽 VCT**。
///
/// 斜めの四は黒の攻め手 (7,8) が完成させるので、**根の時点では (6,9) は四三で合法**。
/// これにより「白 (7,9) の四を黒が止められない＝白の根 VCF」にならず、
/// `findVCTSequence` のエントリガード（相手 VCF）が先に発火しない
/// （＝ `hasVCT` だけでなく `findVCTSequence` でも判別力がある）。
///
/// 白 (9,6) は斜めの上端止め（黒の四を活四にしないため）、
/// 白 (7,4) / (6,13) は黒の三の端止め（黒の四点を (7,8) と (6,9) の 2 つに限定するため）。
fn setupIssue146Position(cells: []Cell) void {
    // 黒: 行7の三（左端は白 (7,4) 止め → 四点は (7,8) 一点）
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[7 * BOARD_SIZE + 7] = .black;
    // 黒: 行6の三（右端は白 (6,13) 止め → 四点は (6,9) 一点）
    cells[6 * BOARD_SIZE + 10] = .black;
    cells[6 * BOARD_SIZE + 11] = .black;
    cells[6 * BOARD_SIZE + 12] = .black;
    // 黒: 斜めの相方（(7,8) と (6,9) が揃うと四）
    cells[8 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 10] = .black;
    // 黒: 白の列9の四の下端止め（五点を (6,9) 一点にする）
    cells[11 * BOARD_SIZE + 9] = .black;
    // 白: 黒の行7の三の左端止め
    cells[7 * BOARD_SIZE + 4] = .white;
    // 白: 黒の行6の三の右端止め
    cells[6 * BOARD_SIZE + 13] = .white;
    // 白: 黒の斜めの端止め（(6,9) の斜め四を活四にしない）
    cells[9 * BOARD_SIZE + 6] = .white;
    // 白: (7,9) でカウンター四になる列9の三
    cells[8 * BOARD_SIZE + 9] = .white;
    cells[9 * BOARD_SIZE + 9] = .white;
    cells[10 * BOARD_SIZE + 9] = .white;
}

test "issue #146 前提: ブロック点は根では合法・攻め手の後に四四の禁手になる" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&cells);
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 受け手（白）はエントリのガードに掛からない（活三・ミセ手・VCF なし）。
    // ＝根では黒がブロック点 (6,9) に打てるので白の四は止まる。
    try testing.expect(!opponentBlocksThreePursuitAtRoot(&cells, .white, &limiter));
    // 攻め手（黒）に根の VCF はない＝この局面の「勝ち」は VCT 経路でしか出ない
    try testing.expect(!vcf_mod.hasVCF(&cells, .black, 0, &limiter, vcf_mod.VCF_MAX_DEPTH));
    // 根では (6,9) は四三＝合法
    try testing.expectEqual(forbidden.ForbiddenType.none, forbidden.checkForbiddenMove(&cells, 6, 9));

    // 黒 (7,8): 行7の止め四 → 受けは (7,9) を含む
    cells[7 * BOARD_SIZE + 8] = .black;
    bitboard.placeStone(7, 8, .black);
    const def = try expectPositions(getThreatDefensePositions(&cells, 7, 8, .black));
    try testing.expect(def.contains(7, 9));

    // 白 (7,9) はカウンター四、ブロック点は (6,9) 一点
    cells[7 * BOARD_SIZE + 9] = .white;
    bitboard.placeStone(7, 9, .white);
    try testing.expectEqual(CounterThreat.four, checkDefenseCounterThreat(&cells, 7, 9, .white));
    const bp = quiescence.getFourDefensePosition(&cells, 7, 9, .white).blockPos();
    try testing.expect(bp != null);
    try testing.expectEqual(@as(u8, 6), bp.?.row);
    try testing.expectEqual(@as(u8, 9), bp.?.col);

    // そのブロック点は黒の四四＝禁手（五連は作らないので禁手が優先する）
    try testing.expect(!forbidden.checkFive(&cells, 6, 9, .black));
    try testing.expectEqual(forbidden.ForbiddenType.double_four, forbidden.checkForbiddenMove(&cells, 6, 9));

    // それでもブロック石自体は `.four` と分類され、受け点 2 個の四四になる
    // （＝禁手を見ないと「両方は塞げない＝勝ち」と読んでしまう形そのもの）
    cells[6 * BOARD_SIZE + 9] = .black;
    bitboard.placeStone(6, 9, .black);
    try testing.expectEqual(CounterThreat.four, checkDefenseCounterThreat(&cells, 6, 9, .black));
    const block_def = try expectPositions(getThreatDefensePositions(&cells, 6, 9, .black));
    try testing.expect(block_def.contains(6, 8));
    try testing.expect(block_def.contains(4, 11));
}

test "evaluateCounterThreat: ブロック点が黒の禁手なら VCT 不成立（issue #146）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&cells);
    // 黒 (7,8) の四 → 白 (7,9) のカウンター四まで進めた局面
    cells[7 * BOARD_SIZE + 8] = .black;
    cells[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&cells);

    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    try testing.expect(!evaluateCounterThreat(
        .four,
        &cells,
        .black,
        .{ .row = 7, .col = 9 },
        0,
        &limiter,
        VCT_MAX_DEPTH,
    ));
}

test "classifyBlock: 禁手は stop・五連は win_now・それ以外は continue_search（issue #145）" {
    ll.init();
    var limiter = TimeLimiter{
        .start_time = 0,
        .time_limit = 0,
        .nodes = 0,
        .max_nodes = 0,
    };

    // 攻め手 (7,8) がまだ無い局面: ブロック点 (6,9) は行6の四だけ＝四三で合法 → 受けの列挙へ
    var without_attack = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&without_attack);
    without_attack[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&without_attack);
    try testing.expectEqual(
        BlockOutcome.continue_search,
        classifyBlock(&without_attack, .{ .row = 6, .col = 9 }, .black, 0, &limiter),
    );
    // 判定のあいだだけ置いて外すので盤面は不変
    try testing.expectEqual(Cell.empty, without_attack[6 * BOARD_SIZE + 9]);

    // 攻め手 (7,8) を打つと (6,9) は四四の禁手になる → ブロックできない（issue #146）
    var forbidden_block = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&forbidden_block);
    forbidden_block[7 * BOARD_SIZE + 8] = .black;
    forbidden_block[7 * BOARD_SIZE + 9] = .white;
    bitboard.initFromCells(&forbidden_block);
    try testing.expectEqual(
        BlockOutcome.stop,
        classifyBlock(&forbidden_block, .{ .row = 6, .col = 9 }, .black, 0, &limiter),
    );

    // ブロック石が五連になる局面（issue #140）は win_now
    var win_block = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue140Position(&win_block);
    win_block[7 * BOARD_SIZE + 7] = .black;
    win_block[7 * BOARD_SIZE + 8] = .white;
    bitboard.initFromCells(&win_block);
    try testing.expectEqual(
        BlockOutcome.win_now,
        classifyBlock(&win_block, .{ .row = 8, .col = 7 }, .black, 0, &limiter),
    );
}

test "findVCTMove / isVCTFirstMove: ブロック点が黒の禁手なら偽 VCT を主張しない（issue #146）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&cells);
    bitboard.initFromCells(&cells);

    // 対局 CPU 経路。修正前はこの偽 VCT の初手 (7,8) をそのまま着手として返していた。
    try testing.expect(findVCTMove(&cells, .black, VCT_MAX_DEPTH, 0) == null);
    // 筋を固定した VCT 初手判定（修正前は true）
    try testing.expect(!isVCTFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCT_MAX_DEPTH, 0, 0));

    // 注: 局面全体の `hasVCT`（エントリガード・カウンターフォー耐性検証を通さない
    // 再帰本体の公開 API）は (7,8) 以外の初手でも true を返すため、この局面では
    // 判別材料にならない。判別は上の 2 本と `evaluateCounterThreat`（筋を固定した
    // 単体テスト）で行う。
}

test "findVCTSequence: ブロック点が黒の禁手なら偽 VCT を主張しない（issue #146）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&cells);

    const result = findVCTSequence(&cells, .black, VCT_MAX_DEPTH, 0, 0, false, .lenient);
    try testing.expect(!result.found);
}

test "findVCTSequenceFromFirstMove: ブロック点が黒の禁手なら偽 VCT を主張しない（issue #146）" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    setupIssue146Position(&cells);

    const result = findVCTSequenceFromFirstMove(&cells, .{ .row = 7, .col = 8 }, .black, VCT_MAX_DEPTH, 0, 0, false);
    try testing.expect(!result.found);
}
