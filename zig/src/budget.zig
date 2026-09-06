/// 探索予算のポリシー（決定的モード / 時間モード）の SSoT
///
/// 設計メモ: docs/plans/bench-fixed-nodes-2026-09-06.md §2.1
///
/// ## 決定的モード（`deterministic_mode`）
///
/// 探索結果が (盤面, パラメータ) だけで決まり、壁時計・マシン負荷に依存しないモード。
/// ベンチで (a) 負荷ノイズの排除、(b) jobs をコア数まで上げても結果が歪まない、
/// (c) 同一入力で棋譜・1 手ごとのノード数・スコアが完全一致、を得るために使う。
///
/// - `time_limit` は 0 として扱う（`no_time_limit` と同じくメイン探索・quiescence・
///   反復深化ループの時計読みをスキップ）。
/// - これまで**時間だけ**で縛っていた子探索（事前探索の VCF/VCT、非生産的四の降格判定の
///   VCF、脅威プローブの VCT）を**ノード予算**に置き換える。
/// - 事前探索・脅威プローブの消費ノードを `stats.nodes` に計上し、`max_nodes` が
///   探索の総仕事量の上限になるようにする（時間モードでは計上しない＝製品挙動不変）。
///
/// 製品経路（対戦・振り返り）はフラグ既定 false でビット単位不変。
/// `time_limit == 0` の既存意味（`no_time_limit`: 事前探索 600ms 壁時計・プローブ無制限）
/// は変更しない。
///
/// ## 決定的モードの事前探索の上限式
///
/// `TimeLimiter.child` は own ノード予算と親の残りの min を**取らない**（ノード予算は
/// `charge()` で親へ払い戻す設計で、二重に絞ると振り返り経路の探索が変わるため）。
/// 親予算（`pre_search_nodes`）は段の境目と、ミセ VCF の候補ループ先頭で見る。したがって
/// 事前探索の消費ノード合計の上限は
///
///   親 `pre_search_nodes` + 最後に走った段の own 予算
///
/// で、段ごとの own 予算は VCF = `pre_vcf_nodes`、相手 VCF = `pre_opp_vcf_nodes`、
/// VCT = `pre_vct_nodes`、ミセ VCF = 候補 1 件分（ノリ手 `NORI_TE_VCF_NODES` × 三の受け数 +
/// `MISE_VCF_NODES` × ターゲット数）。既定値（親 40k）では最悪 40k + 20k（VCT）程度。
/// 各段は `hasVCF` の同一階層ループ内で bump が続くため、own 予算を数ノード超過しうる。
/// 脅威プローブも同様に、探索後の一括 charge なので `max_nodes` を最大 `probe_vct_nodes`
/// 分だけ超過しうる（決定性には無害。設計メモ §2.3）。
///
/// ## 予算定数の置き場
///
/// 各予算定数は対応する**時間定数と同じファイル・隣接**に置く（較正で片方だけ直す事故を
/// 防ぐ）。本モジュールはそれらを一表（`BudgetPolicy`）にまとめるだけ。
const search = @import("search.zig");
const vcf = @import("vcf.zig");
const vct = @import("vct.zig");
const minimax = @import("minimax.zig");

/// 決定的モードのグローバルトグル（`main.zig` の `setDeterministicMode` から設定）。
/// 既定 false ＝ 従来の時間モード。
pub var deterministic_mode: bool = false;

/// `getSearchFeatures()` のビット。TS 側リーダーはこのビットで wasm の対応状況を判定する。
/// bit0: 決定的モード対応（`setDeterministicMode` あり）
pub const FEATURE_DETERMINISTIC_MODE: u32 = 1 << 0;
/// bit1: stats バッファ拡張あり（`pre_search_nodes` / `probe_nodes` / `absolute_deadline_hit`、
/// 60 バイト。旧 wasm は 48 バイト）
pub const FEATURE_EXTENDED_STATS: u32 = 1 << 1;

/// この wasm が持つ探索機能のビット集合
pub fn searchFeatures() u32 {
    return FEATURE_DETERMINISTIC_MODE | FEATURE_EXTENDED_STATS;
}

/// 探索 1 回分の予算ポリシー
///
/// `findBestMoveIterative` の入口で `derive()` により**一度だけ**導出し、
/// `findPreSearchMove` と `SearchContext` に渡す（bool の並立を増やさない）。
/// ノード予算の 0 は「ノード制限なし（時間のみ）」を意味する。
pub const BudgetPolicy = struct {
    /// = `deterministic_mode`（true なら time_limit は 0 として扱う）
    deterministic: bool,
    /// 事前探索全体（親 limiter）のノード予算。時間モードは 0（600ms 壁時計のみ）
    pre_search_nodes: u32,
    /// 事前探索 自分の VCF（時間モードは 0＝時間のみ）
    pre_vcf_nodes: u32,
    /// 事前探索 相手 VCF（両モードとも既存の 3000）
    pre_opp_vcf_nodes: u32,
    /// 事前探索 VCT（時間モードは 0＝時間のみ）
    pre_vct_nodes: u32,
    /// 非生産的四の降格判定 VCF（時間モードは 0＝50ms のみ）
    demote_vcf_nodes: u32,
    /// 脅威プローブ VCT（時間モードは 0＝50ms のみ）
    probe_vct_nodes: u32,

    /// 時間モード（従来挙動）
    pub const TIME_MODE = BudgetPolicy{
        .deterministic = false,
        .pre_search_nodes = 0,
        .pre_vcf_nodes = 0,
        .pre_opp_vcf_nodes = vcf.VCF_PRE_OPPONENT_NODES,
        .pre_vct_nodes = 0,
        .demote_vcf_nodes = 0,
        .probe_vct_nodes = 0,
    };

    /// 決定的モード
    pub const DETERMINISTIC = BudgetPolicy{
        .deterministic = true,
        .pre_search_nodes = search.PRE_SEARCH_NODE_BUDGET_DETERMINISTIC,
        .pre_vcf_nodes = vcf.VCF_PRE_NODES_DETERMINISTIC,
        .pre_opp_vcf_nodes = vcf.VCF_PRE_OPPONENT_NODES,
        .pre_vct_nodes = vct.VCT_PRE_NODES_DETERMINISTIC,
        .demote_vcf_nodes = search.PLAIN_FOUR_VCF_CHECK_NODES_DETERMINISTIC,
        .probe_vct_nodes = minimax.PROBE_VCT_NODES_DETERMINISTIC,
    };

    /// グローバルトグルから導出する
    pub fn derive() BudgetPolicy {
        return if (deterministic_mode) DETERMINISTIC else TIME_MODE;
    }
};

// === Tests ===

const testing = @import("std").testing;

test "searchFeatures: bit0（決定的モード）と bit1（stats 拡張）が立つ" {
    const f = searchFeatures();
    try testing.expect((f & FEATURE_DETERMINISTIC_MODE) != 0);
    try testing.expect((f & FEATURE_EXTENDED_STATS) != 0);
    try testing.expectEqual(@as(u32, 3), f);
}

test "BudgetPolicy.derive: 既定は時間モード、トグルで決定的モード" {
    try testing.expect(!deterministic_mode);
    try testing.expect(!BudgetPolicy.derive().deterministic);
    try testing.expectEqual(@as(u32, 0), BudgetPolicy.derive().pre_vct_nodes);

    deterministic_mode = true;
    defer deterministic_mode = false;
    const p = BudgetPolicy.derive();
    try testing.expect(p.deterministic);
    try testing.expect(p.pre_search_nodes > 0);
    try testing.expect(p.pre_vcf_nodes > 0);
    try testing.expect(p.pre_vct_nodes > 0);
    try testing.expect(p.demote_vcf_nodes > 0);
    try testing.expect(p.probe_vct_nodes > 0);
}

test "時間モードの相手 VCF ノード予算は従来の 3000" {
    try testing.expectEqual(@as(u32, 3000), BudgetPolicy.TIME_MODE.pre_opp_vcf_nodes);
}
