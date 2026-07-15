// 空点プロスペクト基底（P0: テーブルと分類器のみ、配線なし）
//
// docs/plans/eval-basis-prospect-2026-07-13.md §2, §3.1-3.2 参照。
//
// SSoT: パターン知識の一次ソースは line_lookup.computePattern に保つ。
// 本モジュールはその出力（count/end/jump フラグ）＋必要最小限の生ビット参照
// （オーバーライン確認・窓の生存判定・単石方向の余裕判定）から
// 「その色の石をそこに置いたら方向ごとに何ができるか」を分類する。
//
// 近似（3点、§2.1）:
//   1. 黒の長連補正は「窓内（中心から4マス以内）で見える範囲のみ」適用する。
//      中心から5マス以上先の黒石は観測できず、F4/B4 に誤分類される
//      （下記 test "近似固定: 窓端の長連は観測できない" で挙動を固定）。
//   2. F3（活三）のうち「黒禁手による偽三」のみが近似: 発展先の活四点が
//      黒禁手でないかという大域判定（patterns.isValidConsecutiveThree 相当）は
//      9マス窓には載らないため、常に有効とみなす
//      （下記 test "近似固定: 黒三三禁の可能性があってもF3+F3(risk)に分類される" で固定）。
//      なお活三の「達四空間」条件（外外セルの少なくとも一方が空き）は
//      count==3 のとき外外ビットが必ず窓内にあるため**窓内で正確に判定する**
//      （近似ではない。classifyDirection の count==3 分岐参照）。
//   3. 単線双四（同一ラインに複数の四完成点がある跳びパターン等）は、
//      DirCode が方向ごとに1つしか持てないため B4 1個に潰れる。第2段の
//      カテゴリ畳み込みは「異なる2方向の四四」しか検出できず、単線双四は
//      見落とす（下記 test "近似固定: 単線双四はB4 1個に潰れ四四禁にならない" で固定）。
//
// これらはいずれも eval 近似として許容する前提で、Gate 1（docs/plans/...）で
// 偽陽性率を計測する。P0 では「挙動が意図通りに固定されていること」のみを保証する。
//
// 検証の逸脱記録: 反対称性 eval(persp)==−eval(opp) の検証（プラン §3.2）は
// スコアテーブル（PROSPECT_SCORE）が P2 で導入されるため、P2（eval 実装時）に送る。
// P0 の代替プロパティとして「黒コードは白コード以下（黒は禁手補正で降格されるのみで
// 昇格しない）」を全 512×512 窓で固定する（下記プロパティテスト参照）。

const std = @import("std");
const board_mod = @import("board.zig");
const bitboard = @import("bitboard.zig");
const ll = @import("line_lookup.zig");
const scores = @import("scores.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;

// ============================================================================
// 第1段: 方向プロスペクトコード
// ============================================================================

/// 方向プロスペクトコード。数値は「五完成までに必要な最小手数」の降順
/// （小さいほど弱い）で単調増加するよう割り当てている:
///   dead(到達不能) < b1 < f1 < b2 < f2 < b3 < f3 < b4 < f4 < f5(到達済み)
/// 同じ「必要手数」帯では open(f) が blocked(b) より常に強い。
///
/// 各コードの述語（own: 中心を除く9bit窓の自石ビット, block: 相手石/盤外ビット,
/// 中心に color の石を置いたと仮定して判定する）:
///
///   dead: 中心を含む5連続マス窓（offset -4..0 〜 0..+4 の5通り）のうち、
///         block ビットを一切含まないものが1つも存在しない（構造的に五が
///         作れない）。または黒で count>=6（長連、窓内で観測できる場合のみ）。
///   f5:   五が完成する。白は count>=5、黒は count==5 ちょうど
///         （黒 count>=6 は長連＝dead）。
///         注: 窓外の隣接自石により実際は長連（黒）となる偽 f5 は理論上
///         存在するが、その場合「窓外石＋窓内 run」で盤上に既に五連が完成
///         している（＝対局が終了している）ため実戦では到達不能。
///   f4:   count==4 かつ両端が開いている（黒は窓内オーバーライン補正を適用
///         した上で判定。補正後に両端とも塞がるなら dead）。
///   b4:   count==4 かつ片端のみ開いている（黒オーバーライン補正込み）。
///         または has_jump_four（跳び四。五点が1つなので b4 クラス）。
///   f3:   活三＝一手で達四（活四）にできる三。count==3 かつ両隣接端が空き、
///         かつ外外セル（run の2つ先）の少なくとも一方が空き（達四空間。
///         count==3 のとき外外ビットは必ず窓内にあり正確に判定できる）。
///         または has_jump_three（跳び三、count!=3 の場合のみ。跳び三は
///         パターン定義上両袖空きを要求し、達四点＝gap 自体が常に空きの
///         ため達四空間チェックは不要）。
///         黒禁手による偽三（発展先活四点が禁手）のみ判定しない近似。
///   b3:   count==3 かつ片端のみ開いている（止め三）。または両隣接端は
///         空きだが両外外が塞がりで達四不能な三（止め四→五は可能なので
///         dead ではなく b3）。
///   f2:   count==2 かつ両端が開いている（活二）。
///   b2:   count==2 かつ片端のみ開いている（止め二）。
///   f1:   count==1（中心のみ）かつ正負両方向に「五を作る余地」がある
///         （窓内の4bit側で block が全埋めでない側が両方）。
///   b1:   count==1 かつ片方向のみ余地がある。
pub const DirCode = enum(u4) {
    dead = 0,
    b1 = 1,
    f1 = 2,
    b2 = 3,
    f2 = 4,
    b3 = 5,
    f3 = 6,
    b4 = 7,
    f4 = 8,
    f5 = 9,
};

// DirCode の数値順＝強さ順（sortDescending4 / cellCategory の top-2 ディスパッチが依存）。
comptime {
    const strength_order = [_]DirCode{ .dead, .b1, .f1, .b2, .f2, .b3, .f3, .b4, .f4, .f5 };
    for (strength_order, 0..) |code, i| {
        std.debug.assert(@intFromEnum(code) == i);
    }
}

/// 中心(bit4)を含む5連続マス窓が block を含まないものが存在するか
/// （own には依存しない：block=0 のマスなら自石でも空でも五の一部になれる）。
fn hasAliveWindow(block: u9) bool {
    var s: u4 = 0;
    while (s <= 4) : (s += 1) {
        var mask: u9 = 0;
        var i: u4 = 0;
        while (i < 5) : (i += 1) {
            mask |= @as(u9, 1) << @intCast(s + i);
        }
        if (block & mask == 0) return true;
    }
    return false;
}

/// 黒の窓内オーバーライン判定: is_positive 方向の run の「2マス先」
/// （evaluate.zig の blackOverlineEnd と同じ steps=run+2）が窓内(0..8)に
/// あり、かつ自石（黒）なら overline とみなし、その端を塞がり扱いにする。
/// 窓外（中心から5マス以上先）は観測できないため false を返す（近似・§2.1-1）。
fn windowOverlineBlocked(own: u9, block: u9, is_positive: bool) bool {
    const run: u4 = if (is_positive) ll.countRun(own, block, true) else ll.countRun(own, block, false);
    const offset: i16 = @as(i16, run) + 2;
    const bit: i16 = if (is_positive) 4 + offset else 4 - offset;
    if (bit < 0 or bit > 8) return false; // 窓外＝観測不能（近似）
    const mask: u9 = @as(u9, 1) << @intCast(bit);
    return own & mask != 0;
}

/// 中心を除く9bit窓（own: 自石, block: 相手石/盤外）から、中心に color を
/// 置いたと仮定した場合のこの方向のプロスペクトコードを求める。
///
/// SSoT: パターン分類（count/end/jump フラグ）は line_lookup.computePattern に
/// 一元化されている。ここではその出力＋オーバーライン補正・生存判定・単石方向
/// 判定のみを生ビットで補う（§2.1 のコメント参照）。
pub fn classifyDirection(own_no_center: u9, block: u9, color: Cell) DirCode {
    if (!hasAliveWindow(block)) return .dead;

    const center_bit: u9 = 1 << 4;
    const own = own_no_center | center_bit;
    const pt = ll.computePattern(own, block);

    // 黒の長連（窓内で観測できる範囲のみ。窓外は近似で見逃す＝§2.1-1）。
    if (color == .black and pt.count >= 6) return .dead;

    if (color == .black) {
        if (pt.count == 5) return .f5;
    } else {
        if (pt.count >= 5) return .f5;
    }

    if (pt.count == 4) {
        var end1_open = pt.end1 == 0;
        var end2_open = pt.end2 == 0;
        if (color == .black) {
            if (end1_open and windowOverlineBlocked(own, block, true)) end1_open = false;
            if (end2_open and windowOverlineBlocked(own, block, false)) end2_open = false;
        }
        if (end1_open and end2_open) return .f4;
        if (end1_open or end2_open) return .b4;
        // 黒: オーバーライン補正で両端とも塞がった＝この方向は実質五を作れない。
        // 注: 意図的に has_jump_four の確認より先に return する（順序依存）。
        // 補正で両端塞がりの run と同居する跳び四は、完成させると必ず長連に
        // なる偽四のため、dead が正しい。
        return .dead;
    }

    if (pt.has_jump_four) return .b4;

    if (pt.count == 3) {
        if (pt.end1 == 0 and pt.end2 == 0) {
            // 達四空間チェック（fix1・窓内で正確）: 三 [a..a+2] が活三 ⇔
            // 外外セル a−2 / a+4 の少なくとも一方が空き。count==3 のとき
            // pos_run+neg_run==2 なので外外ビット 4+pos_run+2（<=8）と
            // 4−neg_run−2（>=0）は必ず窓内にある。
            // 外外ビットが own のケース（跳び四化）は has_jump_four として
            // 上で b4 に分類済みなので、ここでは block のみ確認すればよい。
            const pos_run = ll.countRun(own, block, true);
            const neg_run = ll.countRun(own, block, false);
            const outer1_bit: u4 = 4 + pos_run + 2;
            const outer2_bit: u4 = 4 - neg_run - 2;
            const outer1_open = block & (@as(u9, 1) << outer1_bit) == 0;
            const outer2_open = block & (@as(u9, 1) << outer2_bit) == 0;
            if (outer1_open or outer2_open) return .f3; // 活三（黒禁手の偽三のみ近似・§2.1-2）
            return .b3; // 両外外塞がり＝達四不能（止め四→五は可能なので b3）
        }
        if (pt.end1 == 0 or pt.end2 == 0) return .b3;
        return .dead; // 理論上到達不能（両端block済みならhasAliveWindowが既にdeadを返す）
    }

    // 跳び三はパターン定義（両袖空き）上、達四点＝gap が常に空きのため
    // 達四空間チェック不要。黒禁手の偽三のみ近似（§2.1-2）。
    if (pt.has_jump_three) return .f3;

    if (pt.count == 2) {
        if (pt.end1 == 0 and pt.end2 == 0) return .f2;
        if (pt.end1 == 0 or pt.end2 == 0) return .b2;
        return .dead; // 理論上到達不能
    }

    // count==1（中心のみ）: 正負それぞれの4bit側が block で全埋めでなければ余地あり。
    const pos_mask: u9 = 0b1_1110_0000; // bits 5..8
    const neg_mask: u9 = 0b0_0000_1111; // bits 0..3
    const pos_room = block & pos_mask != pos_mask;
    const neg_room = block & neg_mask != neg_mask;
    if (pos_room and neg_room) return .f1;
    if (pos_room or neg_room) return .b1;
    return .dead; // 理論上到達不能（両側全埋めならhasAliveWindowが既にdeadを返す）
}

// ============================================================================
// 方向プロスペクトテーブル（own(9bit, 中心bit4は常に0扱い) x block(9bit)）
// ============================================================================

pub var DIR_PROSPECT_BLACK: [512][512]u4 = undefined;
pub var DIR_PROSPECT_WHITE: [512][512]u4 = undefined;

// ============================================================================
// 第2段: セルカテゴリ（4方向コードの組み合わせ）
// ============================================================================

/// 空点1点のセルカテゴリ。
///
/// 畳み込みは「4方向コードを降順ソートし、上位2つの組み合わせで決定する」
/// （cellCategory 参照）。DirCode の数値順が強さ順と一致するため、
/// ソート後の sorted[0]/sorted[1] が常に最強・次強の2方向になる。
///
/// 黒の四四（B4+B4 等）は禁手（四四禁）なので dead 級として none に畳み込む
/// （専用タグを持たず、無プロスペクトの none と同じスコア帯として扱う設計判断。
/// §2.2「黒は四四禁＝DEAD」に対応）。
/// 黒の三三（F3+F3）は「禁手の可能性」があるため none には畳み込まず、
/// 黒専用の減点カテゴリ double_three_black_risk として区別する
/// （実際に禁手かどうかは大域判定が必要で本モジュールの守備範囲外＝近似）。
pub const CellCat = enum(u5) {
    none = 0,
    weak, // f1/b1 のみ
    solo_b2,
    solo_f2,
    double_f2, // f2 + f2
    solo_b3,
    b4_f2, // b4 + f2
    solo_f3,
    f3_f2, // f3 + f2
    f3_b3, // f3 + b3
    solo_b4,
    double_three_black_risk, // f3 + f3（黒。三三禁の可能性で専用減点。四三三＝b4/f4+f3+f3 も禁手なのでここ）
    double_three_white, // f3 + f3（白。強打）
    four_three, // b4 + f3（四三点。f4+f3 は活四が支配的なので solo_f4）
    solo_f4,
    double_four_white, // 四四（白。勝ち級）
    win, // f5（黒白共通）
};

fn isFourTier(c: DirCode) bool {
    return c == .f4 or c == .b4;
}

fn isThreeTier(c: DirCode) bool {
    return c == .f3 or c == .b3;
}

/// 4方向コードを降順（強い順）にソートする（挿入ソート・4要素）。
fn sortDescending4(codes: [4]DirCode) [4]DirCode {
    var arr = codes;
    var i: usize = 1;
    while (i < 4) : (i += 1) {
        const key = arr[i];
        var j: usize = i;
        while (j > 0 and @intFromEnum(arr[j - 1]) < @intFromEnum(key)) : (j -= 1) {
            arr[j] = arr[j - 1];
        }
        arr[j] = key;
    }
    return arr;
}

/// 4方向コード（多重集合）とその色から、セルカテゴリを1つ決定する。
/// comptime 可能な純関数（init 時に 65536×2 のフラットテーブルへ展開する）。
pub fn cellCategory(codes: [4]DirCode, color: Cell) CellCat {
    const sorted = sortDescending4(codes);
    const top = sorted[0];
    const second = sorted[1];

    if (top == .f5) return .win;

    // 黒の三三禁チェック（fix2）: f3 が2方向以上あれば、四系コード（b4/f4）と
    // 同時でも三三禁（四三三も禁手）。五完成（f5）のみが優先される。
    // top-2 ディスパッチより先に判定しないと b4+f3+f3 → four_three /
    // f4+f3+f3 → solo_f4 と誤分類する。
    if (color == .black) {
        var f3_count: u8 = 0;
        for (codes) |c| {
            if (c == .f3) f3_count += 1;
        }
        if (f3_count >= 2) return .double_three_black_risk;
    }

    return switch (top) {
        .f5 => unreachable, // 上で処理済み
        .f4 => if (isFourTier(second))
            (if (color == .black) CellCat.none else CellCat.double_four_white)
        else
            .solo_f4,
        .b4 => blk: {
            if (isFourTier(second)) break :blk if (color == .black) CellCat.none else CellCat.double_four_white;
            if (second == .f3) break :blk .four_three;
            if (second == .f2) break :blk .b4_f2;
            break :blk .solo_b4;
        },
        .f3 => blk: {
            // 黒の f3×2 は上の三三禁チェックで処理済み（ここに来るのは白のみ）
            if (second == .f3) break :blk .double_three_white;
            if (second == .b3) break :blk .f3_b3;
            if (second == .f2) break :blk .f3_f2;
            break :blk .solo_f3;
        },
        .b3 => .solo_b3,
        .f2 => if (second == .f2) .double_f2 else .solo_f2,
        .b2 => .solo_b2,
        .f1, .b1 => .weak,
        .dead => .none,
    };
}

/// 4方向コードを u16 へパックする（各コード u4 を1ニブルに割り当て）。
/// CELL_CAT の索引と対応する（P2 の差分更新パスがカテゴリ参照に使う前提）。
pub fn packCodes(codes: [4]DirCode) u16 {
    return @as(u16, @intFromEnum(codes[0])) |
        (@as(u16, @intFromEnum(codes[1])) << 4) |
        (@as(u16, @intFromEnum(codes[2])) << 8) |
        (@as(u16, @intFromEnum(codes[3])) << 12);
}

/// u4 ニブルを DirCode に変換する。DirCode は 0..9 のみ有効（10..15 は未使用）。
/// CELL_CAT の索引空間は u16 全体（65536通り）だが、実際に classifyDirection が
/// 生成する値は常に 0..9 のため、未使用ニブル(10..15)が現れるのは init 時の
/// 網羅ループのみ（実クエリでは到達しない）。安全に .dead へフォールバックする。
fn nibbleToDirCode(nibble: u4) DirCode {
    return std.meta.intToEnum(DirCode, nibble) catch .dead;
}

fn unpackCodes(packed_val: u16) [4]DirCode {
    return .{
        nibbleToDirCode(@truncate(packed_val)),
        nibbleToDirCode(@truncate(packed_val >> 4)),
        nibbleToDirCode(@truncate(packed_val >> 8)),
        nibbleToDirCode(@truncate(packed_val >> 12)),
    };
}

/// [packed 4方向コード(u16)][色(0=黒,1=白)] -> CellCat
pub var CELL_CAT: [65536][2]u5 = undefined;

var prospect_initialized: bool = false;

/// DIR_PROSPECT_BLACK/WHITE と CELL_CAT を構築する。
pub fn initProspectTables() void {
    if (prospect_initialized) return;

    for (0..512) |own_i| {
        const own: u9 = @intCast(own_i);
        for (0..512) |block_i| {
            const block: u9 = @intCast(block_i);
            DIR_PROSPECT_BLACK[own_i][block_i] = @intFromEnum(classifyDirection(own, block, .black));
            DIR_PROSPECT_WHITE[own_i][block_i] = @intFromEnum(classifyDirection(own, block, .white));
        }
    }

    var packed_i: u32 = 0;
    while (packed_i < 65536) : (packed_i += 1) {
        const codes = unpackCodes(@intCast(packed_i));
        CELL_CAT[packed_i][0] = @intFromEnum(cellCategory(codes, .black));
        CELL_CAT[packed_i][1] = @intFromEnum(cellCategory(codes, .white));
    }

    prospect_initialized = true;
}

/// カテゴリの正準名（sentinel終端スライス）。SSoT: getProspectCategoryName と
/// getProspectParamName（setEvalParam の prospect id 空間用）の両方がここから名前を取る。
fn categoryNameSlice(cat: CellCat) [:0]const u8 {
    return switch (cat) {
        .none => "NONE",
        .weak => "WEAK",
        .solo_b2 => "SOLO_B2",
        .solo_f2 => "SOLO_F2",
        .double_f2 => "DOUBLE_F2",
        .solo_b3 => "SOLO_B3",
        .b4_f2 => "B4_F2",
        .solo_f3 => "SOLO_F3",
        .f3_f2 => "F3_F2",
        .f3_b3 => "F3_B3",
        .solo_b4 => "SOLO_B4",
        .double_three_black_risk => "DOUBLE_THREE_BLACK_RISK",
        .double_three_white => "DOUBLE_THREE_WHITE",
        .four_three => "FOUR_THREE",
        .solo_f4 => "SOLO_F4",
        .double_four_white => "DOUBLE_FOUR_WHITE",
        .win => "WIN",
    };
}

/// カテゴリの正準名（null終端）。P1 で wasm export される前提（回帰スクリプト照合用）。
pub fn getProspectCategoryName(cat: CellCat) [*:0]const u8 {
    return categoryNameSlice(cat).ptr;
}

// ============================================================================
// フル計算（検証・初期化用。ProspectState の差分更新は P2 で実装する）
// ============================================================================

/// 盤面から空点1点の4方向コードを直接計算する（テーブル参照との一致検証用）。
/// bitboard の同期は不要（cells 配列を直接窓走査する自己完結版）。
/// 窓抽出は line_lookup.extractWindowFromCells を共有（中心セルは空点前提の
/// ため own/block とも 0 になり、classifyDirection の own_no_center 契約を満たす）。
/// 呼び出し前提: cells[row,col] は空点であること（Debug ビルドで assert）。
pub fn computeCellCodes(cells: []const Cell, row: u8, col: u8, color: Cell) [4]DirCode {
    const idx = @as(usize, row) * BOARD_SIZE + col;
    std.debug.assert(cells[idx] == .empty);

    var codes: [4]DirCode = undefined;
    for (0..4) |dir_idx| {
        const w = ll.extractWindowFromCells(cells, row, col, dir_idx, color);
        codes[dir_idx] = classifyDirection(w.own, w.block, color);
    }
    return codes;
}

// ============================================================================
// 第3段: スコアテーブルと集計（P1: フル計算のみ。差分更新は P2）
// ============================================================================

/// CellCat の有効値数。PROSPECT_SCORE の第1次元・setEvalParam 拡張時の id 空間算出に使う。
pub const CAT_COUNT: usize = @typeInfo(CellCat).@"enum".fields.len;

// CellCat の宣言順（0..CAT_COUNT-1 と一致）を固定する。下記 PROSPECT_SCORE_DEFAULT は
// この順序に依存した配列リテラルなので、enum に手を加えたらここも見直すこと。
comptime {
    const order = [_]CellCat{
        .none,
        .weak,
        .solo_b2,
        .solo_f2,
        .double_f2,
        .solo_b3,
        .b4_f2,
        .solo_f3,
        .f3_f2,
        .f3_b3,
        .solo_b4,
        .double_three_black_risk,
        .double_three_white,
        .four_three,
        .solo_f4,
        .double_four_white,
        .win,
    };
    for (order, 0..) |cat, i| {
        std.debug.assert(@intFromEnum(cat) == i);
    }
}

/// [カテゴリ][手番か(0=非手番,1=手番)] -> スコア。
///
/// P3-d（2026-07-15）で **Rapfi 教師 Texel 回帰 + スケールアンカリング**により
/// 焼き込み済み（`bench-results/prospect-anchor-*.json`、
/// `scripts/prospect-anchor.ts`、`docs/plans/prospect-texel-p3-2026-07-15.md`）。
///
/// - 「texel-r1 回帰」: サポート（コーパスでの非ゼロ行数）≥100 の重み。
///   9,873 quiet 局面に対する rapfi eval への MSE 最小化解を、コーパスの
///   raw_fit 分布標準偏差が legacy 葉評価に一致する係数 s=3.600189 で
///   スケール正規化し四捨五入。
/// - 「アンカー維持（サポート<100）」: quiet フィルタで戦術局面が抜けるため
///   回帰値が信頼できないカテゴリ。P3-d 直前の暫定既定値をそのまま維持する。
///   勝ち級（WIN / DOUBLE_FOUR_WHITE / SOLO_F4 / FOUR_THREE の TURN 系）が
///   ここに落ちる（プラン §4 と P3-c の申し送りどおり）。
///
/// アンカー: four_three（TURN=アンカー維持 3000）と legacy の
/// LEAF_FOUR_THREE_THREAT(2000)+FOUR_THREE_BONUS(5000)=7000 の比は 0.43。
/// 分布一致（コーパス std: legacy 776.3 vs prospect final 807.2）が達成されている。
///
/// 序列の sanity（勝ち級 TURN 単調性）:
///   WIN(9000) > DOUBLE_FOUR_WHITE(4800) > SOLO_F4(4500) > FOUR_THREE(3000)
pub const PROSPECT_SCORE_DEFAULT: [CAT_COUNT][2]i32 = .{
    .{ -23, -59 }, // none (texel-r1 回帰)
    .{ -12, -9 }, // weak (texel-r1 回帰)
    .{ 22, 25 }, // solo_b2 (texel-r1 回帰)
    .{ 14, 19 }, // solo_f2 (texel-r1 回帰)
    .{ 55, 86 }, // double_f2 (texel-r1 回帰)
    .{ 64, 56 }, // solo_b3 (texel-r1 回帰)
    .{ 276, 380 }, // b4_f2 (texel-r1 回帰)
    .{ 94, 133 }, // solo_f3 (texel-r1 回帰)
    .{ 168, 230 }, // f3_f2 (texel-r1 回帰)
    .{ 149, 179 }, // f3_b3 (texel-r1 回帰)
    .{ 116, 144 }, // solo_b4 (texel-r1 回帰)
    .{ -16, -216 }, // double_three_black_risk (texel-r1 回帰)
    .{ 407, 493 }, // double_three_white (texel-r1 回帰)
    .{ 598, 3000 }, // four_three (WAIT=texel-r1 回帰 / TURN=アンカー維持: サポート<100)
    .{ 623, 4500 }, // solo_f4 (WAIT=texel-r1 回帰 / TURN=アンカー維持: サポート<100)
    .{ 2600, 4800 }, // double_four_white (アンカー維持: サポート<100)
    .{ 5000, 9000 }, // win (アンカー維持: サポート<100)
};

pub var PROSPECT_SCORE: [CAT_COUNT][2]i32 = PROSPECT_SCORE_DEFAULT;

/// PROSPECT_SCORE を既定値へ復元する（scores.resetEvalParams と対の運用を想定）。
pub fn resetProspectScores() void {
    PROSPECT_SCORE = PROSPECT_SCORE_DEFAULT;
}

/// 評価総和のクランプ上限。OPEN_FOUR(10000) 級とし、FIVE−5000=95000 の
/// 詰み判定帯（minimax.zig の threatProbe マーカー等）と構造的に干渉しないことを保証する。
pub const PROSPECT_EVAL_CLAMP: i32 = 10000;

var prospect_tables_ready = false;

/// DIR_PROSPECT_BLACK/WHITE・CELL_CAT の初期化を冪等に保証する。
/// initProspectTables 自身も冪等だが、prospect パスの入口（evaluate.zig /
/// incremental_eval.zig）から呼ぶ名前をここに揃える。
pub fn ensureTables() void {
    if (prospect_tables_ready) return;
    initProspectTables();
    prospect_tables_ready = true;
}

/// 評価時にどちらの手番列（PROSPECT_SCORE の第2次元）を使うか。
/// evaluate.EvalOptions.last_mover_is_perspective（3値）から変換する
/// （変換ロジックは evaluate.zig 側に集約し prospect.zig からは型のみ参照する）。
pub const StmMode = enum { perspective, opponent, average };

fn colorIndex(color: Cell) usize {
    return switch (color) {
        .black => 0,
        .white => 1,
        .empty => unreachable,
    };
}

/// 空点1点について persp 色・opp 色それぞれのセルカテゴリを求める。
/// evaluateFull と extractFeatures が共有する（二重実装防止）。
fn cellCategoryPair(
    cells: []const Cell,
    r: u8,
    c: u8,
    perspective: Cell,
    opponent: Cell,
    persp_idx: usize,
    opp_idx: usize,
) struct { cat_persp: usize, cat_opp: usize } {
    const codes_persp = computeCellCodes(cells, r, c, perspective);
    const codes_opp = computeCellCodes(cells, r, c, opponent);
    return .{
        .cat_persp = CELL_CAT[packCodes(codes_persp)][persp_idx],
        .cat_opp = CELL_CAT[packCodes(codes_opp)][opp_idx],
    };
}

/// sum[色(0=黒,1=白)][手番か] から perspective 視点の評価値を stm で合成し
/// クランプする（§2.3 の式）。evaluateFull（一時 sum）と getStateEval
/// （prospect_state.sum）の両方が共有する（P2 レビュー対応: 式7行の重複解消）。
fn combineFromSums(sum: [2][2]i32, perspective: Cell, stm: StmMode) i32 {
    const opponent = perspective.opposite();
    const persp_idx = colorIndex(perspective);
    const opp_idx = colorIndex(opponent);

    const raw_when_persp_to_move = sum[persp_idx][1] - sum[opp_idx][0];
    const raw_when_opp_to_move = sum[persp_idx][0] - sum[opp_idx][1];

    const raw: i32 = switch (stm) {
        .perspective => raw_when_persp_to_move,
        .opponent => raw_when_opp_to_move,
        .average => @divTrunc(raw_when_persp_to_move + raw_when_opp_to_move, 2),
    };

    return std.math.clamp(raw, -PROSPECT_EVAL_CLAMP, PROSPECT_EVAL_CLAMP);
}

/// 空点プロスペクト基底でのフル計算評価（perspective 視点）。
///
/// 全空点について computeCellCodes → CELL_CAT でカテゴリを求め、色ごとの
/// sum[色][手番か] を集計してから combineFromSums で §2.3 の式に当てる。
/// computeCellCodes は bitboard 同期を前提としない（cells 配列のみを読む）ため、
/// 本関数の呼び出しにも bitboard 同期は不要。
///
/// P1 はインクリメンタル化前の正しさ確認用実装であり、毎回全空点を
/// 走査する（早期skip等の最適化は P2）。
pub fn evaluateFull(cells: []const Cell, perspective: Cell, stm: StmMode) i32 {
    ensureTables();

    const opponent = perspective.opposite();
    const persp_idx = colorIndex(perspective);
    const opp_idx = colorIndex(opponent);

    var sum: [2][2]i32 = .{ .{ 0, 0 }, .{ 0, 0 } };

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            if (cells[@as(u16, r) * BOARD_SIZE + c] != .empty) continue;

            const pair = cellCategoryPair(cells, r, c, perspective, opponent, persp_idx, opp_idx);

            sum[persp_idx][0] += PROSPECT_SCORE[pair.cat_persp][0];
            sum[persp_idx][1] += PROSPECT_SCORE[pair.cat_persp][1];
            sum[opp_idx][0] += PROSPECT_SCORE[pair.cat_opp][0];
            sum[opp_idx][1] += PROSPECT_SCORE[pair.cat_opp][1];
        }
    }

    return combineFromSums(sum, perspective, stm);
}

// ============================================================================
// setEvalParam の prospect id 空間（id 100〜）と extractProspectFeatures 用
// ============================================================================

/// prospect パラメータの総数（CAT_COUNT × 2、[カテゴリ][手番か] のフラット総数）。
/// main.zig の setEvalParam/getEvalParam は id>=100 をここに `id-100` でルーティングする
/// （id 100〜100+PROSPECT_PARAM_COUNT-1）。
pub const PROSPECT_PARAM_COUNT: u32 = @intCast(CAT_COUNT * 2);

/// offset(0-based, = id-100) から [カテゴリ][手番か] のフラット名テーブル。
/// 書式: PROSPECT_<CAT名>_TURN（手番=1）/ PROSPECT_<CAT名>_WAIT（非手番=0）。
const PROSPECT_PARAM_NAMES: [CAT_COUNT][2][*:0]const u8 = blk: {
    var names: [CAT_COUNT][2][*:0]const u8 = undefined;
    for (@typeInfo(CellCat).@"enum".fields) |field| {
        const cat: CellCat = @enumFromInt(field.value);
        const cat_name = categoryNameSlice(cat);
        names[field.value][0] = std.fmt.comptimePrint("PROSPECT_{s}_WAIT", .{cat_name});
        names[field.value][1] = std.fmt.comptimePrint("PROSPECT_{s}_TURN", .{cat_name});
    }
    break :blk names;
};

/// offset(=id-100) の重みを設定する。範囲外は無視。
pub fn setProspectParam(offset: u32, value: i32) void {
    if (offset >= PROSPECT_PARAM_COUNT) return;
    PROSPECT_SCORE[offset / 2][offset % 2] = value;
}

/// offset(=id-100) の重みを取得する。範囲外は scores.EVAL_PARAM_UNKNOWN。
pub fn getProspectParam(offset: u32) i32 {
    if (offset >= PROSPECT_PARAM_COUNT) return scores.EVAL_PARAM_UNKNOWN;
    return PROSPECT_SCORE[offset / 2][offset % 2];
}

/// offset(=id-100) の正準名（null終端）。範囲外は空文字列。
pub fn getProspectParamName(offset: u32) [*:0]const u8 {
    if (offset >= PROSPECT_PARAM_COUNT) return "";
    return PROSPECT_PARAM_NAMES[offset / 2][offset % 2];
}

/// 空点プロスペクト特徴ベクトルを抽出する（P3 の Texel 回帰・extractProspectFeatures export 用）。
///
/// out[cat*2+turn] は「カテゴリ cat・手番 turn のセルが何個あるか」の符号付き計数。
/// persp 側の空点は該当カテゴリの turn=(stm_is_persp?1:0) を +1、opp 側の空点は
/// turn=(stm_is_persp?0:1) を -1 する。この定義により
/// `Σ out[i] * PROSPECT_SCORE_flat[i] == evaluateFull の対応する stm のクランプ前 raw`
/// が成立する（stm=perspective なら stm_is_persp=true、stm=opponent なら false。
/// average は本関数の対象外＝呼び出し側で2回呼んで平均する）。
pub fn extractFeatures(
    cells: []const Cell,
    perspective: Cell,
    stm_is_persp: bool,
    out: *[PROSPECT_PARAM_COUNT]i32,
) void {
    ensureTables();

    const opponent = perspective.opposite();
    const persp_idx = colorIndex(perspective);
    const opp_idx = colorIndex(opponent);
    const persp_turn: usize = if (stm_is_persp) 1 else 0;
    const opp_turn: usize = if (stm_is_persp) 0 else 1;

    @memset(out, 0);

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            if (cells[@as(u16, r) * BOARD_SIZE + c] != .empty) continue;

            const pair = cellCategoryPair(cells, r, c, perspective, opponent, persp_idx, opp_idx);

            out[pair.cat_persp * 2 + persp_turn] += 1;
            out[pair.cat_opp * 2 + opp_turn] -= 1;
        }
    }
}

// ============================================================================
// 第4段: インクリメンタル状態（P2、未配線）
// ============================================================================

/// 空点プロスペクト基底のインクリメンタル状態。
///
/// 不変条件: **占有セルの dir_code/contrib エントリは stale**（空点のときのみ有効）。
/// これは P0/P1 の DirCode 設計（占有セルは分類対象外）と一致する。呼び出し規約:
/// updateOnPlace/updateOnRemove は **cells（および bitboard）が既に更新済み**の
/// 状態で呼ぶこと（先に置石/除石し、その後に本関数を呼ぶ。legacy の
/// incremental_eval.placeStone/removeStone と同じ順序）。
pub const ProspectState = struct {
    /// [空点idx][色(0=黒,1=白)] -> packCodes(4方向コード)。
    dir_code: [board_mod.CELL_COUNT][2]u16 = undefined,
    /// [空点idx][色] -> PROSPECT_SCORE[cat][*]（[手番か] の2値をそのままコピー）。
    /// cat = CELL_CAT[dir_code[idx][色]][色] から都度導出するため cat 自体は保持しない
    /// （§ 実装判断: 下記コメント参照）。
    contrib: [board_mod.CELL_COUNT][2][2]i32 = undefined,
    /// [色][手番か] の総和（全空点）。差分更新時に両手番変種とも更新する。
    sum: [2][2]i32 = .{ .{ 0, 0 }, .{ 0, 0 } },
};

/// 実装判断（P2-a、報告済み）: cat を dir_code と別配列でキャッシュしない。
/// cat は常に「dir_code[idx][色] を CELL_CAT に1回引く」だけで求まり、その参照コストは
/// キャッシュ済み配列を読むコストと同等（どちらも1回のメモリロード）。別配列で持つと
/// dir_code と cat の同期ポイントが増えるだけでリターンがないため、素直に都度導出する。
pub var prospect_state: ProspectState = .{};

fn subtractContribAt(idx: u16) void {
    prospect_state.sum[0][0] -= prospect_state.contrib[idx][0][0];
    prospect_state.sum[0][1] -= prospect_state.contrib[idx][0][1];
    prospect_state.sum[1][0] -= prospect_state.contrib[idx][1][0];
    prospect_state.sum[1][1] -= prospect_state.contrib[idx][1][1];
}

fn addContribAt(idx: u16) void {
    prospect_state.sum[0][0] += prospect_state.contrib[idx][0][0];
    prospect_state.sum[0][1] += prospect_state.contrib[idx][0][1];
    prospect_state.sum[1][0] += prospect_state.contrib[idx][1][0];
    prospect_state.sum[1][1] += prospect_state.contrib[idx][1][1];
}

/// idx の dir_code から contrib（[色][手番か]）を再計算して書き込む（sum への加減算はしない）。
fn refreshContribAt(idx: u16) void {
    const cat_black: usize = CELL_CAT[prospect_state.dir_code[idx][0]][0];
    const cat_white: usize = CELL_CAT[prospect_state.dir_code[idx][1]][1];
    prospect_state.contrib[idx] = .{ PROSPECT_SCORE[cat_black], PROSPECT_SCORE[cat_white] };
}

/// idx（空点）の4方向コードを両色フルで再計算し dir_code/contrib に書き込む
/// （sum への加減算はしない。initFromBoard・updateOnRemove の自セルで使う）。
/// 窓抽出は `ll.extractWindowFromCellsDual`（SSoT）で1方向1回に抑える
/// （computeCellCodes を黒白2回呼ぶ版よりセル読み半減。P2 レビュー対応）。
fn refreshFullAt(cells: []const Cell, idx: u16) void {
    const r: u8 = @intCast(idx / BOARD_SIZE);
    const c: u8 = @intCast(idx % BOARD_SIZE);

    var black_codes: [4]DirCode = undefined;
    var white_codes: [4]DirCode = undefined;
    for (0..4) |dir_idx| {
        const dual = classifyDirectionDual(cells, r, c, dir_idx);
        black_codes[dir_idx] = dual.black;
        white_codes[dir_idx] = dual.white;
    }

    prospect_state.dir_code[idx] = .{ packCodes(black_codes), packCodes(white_codes) };
    refreshContribAt(idx);
}

/// 全空点を走査してインクリメンタル状態をフル構築する。
pub fn initFromBoard(cells: []const Cell) void {
    ensureTables();
    prospect_state.sum = .{ .{ 0, 0 }, .{ 0, 0 } };

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            const idx: u16 = @as(u16, r) * BOARD_SIZE + c;
            if (cells[idx] != .empty) continue;

            refreshFullAt(cells, idx);
            addContribAt(idx);
        }
    }
}

/// (row,col) を通る4ライン上、距離1〜4の空点とその方向インデックスを収集する
/// （updateOnPlace/updateOnRemove の周辺差分更新用。最大 4方向×2符号×距離4 = 32点）。
const AffectedEmptyCell = struct { idx: u16, dir_idx: u8 };

fn collectAffectedEmptyCells(cells: []const Cell, row: u8, col: u8, buf: *[32]AffectedEmptyCell) u8 {
    var count: u8 = 0;
    for (board_mod.DIRECTIONS, 0..) |dir, dir_idx_usize| {
        const dir_idx: u8 = @intCast(dir_idx_usize);
        inline for (.{ @as(i8, 1), @as(i8, -1) }) |sign| {
            const dr: i8 = dir.dr * sign;
            const dc: i8 = dir.dc * sign;
            var r: i16 = @as(i16, row) + dr;
            var c: i16 = @as(i16, col) + dc;
            var dist: u8 = 0;
            while (dist < 4 and board_mod.isValid(r, c)) : (dist += 1) {
                const idx: u16 = @intCast(@as(u16, @intCast(r)) * BOARD_SIZE + @as(u16, @intCast(c)));
                if (cells[idx] == .empty) {
                    buf[count] = .{ .idx = idx, .dir_idx = dir_idx };
                    count += 1;
                }
                r += dr;
                c += dc;
            }
        }
    }
    return count;
}

/// 中心 (row,col) の dir_index 方向の9マス窓から、黒視点・白視点の DirCode を
/// **1回のセル走査で同時に**求める（perf レビュー指摘S1対応: 抽出回数半減）。
/// 窓生成則（own/block の定義）は `ll.extractWindowFromCellsDual`（SSoT）に委譲する
/// （P2 レビュー対応: 窓生成則の二実装解消。等価性はテストで固定する）。
/// 分類は DIR_PROSPECT_BLACK/WHITE テーブル参照で行う（Gate 0 対応:
/// classifyDirection 直呼びだと computePattern の跳び形検出ループが探索ホット
/// パスに乗り、prospect 実行時間の約38%を占めていた。テーブルとの全512×512
/// 一致は「テーブル整合」テストで固定済み）。
/// 呼び出し前提: (row,col) は空点（Debug で assert）・ensureTables 済みであること
/// （initFromBoard が探索開始前に必ず呼ぶ）。
fn classifyDirectionDual(cells: []const Cell, row: u8, col: u8, dir_index: usize) struct { black: DirCode, white: DirCode } {
    std.debug.assert(cells[@as(u16, row) * BOARD_SIZE + col] == .empty);
    std.debug.assert(prospect_initialized);

    const w = ll.extractWindowFromCellsDual(cells, row, col, dir_index);
    return .{
        .black = @enumFromInt(DIR_PROSPECT_BLACK[w.black_own][w.white_own | w.edge]),
        .white = @enumFromInt(DIR_PROSPECT_WHITE[w.white_own][w.black_own | w.edge]),
    };
}

/// packed u16 の dir_idx 番目のニブルを new_code に置き換える。
fn replaceNibble(packed_val: u16, dir_idx: u8, new_code: DirCode) u16 {
    const shift: u4 = @intCast(@as(u16, dir_idx) * 4);
    const mask: u16 = ~(@as(u16, 0xF) << shift);
    return (packed_val & mask) | (@as(u16, @intFromEnum(new_code)) << shift);
}

/// (row,col) に石が置かれた/除かれたことで影響を受ける周辺空点（距離1〜4、該当1方向のみ）
/// の dir_code/contrib/sum を差分更新する。updateOnPlace と updateOnRemove が共有する
/// （変わるのは自セルの扱いのみで、周辺差分ロジックは同一）。
/// 新旧の packed dir_code（黒白とも）が不変なら subtract/refresh/add を丸ごと
/// skip する（perf レビュー指摘対応: 分類結果が変わらない周辺セルの無駄な
/// CELL_CAT 参照・sum 加減算を避ける）。
fn updateNeighborDirections(cells: []const Cell, row: u8, col: u8) void {
    var buf: [32]AffectedEmptyCell = undefined;
    const count = collectAffectedEmptyCells(cells, row, col, &buf);
    for (buf[0..count]) |aff| {
        const ar: u8 = @intCast(aff.idx / BOARD_SIZE);
        const ac: u8 = @intCast(aff.idx % BOARD_SIZE);
        const dual = classifyDirectionDual(cells, ar, ac, aff.dir_idx);

        const old_black = prospect_state.dir_code[aff.idx][0];
        const old_white = prospect_state.dir_code[aff.idx][1];
        const new_black = replaceNibble(old_black, aff.dir_idx, dual.black);
        const new_white = replaceNibble(old_white, aff.dir_idx, dual.white);

        if (new_black == old_black and new_white == old_white) continue;

        subtractContribAt(aff.idx);
        prospect_state.dir_code[aff.idx] = .{ new_black, new_white };
        refreshContribAt(aff.idx);
        addContribAt(aff.idx);
    }
}

/// 石を配置した後に呼ぶ（cells/bitboard は既に更新済みの前提）。
/// 1. 置点自身: 空点でなくなるため寄与を除去する（entry は stale のまま残す）。
/// 2. 周辺空点: 該当1方向×2色のみ再分類する（updateNeighborDirections）。
pub fn updateOnPlace(cells: []const Cell, row: u8, col: u8, color: Cell) void {
    const self_idx: u16 = @as(u16, row) * BOARD_SIZE + col;
    std.debug.assert(cells[self_idx] == color);

    subtractContribAt(self_idx);
    updateNeighborDirections(cells, row, col);
}

/// 石を除去した後に呼ぶ（cells/bitboard は既に更新済みの前提）。
/// 1. 置点自身: 再び空点になるため4方向×2色をフル再計算する（stale値の再利用禁止）。
/// 2. 周辺空点: 該当1方向×2色のみ再分類する（updateNeighborDirections）。
pub fn updateOnRemove(cells: []const Cell, row: u8, col: u8) void {
    const self_idx: u16 = @as(u16, row) * BOARD_SIZE + col;
    std.debug.assert(cells[self_idx] == .empty);

    refreshFullAt(cells, self_idx);
    addContribAt(self_idx);
    updateNeighborDirections(cells, row, col);
}

/// prospect_state.sum から評価値を計算する（evaluateFull と同じ §2.3 の式・クランプ、
/// combineFromSums 共有）。
pub fn getStateEval(perspective: Cell, stm: StmMode) i32 {
    return combineFromSums(prospect_state.sum, perspective, stm);
}

// ============================================================================
// Tests
// ============================================================================

const forbidden = @import("forbidden.zig");
const evaluate = @import("evaluate.zig");

test "initProspectTables runs and is idempotent" {
    initProspectTables();
    initProspectTables();
}

// --- 1. 各 DirCode の代表例と境界 ---

test "classifyDirection: 空盤中央はF1（両側に余裕あり）" {
    try std.testing.expectEqual(DirCode.f1, classifyDirection(0, 0, .black));
    try std.testing.expectEqual(DirCode.f1, classifyDirection(0, 0, .white));
}

test "classifyDirection: 片側全埋めはB1" {
    // block bits 0..3（負方向）を全埋め → 負方向に余地なし、正方向は余地あり
    const block: u9 = 0b0000_0000_1111;
    try std.testing.expectEqual(DirCode.b1, classifyDirection(0, block, .black));
}

test "classifyDirection: 両側全埋め（中心から5マス以内で五が作れない）はDEAD" {
    // block bits 3 と 5 の2点で、中心を通る5連続窓5つを全てヒットできる
    const block: u9 = (1 << 3) | (1 << 5);
    try std.testing.expectEqual(DirCode.dead, classifyDirection(0, block, .black));
    try std.testing.expectEqual(DirCode.dead, classifyDirection(0, block, .white));
}

test "classifyDirection: F2/B2" {
    // own bits 3,5（中心4を挟んで両側に1石ずつ）→ 中心配置で count=3 になってしまうので
    // 活二の例は片側寄せにする: own bit5（正方向1石）
    const own_open: u9 = 1 << 5;
    try std.testing.expectEqual(DirCode.f2, classifyDirection(own_open, 0, .black));

    // 片端blocked
    const block: u9 = 1 << 6; // 正方向2つ先をblock
    try std.testing.expectEqual(DirCode.b2, classifyDirection(own_open, block, .black));
}

test "classifyDirection: F3/B3（連続三）" {
    const own: u9 = (1 << 3) | (1 << 5); // 中心を挟み両側1石ずつ → count=3
    try std.testing.expectEqual(DirCode.f3, classifyDirection(own, 0, .black));
    try std.testing.expectEqual(DirCode.f3, classifyDirection(own, 0, .white));

    const block: u9 = 1 << 6; // 正方向端をblock
    try std.testing.expectEqual(DirCode.b3, classifyDirection(own, block, .black));
}

test "classifyDirection: F4/B4（連続四）" {
    const own: u9 = (1 << 3) | (1 << 5) | (1 << 6); // count=4, 両端open
    try std.testing.expectEqual(DirCode.f4, classifyDirection(own, 0, .black));
    try std.testing.expectEqual(DirCode.f4, classifyDirection(own, 0, .white));

    const block: u9 = 1 << 7; // 正方向端をblock
    try std.testing.expectEqual(DirCode.b4, classifyDirection(own, block, .black));
}

test "classifyDirection: F5は白count>=5、黒count==5ちょうど" {
    const own5: u9 = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6); // count=5（中心含め5連続）
    try std.testing.expectEqual(DirCode.f5, classifyDirection(own5, 0, .black));
    try std.testing.expectEqual(DirCode.f5, classifyDirection(own5, 0, .white));
}

test "classifyDirection: 黒count==6（長連）はDEAD、白count==6はF5" {
    // own bits 0,1,2,3（負4連続）+ 5（正1）→ count = 1+1+4 = 6
    const own6: u9 = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 5);
    try std.testing.expectEqual(DirCode.dead, classifyDirection(own6, 0, .black));
    try std.testing.expectEqual(DirCode.f5, classifyDirection(own6, 0, .white));
}

test "classifyDirection: 跳び四はcount!=4でもB4" {
    // line_lookup.zig の "jump four OOO_O" と同一パターン: own bits 2,3(,4=中心),6
    const own: u9 = (1 << 2) | (1 << 3) | (1 << 6);
    const r = ll.computePattern(own | (1 << 4), 0);
    try std.testing.expect(r.has_jump_four);
    try std.testing.expect(r.count != 4); // count=3であることを前提にした近似テスト
    try std.testing.expectEqual(DirCode.b4, classifyDirection(own, 0, .black));
    try std.testing.expectEqual(DirCode.b4, classifyDirection(own, 0, .white));
}

test "classifyDirection: 跳び三はcount!=3でもF3" {
    // line_lookup.zig の "jump three _OO_O_" と同一パターン: own bits 3(,4=中心),6
    const own: u9 = (1 << 3) | (1 << 6);
    const r = ll.computePattern(own | (1 << 4), 0);
    try std.testing.expect(r.has_jump_three);
    try std.testing.expect(r.count != 3);
    try std.testing.expectEqual(DirCode.f3, classifyDirection(own, 0, .black));
    try std.testing.expectEqual(DirCode.f3, classifyDirection(own, 0, .white));
}

// --- 2. F3 の達四空間チェック（レビュー fix1: 窓内で正確に判定可能） ---

test "F3達四空間: 両外外塞がり ○.●●●.○ → B3（達四不能）" {
    // 三 = bits 3,4(中心),5。隣接端 bits 2,6 は空き。外外 bits 1,7 を block。
    // 達四（活四）を作る点が両方塞がれているため、連珠的には活三ではない。
    const own: u9 = (1 << 3) | (1 << 5);
    const block: u9 = (1 << 1) | (1 << 7);
    try std.testing.expectEqual(DirCode.b3, classifyDirection(own, block, .black));
    try std.testing.expectEqual(DirCode.b3, classifyDirection(own, block, .white));
}

test "F3達四空間: 片側の外外のみ塞がり → F3のまま" {
    const own: u9 = (1 << 3) | (1 << 5);
    const block_pos: u9 = 1 << 7; // 正方向の外外のみ塞がり → 負方向で達四可能
    try std.testing.expectEqual(DirCode.f3, classifyDirection(own, block_pos, .black));
    const block_neg: u9 = 1 << 1; // 負方向の外外のみ塞がり → 正方向で達四可能
    try std.testing.expectEqual(DirCode.f3, classifyDirection(own, block_neg, .black));
}

test "F3達四空間: 盤端際の三（実盤面）→ B3" {
    // row7: 黒(7,1),(7,2)、候補(7,3)、白(7,5)。
    // 三 [c1..c3]: 隣接端 (7,0),(7,4) は空きだが、外外は (7,-1)=盤外 / (7,5)=白で
    // 両方塞がり → 達四不能 → B3。
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    cells[7 * BOARD_SIZE + 1] = .black;
    cells[7 * BOARD_SIZE + 2] = .black;
    cells[7 * BOARD_SIZE + 5] = .white;

    const codes = computeCellCodes(&cells, 7, 3, .black);
    try std.testing.expectEqual(DirCode.b3, codes[0]); // dir 0 = 横
}

// --- 2b. 黒の四三三（レビュー fix2: f3×2 は四系と同時でも三三禁） ---

test "cellCategory: 黒 b4+f3+f3 → double_three_black_risk（四三三は禁手）" {
    const codes = [4]DirCode{ .b4, .f3, .f3, .dead };
    try std.testing.expectEqual(CellCat.double_three_black_risk, cellCategory(codes, .black));
}

test "cellCategory: 白 b4+f3+f3 → four_three のまま" {
    const codes = [4]DirCode{ .b4, .f3, .f3, .dead };
    try std.testing.expectEqual(CellCat.four_three, cellCategory(codes, .white));
}

test "cellCategory: 黒 f4+f3+f3 → double_three_black_risk（活四があっても三三禁）" {
    const codes = [4]DirCode{ .f4, .f3, .f3, .dead };
    try std.testing.expectEqual(CellCat.double_three_black_risk, cellCategory(codes, .black));
    // 白は活四支配で solo_f4 のまま
    try std.testing.expectEqual(CellCat.solo_f4, cellCategory(codes, .white));
}

// --- 3. 近似の固定テスト ---

test "近似固定: 窓端の長連は観測できない（中心から5マス先の黒石は不可視）" {
    // own bits 5,6,7（正方向3連続、count_pos=3）→ 中心含め count=4, 開放端は bit8
    // オーバーライン確認点は run+2=5 マス先 → bit(4+5)=9 は窓外（0..8を超える）→ 不可視
    const own: u9 = (1 << 5) | (1 << 6) | (1 << 7);
    // 窓内だけを見る限り両端openなのでF4になる（本来は窓外の黒石で長連の可能性があっても検出不能）
    try std.testing.expectEqual(DirCode.f4, classifyDirection(own, 0, .black));
}

test "黒オーバーライン: 片端のみ窓内補正 → F4がB4へ降格（窓ビット直接）" {
    // own bits 3,5,6（count=4, run正方向=2, 負方向=1）+ bit8（正方向のオーバーライン石:
    // 4+2+2=8 は窓内）。正方向端のみ補正で塞がり、負方向端は開き → B4。
    // 白は補正なしで F4 のまま。
    const own: u9 = (1 << 3) | (1 << 5) | (1 << 6) | (1 << 8);
    try std.testing.expectEqual(DirCode.b4, classifyDirection(own, 0, .black));
    try std.testing.expectEqual(DirCode.f4, classifyDirection(own, 0, .white));
}

test "近似固定: 窓内で観測できる長連は正しくDEAD/B4に補正される（bug#2相当）" {
    // evaluate.zig の createsFourThree bug#2 と同一局面。
    // 縦col7: (5,7)黒(中心から-2), (6,7)空, cand(7,7), (8,7)(9,7)(10,7)黒(+1..+3), (11,7)白(+4)
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[8 * BOARD_SIZE + 7] = .black;
    cells[9 * BOARD_SIZE + 7] = .black;
    cells[10 * BOARD_SIZE + 7] = .black;
    cells[11 * BOARD_SIZE + 7] = .white;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;

    const codes = computeCellCodes(&cells, 7, 7, .black);
    // dir 1 = 縦（board.zig DIRECTIONS順）
    try std.testing.expectEqual(DirCode.dead, codes[1]);
    // dir 0 = 横: (7,5)(7,6)黒、両端open → 活三
    try std.testing.expectEqual(DirCode.f3, codes[0]);

    bitboard.initFromCells(&cells);
    try std.testing.expect(!evaluate.createsFourThree(&cells, 7, 7, .black));

    // 対照: 長連石(5,7)を白にすると縦方向は真の四(B4)になり、四三が成立する
    cells[5 * BOARD_SIZE + 7] = .white;
    const codes2 = computeCellCodes(&cells, 7, 7, .black);
    try std.testing.expectEqual(DirCode.b4, codes2[1]);
    try std.testing.expectEqual(DirCode.f3, codes2[0]);

    bitboard.initFromCells(&cells);
    try std.testing.expect(evaluate.createsFourThree(&cells, 7, 7, .black));
}

test "近似固定: 黒三三禁の可能性があってもF3+F3(risk)に分類される" {
    // forbidden.zig の「三三禁」テストと同一局面（(7,7)は実際には黒の禁手点）。
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;

    try std.testing.expectEqual(forbidden.ForbiddenType.double_three, forbidden.checkForbiddenMove(&cells, 7, 7));

    const codes = computeCellCodes(&cells, 7, 7, .black);
    try std.testing.expectEqual(DirCode.f3, codes[0]); // 横
    try std.testing.expectEqual(DirCode.f3, codes[1]); // 縦

    // 大域禁手判定を知らないため、カテゴリは「禁止」ではなく専用減点カテゴリに畳み込む
    const cat = cellCategory(codes, .black);
    try std.testing.expectEqual(CellCat.double_three_black_risk, cat);
}

test "近似固定: 単線双四はB4 1個に潰れ四四禁にならない" {
    // forbidden.zig の「同方向の2つの飛び四で四四禁」局面: row=5, col 3,5,7,9 黒。
    // (5,6) に置くと同一方向（横）に2つの真の飛び四が成立する（本来は黒の禁手）。
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    cells[5 * BOARD_SIZE + 3] = .black;
    cells[5 * BOARD_SIZE + 5] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[5 * BOARD_SIZE + 9] = .black;

    try std.testing.expectEqual(forbidden.ForbiddenType.double_four, forbidden.checkForbiddenMove(&cells, 5, 6));

    const codes = computeCellCodes(&cells, 5, 6, .black);
    // dir 0 = 横 のみが四四相当だが DirCode は方向あたり1個 → B4
    try std.testing.expectEqual(DirCode.b4, codes[0]);
    // 他の3方向は石なし → weak側
    var four_tier_count: u8 = 0;
    for (codes) |c| {
        if (isFourTier(c)) four_tier_count += 1;
    }
    try std.testing.expectEqual(@as(u8, 1), four_tier_count); // 異方向の四四には見えない

    const cat = cellCategory(codes, .black);
    try std.testing.expect(cat != CellCat.none); // 四四禁(dead級)には畳み込まれない
}

test "近似固定: 白の単線双四も solo_b4（double_four_white にならない過小評価）" {
    // 単線双四の同じ盤形を白で: row=5, col 3,5,7,9 白。(5,6) に白を置くと同一
    // 方向（横）に2つの飛び四が成立し実質勝ち級だが、DirCode は方向あたり1個の
    // ため B4 1個 → カテゴリは solo_b4 に過小評価される（仕様上の近似）。
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    cells[5 * BOARD_SIZE + 3] = .white;
    cells[5 * BOARD_SIZE + 5] = .white;
    cells[5 * BOARD_SIZE + 7] = .white;
    cells[5 * BOARD_SIZE + 9] = .white;

    const codes = computeCellCodes(&cells, 5, 6, .white);
    try std.testing.expectEqual(DirCode.b4, codes[0]); // 横のみ四系
    const cat = cellCategory(codes, .white);
    try std.testing.expectEqual(CellCat.solo_b4, cat); // 勝ち級(double_four_white)にはならない
}

// --- 4. カテゴリ畳み込み ---

test "cellCategory: B4+F3 → four_three（色によらず）" {
    const codes = [4]DirCode{ .b4, .f3, .dead, .dead };
    try std.testing.expectEqual(CellCat.four_three, cellCategory(codes, .black));
    try std.testing.expectEqual(CellCat.four_three, cellCategory(codes, .white));
}

test "cellCategory: 黒 B4+B4（異方向）→ none（四四禁のdead級）" {
    const codes = [4]DirCode{ .b4, .b4, .dead, .dead };
    try std.testing.expectEqual(CellCat.none, cellCategory(codes, .black));
}

test "cellCategory: 白 B4+B4（異方向）→ double_four_white（勝ち級）" {
    const codes = [4]DirCode{ .b4, .b4, .dead, .dead };
    try std.testing.expectEqual(CellCat.double_four_white, cellCategory(codes, .white));
}

test "cellCategory: 黒 F3+F3 → double_three_black_risk（黒専用減点）" {
    const codes = [4]DirCode{ .f3, .f3, .dead, .dead };
    try std.testing.expectEqual(CellCat.double_three_black_risk, cellCategory(codes, .black));
}

test "cellCategory: 白 F3+F3 → double_three_white（強打）" {
    const codes = [4]DirCode{ .f3, .f3, .dead, .dead };
    try std.testing.expectEqual(CellCat.double_three_white, cellCategory(codes, .white));
}

test "cellCategory: F5が1つでもあれば win" {
    const codes = [4]DirCode{ .f5, .dead, .dead, .dead };
    try std.testing.expectEqual(CellCat.win, cellCategory(codes, .black));
    try std.testing.expectEqual(CellCat.win, cellCategory(codes, .white));
}

test "cellCategory: 単独/発展形カテゴリの網羅" {
    try std.testing.expectEqual(CellCat.solo_f4, cellCategory(.{ .f4, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.solo_b4, cellCategory(.{ .b4, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.solo_f3, cellCategory(.{ .f3, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.solo_b3, cellCategory(.{ .b3, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.solo_f2, cellCategory(.{ .f2, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.solo_b2, cellCategory(.{ .b2, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.weak, cellCategory(.{ .f1, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.weak, cellCategory(.{ .b1, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.none, cellCategory(.{ .dead, .dead, .dead, .dead }, .black));
    try std.testing.expectEqual(CellCat.f3_b3, cellCategory(.{ .f3, .b3, .dead, .dead }, .white));
    try std.testing.expectEqual(CellCat.f3_f2, cellCategory(.{ .f3, .f2, .dead, .dead }, .white));
    try std.testing.expectEqual(CellCat.b4_f2, cellCategory(.{ .b4, .f2, .dead, .dead }, .white));
    try std.testing.expectEqual(CellCat.double_f2, cellCategory(.{ .f2, .f2, .dead, .dead }, .white));
}

// --- 5. テーブル整合 ---

test "テーブル整合: DIR_PROSPECT_BLACK/WHITE は全512x512でclassifyDirectionと一致" {
    initProspectTables();
    var own_i: u32 = 0;
    while (own_i < 512) : (own_i += 1) {
        var block_i: u32 = 0;
        while (block_i < 512) : (block_i += 1) {
            const own: u9 = @intCast(own_i);
            const block: u9 = @intCast(block_i);
            const expected_b = @intFromEnum(classifyDirection(own, block, .black));
            const expected_w = @intFromEnum(classifyDirection(own, block, .white));
            try std.testing.expectEqual(expected_b, DIR_PROSPECT_BLACK[own_i][block_i]);
            try std.testing.expectEqual(expected_w, DIR_PROSPECT_WHITE[own_i][block_i]);
        }
    }
}

test "テーブル整合: CELL_CAT は全65536×2でcellCategoryと一致" {
    initProspectTables();
    var packed_i: u32 = 0;
    while (packed_i < 65536) : (packed_i += 1) {
        const packed_val: u16 = @intCast(packed_i);
        const codes = unpackCodes(packed_val);
        const expected_b = @intFromEnum(cellCategory(codes, .black));
        const expected_w = @intFromEnum(cellCategory(codes, .white));
        try std.testing.expectEqual(expected_b, CELL_CAT[packed_val][0]);
        try std.testing.expectEqual(expected_w, CELL_CAT[packed_val][1]);
    }
}

test "プロパティ: pack→unpack ラウンドトリップ（全10^4有効組合せ）" {
    // DirCode の有効値は 0..9。全組み合わせで packCodes → unpackCodes が恒等。
    var a: u4 = 0;
    while (a <= 9) : (a += 1) {
        var b: u4 = 0;
        while (b <= 9) : (b += 1) {
            var c: u4 = 0;
            while (c <= 9) : (c += 1) {
                var d: u4 = 0;
                while (d <= 9) : (d += 1) {
                    const codes = [4]DirCode{
                        @enumFromInt(a),
                        @enumFromInt(b),
                        @enumFromInt(c),
                        @enumFromInt(d),
                    };
                    const roundtripped = unpackCodes(packCodes(codes));
                    try std.testing.expectEqual(codes, roundtripped);
                }
            }
        }
    }
}

test "プロパティ: 全512×512窓で黒コード<=白コード（黒は禁手補正で降格のみ）" {
    // 黒の分類は白との差分が「長連 dead 化・オーバーライン端補正・f5 の =5 制限」
    // という降格のみで、昇格するパスは存在しない。数値順＝強さ順（comptime assert
    // 済み）なので @intFromEnum の比較で固定できる。
    var own_i: u32 = 0;
    while (own_i < 512) : (own_i += 1) {
        var block_i: u32 = 0;
        while (block_i < 512) : (block_i += 1) {
            const own: u9 = @intCast(own_i);
            const block: u9 = @intCast(block_i);
            const black_code = @intFromEnum(classifyDirection(own, block, .black));
            const white_code = @intFromEnum(classifyDirection(own, block, .white));
            try std.testing.expect(black_code <= white_code);
        }
    }
}

// --- 6. computeCellCodes の実盤面クロスチェック ---

test "computeCellCodes: 四三点でb4系+f3系が異方向に立つ（createsFourThreeと整合）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    // 横: (7,4),(7,5),(7,6) → (7,7)で四（片端(7,3)は空、もう片端(7,8)も空なのでcand次第でF4になりうるため
    // ここでは (7,3) をblockして確実にB4にする
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    // 縦: (5,7),(6,7) → (7,7)で活三
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;

    bitboard.initFromCells(&cells);
    try std.testing.expect(evaluate.createsFourThree(&cells, 7, 7, .black));

    const codes = computeCellCodes(&cells, 7, 7, .black);
    var has_four_tier = false;
    var has_three_tier = false;
    for (codes) |c| {
        if (isFourTier(c)) has_four_tier = true;
        if (isThreeTier(c)) has_three_tier = true;
    }
    try std.testing.expect(has_four_tier);
    try std.testing.expect(has_three_tier);

    const cat = cellCategory(codes, .black);
    try std.testing.expectEqual(CellCat.four_three, cat);
}

test "getProspectCategoryName: 全カテゴリでnull終端文字列を返す" {
    inline for (@typeInfo(CellCat).@"enum".fields) |field| {
        const cat: CellCat = @enumFromInt(field.value);
        const name = getProspectCategoryName(cat);
        try std.testing.expect(name[0] != 0);
    }
}

// --- 7. evaluateFull（第3段: フル計算パス） ---

/// four_three フィクスチャ（既存 "computeCellCodes: 四三点で..." テストと同一局面）。
/// (7,7) が黒の四三点（横 dir0=b4, 縦 dir1=f3）になる非対称局面。
fn setupFourThreeFixture(cells: *[board_mod.CELL_COUNT]Cell) void {
    @memset(cells, .empty);
    cells[7 * BOARD_SIZE + 3] = .white;
    cells[7 * BOARD_SIZE + 4] = .black;
    cells[7 * BOARD_SIZE + 5] = .black;
    cells[7 * BOARD_SIZE + 6] = .black;
    cells[5 * BOARD_SIZE + 7] = .black;
    cells[6 * BOARD_SIZE + 7] = .black;
}

test "evaluateFull: 空盤はaverageで0（weak寄与が両手番列で打ち消し合う）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    try std.testing.expectEqual(@as(i32, 0), evaluateFull(&cells, .black, .average));
    try std.testing.expectEqual(@as(i32, 0), evaluateFull(&cells, .white, .average));
}

test "evaluateFull: 空盤でも perspective/opponent は非ゼロ（全空点が着手候補=weakとして評価される設計上の帰結）" {
    // 空盤では黒白ともに全空点が f1×4→weak に分類され、cat_persp==cat_opp となる。
    // このとき raw(persp手番) と raw(相手手番) は厳密に符号反転の関係になり、
    // 平均のみ0（上のテスト）。個別の stm 値は「手番側が有利」という設計上、非ゼロになる。
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    const persp_to_move = evaluateFull(&cells, .black, .perspective);
    const opp_to_move = evaluateFull(&cells, .black, .opponent);
    try std.testing.expect(persp_to_move != 0);
    try std.testing.expectEqual(persp_to_move, -opp_to_move);
}

test "evaluateFull: 反対称性 eval(persp)==-eval(opp)（stm 3値すべて）" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);

    // stm=black-to-move の視点: black.perspective ⇔ white.opponent
    try std.testing.expectEqual(
        evaluateFull(&cells, .black, .perspective),
        -evaluateFull(&cells, .white, .opponent),
    );
    // stm=white-to-move の視点: black.opponent ⇔ white.perspective
    try std.testing.expectEqual(
        evaluateFull(&cells, .black, .opponent),
        -evaluateFull(&cells, .white, .perspective),
    );
    // average は手番に依らず対称
    try std.testing.expectEqual(
        evaluateFull(&cells, .black, .average),
        -evaluateFull(&cells, .white, .average),
    );
}

test "evaluateFull: stm(手番)によって評価値が変わる局面" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);

    const when_black_to_move = evaluateFull(&cells, .black, .perspective);
    const when_white_to_move = evaluateFull(&cells, .black, .opponent);
    try std.testing.expect(when_black_to_move != when_white_to_move);
}

test "evaluateFull: averageはperspective/opponentの平均（切り捨て）と一致" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);

    const persp = evaluateFull(&cells, .black, .perspective);
    const opp = evaluateFull(&cells, .black, .opponent);
    const avg = evaluateFull(&cells, .black, .average);
    // クランプに掛からない前提（four_three フィクスチャは小規模なので範囲内）
    try std.testing.expectEqual(@divTrunc(persp + opp, 2), avg);
}

test "evaluateFull: 四三点(four_three)を持つ局面は同等の縦三が無い局面より黒視点で有意に高評価" {
    var with_vertical: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&with_vertical);

    // 縦の2石を置かないバリアント: (7,7)は四(b4)単独カテゴリ(solo_b4)に留まる
    var without_vertical = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    without_vertical[7 * BOARD_SIZE + 3] = .white;
    without_vertical[7 * BOARD_SIZE + 4] = .black;
    without_vertical[7 * BOARD_SIZE + 5] = .black;
    without_vertical[7 * BOARD_SIZE + 6] = .black;

    const codes_at_77 = computeCellCodes(&with_vertical, 7, 7, .black);
    try std.testing.expectEqual(CellCat.four_three, cellCategory(codes_at_77, .black));
    const codes_at_77_no_vertical = computeCellCodes(&without_vertical, 7, 7, .black);
    try std.testing.expectEqual(CellCat.solo_b4, cellCategory(codes_at_77_no_vertical, .black));

    const eval_with = evaluateFull(&with_vertical, .black, .average);
    const eval_without = evaluateFull(&without_vertical, .black, .average);
    // four_three と solo_b4 の平均重み差（P3-d 焼き込み後:
    // (598+3000)/2 - (116+144)/2 = 1669）に近い差が出る前提。
    // 周辺空点の分類変化ノイズを許容してマージンは控えめに取る。
    try std.testing.expect(eval_with - eval_without > 1000);
}

test "evaluateFull: 評価総和はPROSPECT_EVAL_CLAMPで上下限にクランプされる" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    defer resetProspectScores();

    // weak は空盤の全225空点が持つカテゴリ。stm列だけ巨大化して総和を溢れさせる。
    PROSPECT_SCORE[@intFromEnum(CellCat.weak)] = .{ 0, 2_000_000 };
    try std.testing.expectEqual(PROSPECT_EVAL_CLAMP, evaluateFull(&cells, .black, .perspective));

    PROSPECT_SCORE[@intFromEnum(CellCat.weak)] = .{ 2_000_000, 0 };
    try std.testing.expectEqual(-PROSPECT_EVAL_CLAMP, evaluateFull(&cells, .black, .perspective));
}

test "resetProspectScores: PROSPECT_SCOREを既定値に復元する" {
    defer resetProspectScores();
    PROSPECT_SCORE[0] = .{ 9999, 9999 };
    resetProspectScores();
    try std.testing.expectEqual(PROSPECT_SCORE_DEFAULT, PROSPECT_SCORE);
}

// --- 8. setProspectParam / getProspectParam / getProspectParamName（id 100〜） ---

test "setProspectParam/getProspectParam: 往復（境界 offset=0, offset=PROSPECT_PARAM_COUNT-1）" {
    defer resetProspectScores();
    setProspectParam(0, 12345);
    try std.testing.expectEqual(@as(i32, 12345), getProspectParam(0));

    setProspectParam(PROSPECT_PARAM_COUNT - 1, -777);
    try std.testing.expectEqual(@as(i32, -777), getProspectParam(PROSPECT_PARAM_COUNT - 1));
}

test "getProspectParam: 範囲外(offset>=PROSPECT_PARAM_COUNT)はEVAL_PARAM_UNKNOWN" {
    try std.testing.expectEqual(scores.EVAL_PARAM_UNKNOWN, getProspectParam(PROSPECT_PARAM_COUNT));
}

test "setProspectParam: 範囲外は無視されクラッシュしない（既存値は無傷）" {
    defer resetProspectScores();
    setProspectParam(PROSPECT_PARAM_COUNT, 999);
    try std.testing.expectEqual(PROSPECT_SCORE_DEFAULT, PROSPECT_SCORE);
}

test "getProspectParamName: four_three/win の手番(TURN)・非手番(WAIT)名" {
    const four_three_offset: u32 = @as(u32, @intFromEnum(CellCat.four_three)) * 2;
    try std.testing.expectEqualStrings(
        "PROSPECT_FOUR_THREE_WAIT",
        std.mem.span(getProspectParamName(four_three_offset)),
    );
    try std.testing.expectEqualStrings(
        "PROSPECT_FOUR_THREE_TURN",
        std.mem.span(getProspectParamName(four_three_offset + 1)),
    );

    const win_offset: u32 = @as(u32, @intFromEnum(CellCat.win)) * 2;
    try std.testing.expectEqualStrings(
        "PROSPECT_WIN_WAIT",
        std.mem.span(getProspectParamName(win_offset)),
    );
    try std.testing.expectEqualStrings(
        "PROSPECT_WIN_TURN",
        std.mem.span(getProspectParamName(win_offset + 1)),
    );
}

test "getProspectParamName: 範囲外は空文字列" {
    try std.testing.expectEqualStrings("", std.mem.span(getProspectParamName(PROSPECT_PARAM_COUNT)));
}

test "resetProspectScores: setProspectParamで汚した後も既定値に復元する" {
    setProspectParam(0, 424242);
    resetProspectScores();
    try std.testing.expectEqual(PROSPECT_SCORE_DEFAULT, PROSPECT_SCORE);
}

test "setProspectParam の注入が evaluateFull に反映される（注入→評価→reset）" {
    defer resetProspectScores();
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;

    // weak(手番列)を巨大化 → 空盤(全空点weak)で反映確認、かつクランプに掛かることも確認。
    const weak_turn_offset: u32 = @as(u32, @intFromEnum(CellCat.weak)) * 2 + 1;
    setProspectParam(weak_turn_offset, 1_000_000);
    try std.testing.expectEqual(PROSPECT_EVAL_CLAMP, evaluateFull(&cells, .black, .perspective));
}

// --- 9. extractFeatures（P3 特徴ダンプ用） ---

fn dotProduct(features: [PROSPECT_PARAM_COUNT]i32) i32 {
    var dot: i32 = 0;
    for (features, 0..) |x, i| {
        dot += x * PROSPECT_SCORE[i / 2][i % 2];
    }
    return dot;
}

test "extractFeatures: 内積がevaluateFullのクランプ前rawと一致する（stm両値、four_threeフィクスチャ）" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);

    var features: [PROSPECT_PARAM_COUNT]i32 = undefined;

    extractFeatures(&cells, .black, true, &features);
    try std.testing.expectEqual(evaluateFull(&cells, .black, .perspective), dotProduct(features));

    extractFeatures(&cells, .black, false, &features);
    try std.testing.expectEqual(evaluateFull(&cells, .black, .opponent), dotProduct(features));
}

test "extractFeatures: 空盤でも内積がevaluateFullと一致する（stm両値）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    var features: [PROSPECT_PARAM_COUNT]i32 = undefined;

    extractFeatures(&cells, .black, true, &features);
    try std.testing.expectEqual(evaluateFull(&cells, .black, .perspective), dotProduct(features));

    extractFeatures(&cells, .black, false, &features);
    try std.testing.expectEqual(evaluateFull(&cells, .black, .opponent), dotProduct(features));
}

test "extractFeatures: 白視点でも内積が一致する（反対称性の間接確認）" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);

    var features: [PROSPECT_PARAM_COUNT]i32 = undefined;
    extractFeatures(&cells, .white, true, &features);
    try std.testing.expectEqual(evaluateFull(&cells, .white, .perspective), dotProduct(features));
}

// --- 10. ProspectState（P2-a インクリメンタル状態） ---

const STM_MODE_VALUES = [_]StmMode{ .perspective, .opponent, .average };

test "classifyDirectionDual: 全225空点×4方向でextractWindowFromCells二回呼びと一致する（石を散らした非対称局面、盤端含む）" {
    // イシュー指摘対応: 特定セルだけでなく全空点×全方向を網羅する（SSoT化後の等価性保証）。
    // classifyDirectionDual は DIR_PROSPECT テーブルを参照するため、他テストの実行順に
    // 依存せず自己完結するようここで初期化する（レビュー指摘対応）。
    initProspectTables();
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    @memset(&cells, .empty);

    // 対称性を崩し、盤端・盤中央を両方含むよう非対称に石を散らす。
    const stones = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 7, .c = 7, .color = .black },
        .{ .r = 7, .c = 8, .color = .black },
        .{ .r = 6, .c = 8, .color = .white },
        .{ .r = 5, .c = 9, .color = .white },
        .{ .r = 3, .c = 3, .color = .black },
        .{ .r = 0, .c = 0, .color = .white },
        .{ .r = 0, .c = 14, .color = .black },
        .{ .r = 14, .c = 0, .color = .white },
        .{ .r = 14, .c = 14, .color = .black },
        .{ .r = 10, .c = 4, .color = .white },
        .{ .r = 2, .c = 12, .color = .black },
        .{ .r = 12, .c = 2, .color = .white },
    };
    for (stones) |s| {
        cells[@as(u16, s.r) * BOARD_SIZE + s.c] = s.color;
    }

    for (0..BOARD_SIZE) |r_usize| {
        const r: u8 = @intCast(r_usize);
        for (0..BOARD_SIZE) |c_usize| {
            const c: u8 = @intCast(c_usize);
            if (cells[@as(u16, r) * BOARD_SIZE + c] != .empty) continue;
            for (0..4) |dir_idx| {
                const dual = classifyDirectionDual(&cells, r, c, dir_idx);
                const wb = ll.extractWindowFromCells(&cells, r, c, dir_idx, .black);
                const ww = ll.extractWindowFromCells(&cells, r, c, dir_idx, .white);
                try std.testing.expectEqual(classifyDirection(wb.own, wb.block, .black), dual.black);
                try std.testing.expectEqual(classifyDirection(ww.own, ww.block, .white), dual.white);
            }
        }
    }
}

test "replaceNibble: 指定ニブルのみ置換し他ニブルは不変" {
    const original: u16 = packCodes(.{ .f2, .b3, .dead, .f4 });
    const replaced = replaceNibble(original, 1, .f5);
    try std.testing.expectEqual(packCodes(.{ .f2, .f5, .dead, .f4 }), replaced);
    // 他のニブルは元のまま
    try std.testing.expectEqual(@as(u16, @intFromEnum(DirCode.f2)), replaced & 0xF);
}

test "initFromBoard: フル構築はevaluateFullと一致する（複数局面・両視点・3値stm）" {
    // 空盤
    {
        var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
        initFromBoard(&cells);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }

    // four_three フィクスチャ（非対称局面）
    {
        var cells: [board_mod.CELL_COUNT]Cell = undefined;
        setupFourThreeFixture(&cells);
        initFromBoard(&cells);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }
}

test "updateOnPlace→updateOnRemove: sumが完全に復元する（four_threeフィクスチャ＋離れた1手）" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);
    initFromBoard(&cells);
    const sum_before = prospect_state.sum;

    const r: u8 = 3;
    const c: u8 = 3;
    cells[@as(u16, r) * BOARD_SIZE + c] = .black;
    updateOnPlace(&cells, r, c, .black);
    try std.testing.expect(!std.meta.eql(sum_before, prospect_state.sum)); // 何かは変化するはず

    cells[@as(u16, r) * BOARD_SIZE + c] = .empty;
    updateOnRemove(&cells, r, c);

    try std.testing.expectEqual(sum_before, prospect_state.sum);
}

test "updateOnPlace/updateOnRemove: 複数手の対局列で毎手インクリメンタル≡evaluateFull（P1のsequenceテスト流儀）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    initFromBoard(&cells);

    const moves = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 7, .c = 7, .color = .black },
        .{ .r = 7, .c = 8, .color = .white },
        .{ .r = 8, .c = 7, .color = .black },
        .{ .r = 6, .c = 8, .color = .white },
        .{ .r = 9, .c = 7, .color = .black },
        .{ .r = 5, .c = 8, .color = .white },
        .{ .r = 6, .c = 6, .color = .black },
        .{ .r = 4, .c = 8, .color = .white },
    };

    for (moves) |m| {
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = m.color;
        updateOnPlace(&cells, m.r, m.c, m.color);

        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }

    var i: usize = moves.len;
    while (i > 0) {
        i -= 1;
        const m = moves[i];
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = .empty;
        updateOnRemove(&cells, m.r, m.c);

        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
        }
    }
}

test "updateOnPlace/updateOnRemove: 跳び四が発生する手順でも毎手インクリメンタル≡evaluateFull（分類境界固定）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    initFromBoard(&cells);

    // classifyDirection の "跳び四はcount!=4でもB4" テスト（own bits -2,-1,+2）と同型:
    // 黒(7,5)(7,6)(7,9) → (7,7)の横方向(dir0)は跳び四(B4)相当になる。
    const moves = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 7, .c = 5, .color = .black },
        .{ .r = 0, .c = 1, .color = .white },
        .{ .r = 7, .c = 6, .color = .black },
        .{ .r = 1, .c = 0, .color = .white },
        .{ .r = 7, .c = 9, .color = .black },
    };

    for (moves) |m| {
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = m.color;
        updateOnPlace(&cells, m.r, m.c, m.color);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }

    // (7,7)の横方向が跳び四(B4)に分類されていることを直接固定
    const codes = computeCellCodes(&cells, 7, 7, .black);
    try std.testing.expectEqual(DirCode.b4, codes[0]);

    var i: usize = moves.len;
    while (i > 0) {
        i -= 1;
        const m = moves[i];
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = .empty;
        updateOnRemove(&cells, m.r, m.c);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
        }
    }
}

test "updateOnPlace/updateOnRemove: 跳び三が発生する手順でも毎手インクリメンタル≡evaluateFull（分類境界固定）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    initFromBoard(&cells);

    // classifyDirection の "跳び三はcount!=3でもF3" テスト（own bits -1,+2）と同型:
    // 黒(7,6)(7,9) → (7,7)の横方向(dir0)は跳び三(F3)相当になる。
    const moves = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 7, .c = 6, .color = .black },
        .{ .r = 0, .c = 1, .color = .white },
        .{ .r = 7, .c = 9, .color = .black },
    };

    for (moves) |m| {
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = m.color;
        updateOnPlace(&cells, m.r, m.c, m.color);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }

    const codes = computeCellCodes(&cells, 7, 7, .black);
    try std.testing.expectEqual(DirCode.f3, codes[0]);

    var i: usize = moves.len;
    while (i > 0) {
        i -= 1;
        const m = moves[i];
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = .empty;
        updateOnRemove(&cells, m.r, m.c);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
        }
    }
}

test "updateOnPlace/updateOnRemove: 盤端(0,0)/(14,14)近傍の手順でも毎手インクリメンタル≡evaluateFull" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    initFromBoard(&cells);

    const moves = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 0, .c = 1, .color = .black },
        .{ .r = 1, .c = 0, .color = .white },
        .{ .r = 0, .c = 2, .color = .black },
        .{ .r = 2, .c = 0, .color = .white },
        .{ .r = 14, .c = 13, .color = .black },
        .{ .r = 13, .c = 14, .color = .white },
        .{ .r = 14, .c = 12, .color = .black },
        .{ .r = 12, .c = 14, .color = .white },
    };

    for (moves) |m| {
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = m.color;
        updateOnPlace(&cells, m.r, m.c, m.color);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }

    var i: usize = moves.len;
    while (i > 0) {
        i -= 1;
        const m = moves[i];
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = .empty;
        updateOnRemove(&cells, m.r, m.c);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
        }
    }
}

test "updateOnPlace/updateOnRemove: 黒の三三禁近傍局面でも毎手インクリメンタル≡evaluateFull（double_three_black_risk境界固定）" {
    var cells = [_]Cell{.empty} ** board_mod.CELL_COUNT;
    initFromBoard(&cells);

    // "近似固定: 黒三三禁の可能性があってもF3+F3(risk)に分類される" テストと同一局面:
    // (7,7) が黒の禁手点（forbidden.zig の三三禁）になる。
    const moves = [_]struct { r: u8, c: u8, color: Cell }{
        .{ .r = 7, .c = 5, .color = .black },
        .{ .r = 0, .c = 1, .color = .white },
        .{ .r = 7, .c = 6, .color = .black },
        .{ .r = 1, .c = 0, .color = .white },
        .{ .r = 5, .c = 7, .color = .black },
        .{ .r = 2, .c = 0, .color = .white },
        .{ .r = 6, .c = 7, .color = .black },
    };

    for (moves) |m| {
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = m.color;
        updateOnPlace(&cells, m.r, m.c, m.color);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
            try std.testing.expectEqual(evaluateFull(&cells, .white, stm), getStateEval(.white, stm));
        }
    }

    const codes = computeCellCodes(&cells, 7, 7, .black);
    try std.testing.expectEqual(CellCat.double_three_black_risk, cellCategory(codes, .black));

    var i: usize = moves.len;
    while (i > 0) {
        i -= 1;
        const m = moves[i];
        cells[@as(u16, m.r) * BOARD_SIZE + m.c] = .empty;
        updateOnRemove(&cells, m.r, m.c);
        for (STM_MODE_VALUES) |stm| {
            try std.testing.expectEqual(evaluateFull(&cells, .black, stm), getStateEval(.black, stm));
        }
    }
}

test "getStateEval: 反対称性 eval(persp)==-eval(opp)（stm 3値、インクリメンタル経由）" {
    var cells: [board_mod.CELL_COUNT]Cell = undefined;
    setupFourThreeFixture(&cells);
    initFromBoard(&cells);

    try std.testing.expectEqual(getStateEval(.black, .perspective), -getStateEval(.white, .opponent));
    try std.testing.expectEqual(getStateEval(.black, .opponent), -getStateEval(.white, .perspective));
    try std.testing.expectEqual(getStateEval(.black, .average), -getStateEval(.white, .average));
}
