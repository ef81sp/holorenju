/**
 * Elo レーティング計算ロジック
 *
 * CPUの強さを定量的に評価するための Elo レーティングシステム
 */

/**
 * プレイヤーのレーティング情報
 */
export interface EloRating {
  /** 現在のレーティング */
  rating: number;
  /** 対局数 */
  games: number;
  /** 勝利数 */
  wins: number;
  /** 敗北数 */
  losses: number;
  /** 引き分け数 */
  draws: number;
}

/**
 * 対局結果
 */
export type GameOutcome = "win" | "loss" | "draw";

/**
 * レーティング更新設定
 */
export interface RatingConfig {
  /** K係数（変動幅、デフォルト: 32） */
  kFactor: number;
}

const DEFAULT_CONFIG: RatingConfig = {
  kFactor: 32,
};

/**
 * 期待勝率を計算
 *
 * @param ratingA プレイヤーAのレーティング
 * @param ratingB プレイヤーBのレーティング
 * @returns プレイヤーAの期待勝率（0-1）
 */
export function calculateExpectedScore(
  ratingA: number,
  ratingB: number,
): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * 新しいレーティングを計算
 *
 * @param currentRating 現在のレーティング
 * @param expectedScore 期待スコア
 * @param actualScore 実際のスコア（勝利=1, 引き分け=0.5, 敗北=0）
 * @param kFactor K係数
 * @returns 新しいレーティング
 */
export function updateRating(
  currentRating: number,
  expectedScore: number,
  actualScore: number,
  kFactor: number,
): number {
  return currentRating + kFactor * (actualScore - expectedScore);
}

/**
 * 初期レーティングを作成
 *
 * @param initialRating 初期レーティング値（デフォルト: 1500）
 * @returns 新しいEloRating
 */
export function createInitialRating(initialRating = 1500): EloRating {
  return {
    rating: initialRating,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

/**
 * 対局結果を実際のスコアに変換
 *
 * @param outcome 対局結果
 * @returns スコア（勝利=1, 引き分け=0.5, 敗北=0）
 */
function outcomeToScore(outcome: GameOutcome): number {
  switch (outcome) {
    case "win":
      return 1;
    case "draw":
      return 0.5;
    case "loss":
      return 0;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/**
 * 対局結果の反転
 *
 * @param outcome 対局結果
 * @returns 反転した結果
 */
function invertOutcome(outcome: GameOutcome): GameOutcome {
  switch (outcome) {
    case "win":
      return "loss";
    case "loss":
      return "win";
    case "draw":
      return "draw";
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/**
 * 両プレイヤーのレーティングを更新
 *
 * @param ratingA プレイヤーAの現在のレーティング
 * @param ratingB プレイヤーBの現在のレーティング
 * @param outcomeA プレイヤーAから見た対局結果
 * @param config レーティング設定
 * @returns 更新後の両レーティング
 */
export function updateRatings(
  ratingA: EloRating,
  ratingB: EloRating,
  outcomeA: GameOutcome,
  config: RatingConfig = DEFAULT_CONFIG,
): { ratingA: EloRating; ratingB: EloRating } {
  const expectedA = calculateExpectedScore(ratingA.rating, ratingB.rating);
  const expectedB = 1 - expectedA;

  const actualA = outcomeToScore(outcomeA);
  const actualB = 1 - actualA;

  const outcomeB = invertOutcome(outcomeA);

  const newRatingA = updateRating(
    ratingA.rating,
    expectedA,
    actualA,
    config.kFactor,
  );
  const newRatingB = updateRating(
    ratingB.rating,
    expectedB,
    actualB,
    config.kFactor,
  );

  return {
    ratingA: {
      rating: newRatingA,
      games: ratingA.games + 1,
      wins: ratingA.wins + (outcomeA === "win" ? 1 : 0),
      losses: ratingA.losses + (outcomeA === "loss" ? 1 : 0),
      draws: ratingA.draws + (outcomeA === "draw" ? 1 : 0),
    },
    ratingB: {
      rating: newRatingB,
      games: ratingB.games + 1,
      wins: ratingB.wins + (outcomeB === "win" ? 1 : 0),
      losses: ratingB.losses + (outcomeB === "loss" ? 1 : 0),
      draws: ratingB.draws + (outcomeB === "draw" ? 1 : 0),
    },
  };
}

/**
 * レーティングの概要を表示用文字列で取得
 *
 * @param rating レーティング情報
 * @returns 表示用文字列
 */
export function formatRating(rating: EloRating): string {
  const winRate =
    rating.games > 0 ? ((rating.wins / rating.games) * 100).toFixed(1) : "0.0";
  return `${Math.round(rating.rating)} (${rating.wins}W-${rating.losses}L-${rating.draws}D, ${winRate}%)`;
}
