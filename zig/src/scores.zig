/// パターンスコア定数（patternScores.ts の PATTERN_SCORES と同値）
pub const FIVE: i32 = 100000;
pub const OPEN_FOUR: i32 = 10000;
pub const FOUR: i32 = 1500;
pub const OPEN_THREE: i32 = 1000;
pub const THREE: i32 = 30;
pub const OPEN_TWO: i32 = 50;
pub const TWO: i32 = 10;
pub const CENTER_BONUS: i32 = 5;

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
