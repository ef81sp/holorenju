/// 探索全体の「絶対デッドライン」を保持するグローバル（issue #147）
///
/// ## なぜグローバルか
///
/// `absolute_time_limit` は元々 `SearchContext.absolute_deadline` としてメイン探索と
/// quiescence だけが見ていた。ところが VCF/VCT/ミセ探索は独自の `TimeLimiter` で回り、
/// しかも `findVCFSequence` / `findVCTSequence` のエントリで `start_time` をリセットする
/// ため、「入れ子ごとに予算が復活する」「時計を見る場所に到達しない長い区間がある」という
/// 二つの穴があった（#128 のダンプ g3 で 1 手 29.6s / 31.8s）。
///
/// 個別の limiter に親の残り時間を継承させる案（設計メモの B）は探索の中身が変わるため
/// Elo 検証が要る。本モジュールは **探索の中身を変えずに天井だけを保証する**：
/// 対局の `findBestMove`（= `search.findBestMoveIterative`）の入口で絶対デッドラインを
/// ここに立て、出口で必ず 0 に戻す。`TimeLimiter.exceeded()` は自前の予算に加えて
/// このデッドラインも見るので、将来 VCT に新しい再帰が増えても自動的に守られる。
///
/// ## 値の SSoT
///
/// `search.findBestMoveIterative` が計算した `absolute_deadline` を
/// `ctx.absolute_deadline`（メイン探索・quiescence が参照）と本グローバル
/// （`TimeLimiter` が参照）の両方に配る。計算箇所は 1 つなので二重管理にならない。
///
/// ## 無効化
///
/// `0` = 無効。`no_time_limit`（計測モード・振り返りの無制限探索）では 0 のままにする。
/// 振り返りの `findVCTSequence` などの直接呼び出しは `findBestMoveIterative` を通らない
/// ので、グローバルは 0 のまま＝挙動不変。
const builtin = @import("builtin");

/// 絶対デッドライン（`getTimestampMsExternal` と同じ時間軸の ms）。0 = 無効。
pub var g_absolute_deadline_ms: u32 = 0;

/// ネイティブテスト用の擬似時計（wasm では未使用）。0 = 時間制限を評価しない。
pub var test_now_ms: u32 = 0;

/// 擬似時計の自動進行幅（ms）。`nowMs()` が呼ばれるたびに `test_now_ms` へ加算する
/// （wasm では未使用）。0 = 進まない（従来どおりの固定時計）。
///
/// 決定的モードのテストで「時計をどれだけ進めても結果が変わらない」ことを示すために
/// 使う（step=0 と step=1000 で完全一致）。時間モードのテストでは「時計読みの回数」で
/// 予算が尽きる有界な擬似時計として使える。開始値 `test_now_ms` は非 0 にすること
/// （0 は「時計なし」の意味を持つ）。
pub var test_clock_step: u32 = 0;

extern fn getTimestampMsExternal() u32;

/// 壁時計（ms）。ネイティブ（テスト）では `test_now_ms` を返す
/// （`test_clock_step > 0` なら読み出しごとに進める）。
pub fn nowMs() u32 {
    if (builtin.cpu.arch == .wasm32) {
        return getTimestampMsExternal();
    }
    const now = test_now_ms;
    test_now_ms +|= test_clock_step;
    return now;
}

/// 絶対デッドラインを立てる（0 を渡すと無効）
pub fn set(deadline_ms: u32) void {
    g_absolute_deadline_ms = deadline_ms;
}

/// 絶対デッドラインを解除する
pub fn clear() void {
    g_absolute_deadline_ms = 0;
}

/// 与えられた現在時刻が絶対デッドラインを超えているか
///
/// 時刻を引数で受けるのは、呼び出し側が既に取得済みの時刻を使い回して
/// **時刻取得の頻度を増やさない**ため（NPS への影響を避ける）。
/// `now == 0` はネイティブテスト（時計なし）を意味し、常に false。
pub fn exceededAt(now: u32) bool {
    const d = g_absolute_deadline_ms;
    if (d == 0) return false;
    if (now == 0) return false;
    if (now >= d) {
        g_hit = true;
        return true;
    }
    return false;
}

/// 直近の `resetHit()` 以降に絶対デッドラインが発火したか（stats の `absolute_deadline_hit` 用）
pub var g_hit: bool = false;

/// 発火フラグをリセットする（`findBestMoveIterative` の入口で呼ぶ）
pub fn resetHit() void {
    g_hit = false;
}

/// 直近の `resetHit()` 以降に絶対デッドラインが発火したか
pub fn hitSinceReset() bool {
    return g_hit;
}

/// 現在時刻を取得して判定する版（時刻を持っていない呼び出し側用）
pub fn exceeded() bool {
    if (g_absolute_deadline_ms == 0) return false;
    return exceededAt(nowMs());
}

// === Tests ===

const testing = @import("std").testing;

test "デフォルトは無効" {
    clear();
    try testing.expect(!exceeded());
    try testing.expect(!exceededAt(999_999));
}

test "デッドラインを過ぎていれば true" {
    set(1000);
    defer clear();
    try testing.expect(exceededAt(1000));
    try testing.expect(exceededAt(5000));
    try testing.expect(!exceededAt(999));
}

test "now == 0（ネイティブの時計なし）は常に false" {
    set(1);
    defer clear();
    try testing.expect(!exceededAt(0));
}

test "test_clock_step: nowMs を呼ぶたびに擬似時計が進む" {
    test_now_ms = 100;
    test_clock_step = 7;
    defer {
        test_now_ms = 0;
        test_clock_step = 0;
    }
    try testing.expectEqual(@as(u32, 100), nowMs());
    try testing.expectEqual(@as(u32, 107), nowMs());
    try testing.expectEqual(@as(u32, 114), test_now_ms);
}

test "test_clock_step = 0 では擬似時計は固定" {
    test_now_ms = 100;
    defer test_now_ms = 0;
    try testing.expectEqual(@as(u32, 100), nowMs());
    try testing.expectEqual(@as(u32, 100), nowMs());
}

test "hitSinceReset: 発火で立ち、resetHit で戻る" {
    set(1000);
    defer clear();
    resetHit();
    try testing.expect(!hitSinceReset());
    try testing.expect(!exceededAt(999));
    try testing.expect(!hitSinceReset());
    try testing.expect(exceededAt(1000));
    try testing.expect(hitSinceReset());
    resetHit();
    try testing.expect(!hitSinceReset());
}

test "clear で無効に戻る" {
    set(1);
    clear();
    try testing.expect(!exceededAt(5000));
}
