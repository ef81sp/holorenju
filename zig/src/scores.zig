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
