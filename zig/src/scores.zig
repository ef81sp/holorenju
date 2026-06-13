const std = @import("std");

/// パターンスコア定数（patternScores.ts の PATTERN_SCORES と同値）
///
/// 四五（FIVE/OPEN_FOUR/FOUR）は事実上「勝ち」値で eval レバーにならないため
/// const 維持（勝ち判定の閾値比較の最適化を保つ）。
/// 形系（四五未満）の OPEN_THREE 以下と CENTER_BONUS / LINE_POTENTIAL_TABLE は
/// bench での実行時チューニング対象として `var` 化する（setEvalParam で注入）。
/// 既定値は不変＝override 未適用時は const 時代と完全同値。
pub const FIVE: i32 = 100000;
pub const OPEN_FOUR: i32 = 10000;
pub const FOUR: i32 = 1500;
pub var OPEN_THREE: i32 = 1000;
pub var THREE: i32 = 30;
pub var OPEN_TWO: i32 = 50;
pub var TWO: i32 = 10;
pub var CENTER_BONUS: i32 = 0;

/// 末端評価定数
pub const LEAF_FOUR_THREE_THREAT: i32 = 2000;
pub const LEAF_MISE_THREAT: i32 = 500;
pub const CONNECTIVITY_BONUS: i32 = 30;

/// テンポ補正: 活三割引率 (0.5 = 50%)
/// 整数演算用: discount = openThreeScore / 2
pub const TEMPO_OPEN_THREE_DISCOUNT_NUM: i32 = 1;
pub const TEMPO_OPEN_THREE_DISCOUNT_DEN: i32 = 2;

/// 斜めボーナス倍率 (1.05x) — 整数演算用
pub const DIAGONAL_BONUS_NUM: i32 = 105;
pub const DIAGONAL_BONUS_DEN: i32 = 100;

/// 四三ボーナス
pub const FOUR_THREE_BONUS: i32 = 5000;

/// ミセ手ボーナス
pub const MISE_BONUS: i32 = 1000;
pub const DOUBLE_MISE_BONUS: i32 = 4000;

/// 複数方向脅威ボーナス
pub const MULTI_THREAT_BONUS: i32 = 500;
pub const DEFENSE_MULTI_THREAT_BONUS: i32 = 300;

/// カウンターフォー倍率（整数演算: 150/100 = 1.5x）
pub const COUNTER_FOUR_MULTIPLIER_NUM: i32 = 150;
pub const COUNTER_FOUR_MULTIPLIER_DEN: i32 = 100;

/// 禁手追い込み
pub const FORBIDDEN_TRAP_STRONG: i32 = 5000;
pub const FORBIDDEN_TRAP_SETUP: i32 = 1500;
pub const FORBIDDEN_TRAP_THREE: i32 = 3000;

/// 禁手脆弱性
pub const FORBIDDEN_VULNERABILITY_STRONG: i32 = 1000;
pub const FORBIDDEN_VULNERABILITY_MILD: i32 = 400;
pub const FORBIDDEN_VULNERABILITY_CAP: i32 = 2000;

/// 探索用定数
pub const INFINITY: i32 = 1000000;

// --- Potential tables ---
//
// 各テーブルは sentinel `[5]=0` を含む。配列外参照を防ぐため
// 呼び出し側で popcount の上限を 5 に clamp する。

/// ライン素材の達成可能性スコア（5-cell ウィンドウ内の自色石数で索引）
/// インデックス: 自色石数 (0..5)、相手石なしの窓のみカウント
///
///   [0]=0:  空窓は素材ではない
///   [1]=3:  素材1個
///   [2]=12: 素材2個（活二の半端な状態）
///   [3]=40: 素材3個（活二/閉三の素材）OPEN_TWO=50 と同程度
///   [4]=60: 素材4個（活三になる手前）OPEN_THREE=1000 と十分差
///   [5]=0:  既存パターンが完全に拾うので0（sentinel）
pub var LINE_POTENTIAL_TABLE = [_]i32{ 0, 3, 12, 40, 60, 0 };

// ============================================================================
// 実行時 eval 重み注入（bench 専用）
//
// 形系重みを `var` 化し、wasm 起動後に setEvalParam で注入できるようにする。
// これにより重みごとのリビルドなしに A/B Elo を測れる（weight-bench）。
// 既定値は下記スナップショットで保持し resetEvalParams() で復元する。
//
// param-id の正準表はここ（Zig）と `scripts/lib/evalParams.ts`（TS）の2箇所に
// 現れるが、**手動の双方向コメント同期は禁止**。ドリフトは
// 「resetEvalParams() 後に全 id の getEvalParam が*それぞれ固有の*既定値に
// 一致するか」で機械検出する（既定値は全 id で相異なる）。
// ============================================================================

const OPEN_THREE_DEFAULT: i32 = 1000;
const THREE_DEFAULT: i32 = 30;
const OPEN_TWO_DEFAULT: i32 = 50;
const TWO_DEFAULT: i32 = 10;
const CENTER_BONUS_DEFAULT: i32 = 0;
const LINE_POTENTIAL_TABLE_DEFAULT = [_]i32{ 0, 3, 12, 40, 60, 0 };

/// eval 重みパラメータ id（数値は scripts/lib/evalParams.ts と一致させる）。
/// LINE_POTENTIAL_TABLE は素材数 1..4 のエントリを個別 id に割当
/// （[0]/[5] は sentinel=0 で対象外）。
pub const EvalParamId = enum(u32) {
    open_three = 0,
    three = 1,
    open_two = 2,
    two = 3,
    center_bonus = 4,
    line_potential_1 = 5,
    line_potential_2 = 6,
    line_potential_3 = 7,
    line_potential_4 = 8,
};

/// 不明な id に対する getEvalParam の返却値（テストで検出可能なsentinel）。
pub const EVAL_PARAM_UNKNOWN: i32 = std.math.minInt(i32);

/// 全形系重みを既定値へ復元する。
/// wasm ロード直後（baseline 含む）に必ず1回呼び、クリーンな既定から始める。
pub fn resetEvalParams() void {
    OPEN_THREE = OPEN_THREE_DEFAULT;
    THREE = THREE_DEFAULT;
    OPEN_TWO = OPEN_TWO_DEFAULT;
    TWO = TWO_DEFAULT;
    CENTER_BONUS = CENTER_BONUS_DEFAULT;
    LINE_POTENTIAL_TABLE = LINE_POTENTIAL_TABLE_DEFAULT;
}

/// id の重みに value を設定する。不明な id は無視。
pub fn setEvalParam(id: u32, value: i32) void {
    const pid = std.meta.intToEnum(EvalParamId, id) catch return;
    switch (pid) {
        .open_three => OPEN_THREE = value,
        .three => THREE = value,
        .open_two => OPEN_TWO = value,
        .two => TWO = value,
        .center_bonus => CENTER_BONUS = value,
        .line_potential_1 => LINE_POTENTIAL_TABLE[1] = value,
        .line_potential_2 => LINE_POTENTIAL_TABLE[2] = value,
        .line_potential_3 => LINE_POTENTIAL_TABLE[3] = value,
        .line_potential_4 => LINE_POTENTIAL_TABLE[4] = value,
    }
}

/// id の現在の重みを返す。不明な id は EVAL_PARAM_UNKNOWN。
pub fn getEvalParam(id: u32) i32 {
    const pid = std.meta.intToEnum(EvalParamId, id) catch return EVAL_PARAM_UNKNOWN;
    return switch (pid) {
        .open_three => OPEN_THREE,
        .three => THREE,
        .open_two => OPEN_TWO,
        .two => TWO,
        .center_bonus => CENTER_BONUS,
        .line_potential_1 => LINE_POTENTIAL_TABLE[1],
        .line_potential_2 => LINE_POTENTIAL_TABLE[2],
        .line_potential_3 => LINE_POTENTIAL_TABLE[3],
        .line_potential_4 => LINE_POTENTIAL_TABLE[4],
    };
}

/// id の正準名（null 終端）。TS 期待名との照合用（任意の追加ドリフト検出）。
pub fn getEvalParamName(id: u32) [*:0]const u8 {
    const pid = std.meta.intToEnum(EvalParamId, id) catch return "";
    return switch (pid) {
        .open_three => "OPEN_THREE",
        .three => "THREE",
        .open_two => "OPEN_TWO",
        .two => "TWO",
        .center_bonus => "CENTER_BONUS",
        .line_potential_1 => "LINE_POTENTIAL_1",
        .line_potential_2 => "LINE_POTENTIAL_2",
        .line_potential_3 => "LINE_POTENTIAL_3",
        .line_potential_4 => "LINE_POTENTIAL_4",
    };
}

const PARAM_COUNT: u32 = @typeInfo(EvalParamId).@"enum".fields.len;

test "resetEvalParams 後は全 id が固有の既定値に一致（id 取り違え検出）" {
    // まず全 id を別の値で汚す
    var id: u32 = 0;
    while (id < PARAM_COUNT) : (id += 1) {
        setEvalParam(id, 7777);
    }
    resetEvalParams();

    const expected = [_]i32{ 1000, 30, 50, 10, 0, 3, 12, 40, 60 };
    // 既定値は全て相異なる（id↔ターゲットの対応ズレを検出できる前提）
    id = 0;
    while (id < PARAM_COUNT) : (id += 1) {
        try std.testing.expectEqual(expected[id], getEvalParam(id));
    }
}

test "setEvalParam→getEvalParam 往復" {
    resetEvalParams();
    var id: u32 = 0;
    while (id < PARAM_COUNT) : (id += 1) {
        const v: i32 = @as(i32, @intCast(id)) * 100 + 1;
        setEvalParam(id, v);
        try std.testing.expectEqual(v, getEvalParam(id));
    }
    resetEvalParams();
}

test "不明な id は無視 / sentinel" {
    resetEvalParams();
    try std.testing.expectEqual(EVAL_PARAM_UNKNOWN, getEvalParam(PARAM_COUNT));
    setEvalParam(PARAM_COUNT, 12345); // 無視されてクラッシュしない
    // 既存 id は無傷
    try std.testing.expectEqual(@as(i32, 1000), getEvalParam(@intFromEnum(EvalParamId.open_three)));
}

test "LINE_POTENTIAL_TABLE の注入は配列に反映され sentinel は不変" {
    resetEvalParams();
    setEvalParam(@intFromEnum(EvalParamId.line_potential_3), 999);
    try std.testing.expectEqual(@as(i32, 999), LINE_POTENTIAL_TABLE[3]);
    // sentinel [0]/[5] は対象外で 0 のまま
    try std.testing.expectEqual(@as(i32, 0), LINE_POTENTIAL_TABLE[0]);
    try std.testing.expectEqual(@as(i32, 0), LINE_POTENTIAL_TABLE[5]);
    resetEvalParams();
    try std.testing.expectEqual(@as(i32, 40), LINE_POTENTIAL_TABLE[3]);
}
