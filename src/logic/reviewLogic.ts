/**
 * 振り返り評価ロジック
 *
 * スコア差に基づく手の品質分類と精度計算
 */

import type { Position, StoneColor } from "@/types/game";
import type {
  EvaluatedMove,
  ForcedWinBranch,
  FullEvalResult,
  GameReview,
  LightEvalResult,
  LosingMoveInfo,
  MoveQuality,
  ReviewCandidate,
  VCTCheckResult,
} from "@/types/review";

import { parseGameRecord, parseMove } from "@/logic/gameRecordParser";

/** 追詰を許す候補手に付与するペナルティスコア */
const FORCED_LOSS_PENALTY_SCORE = -100_000;

/** 珠型（開局）の手数。評価対象外 */
export const OPENING_MOVES = 3;

/**
 * 開局手かどうかを判定
 */
export function isOpeningMove(moveIndex: number): boolean {
  return moveIndex < OPENING_MOVES;
}

/**
 * スコア差に基づく品質分類
 */
export function classifyMoveQuality(scoreDiff: number): MoveQuality {
  const absDiff = Math.abs(scoreDiff);
  if (absDiff === 0) {
    return "excellent";
  }
  if (absDiff <= 80) {
    return "good";
  }
  if (absDiff <= 300) {
    return "inaccuracy";
  }
  if (absDiff <= 1000) {
    return "mistake";
  }
  return "blunder";
}

/**
 * Worker結果から評価済みの手を構築
 *
 * FullEvalResult または LightEvalResult を受け付ける。
 * VCTCheckResult は applyVCTResult で既存の EvaluatedMove にマージする。
 *
 * @param parsedMoves パース済み手順配列（省略時はmoveHistoryからパース）
 * @param analyzeAll 全手分析モード（全手をisPlayerMove: trueに）
 */
export function buildEvaluatedMove(
  result: FullEvalResult | LightEvalResult,
  moveHistoryOrMoves: string | { position: Position; color: StoneColor }[],
  playerFirst: boolean,
  analyzeAll?: boolean,
): EvaluatedMove {
  const moves =
    typeof moveHistoryOrMoves === "string"
      ? parseGameRecord(moveHistoryOrMoves)
      : moveHistoryOrMoves;
  const move = moves[result.moveIndex];
  const isPlayerMove =
    analyzeAll ||
    (playerFirst ? result.moveIndex % 2 === 0 : result.moveIndex % 2 === 1);

  if (result.mode === "lightEval") {
    return {
      moveIndex: result.moveIndex,
      position: move?.position ?? { row: 7, col: 7 },
      isPlayerMove,
      quality: "excellent",
      playedScore: 0,
      bestScore: 0,
      scoreDiff: 0,
      bestMove: result.bestMove,
      candidates: [],
      forcedWinType: result.forcedWinType,
      isLightEval: true,
    };
  }

  const { candidates } = result;
  const { bestScore, bestMove } = adjustCandidatesForForcedLoss(
    candidates,
    result.bestScore,
    result.bestMove,
  );

  const scoreDiff = bestScore - result.playedScore;

  let quality = classifyMoveQuality(scoreDiff);
  if (quality === "excellent" && result.missedDoubleMise?.length) {
    quality = "good";
  }
  // forcedLossType が付いている場合、品質を blunder に下げる
  // （追詰を許した手は評価値の差に関係なく悪手）
  if (
    result.forcedLossType &&
    (quality === "excellent" || quality === "good")
  ) {
    quality = "blunder";
  }

  return {
    moveIndex: result.moveIndex,
    position: move?.position ?? { row: 7, col: 7 },
    isPlayerMove,
    quality,
    playedScore: result.playedScore,
    bestScore,
    scoreDiff,
    bestMove,
    candidates,
    completedDepth: result.completedDepth,
    forcedWinType: result.forcedWinType,
    forcedWinBranches: result.forcedWinBranches,
    forcedLossType: result.forcedLossType,
    forcedLossSequence: result.forcedLossSequence,
    forcedLossBranches: result.forcedLossBranches,
    missedDoubleMise: result.missedDoubleMise,
    doubleMiseTargets: result.doubleMiseTargets,
  };
}

/**
 * VCTチェック結果を既存の EvaluatedMove にマージする
 */
export function applyVCTResult(
  existing: EvaluatedMove,
  result: VCTCheckResult,
): EvaluatedMove {
  if (!result.forcedLossType) {
    return existing;
  }
  return {
    ...existing,
    forcedLossType: result.forcedLossType,
    forcedLossSequence: result.forcedLossSequence,
  };
}

/**
 * 全手の評価結果から対局全体の評価を構築
 */
export function buildGameReview(evaluatedMoves: EvaluatedMove[]): GameReview {
  const playerMoves = evaluatedMoves.filter((m) => m.isPlayerMove);

  // 精度計算: excellentとgoodの割合
  const goodOrBetter = playerMoves.filter(
    (m) => m.quality === "excellent" || m.quality === "good",
  ).length;
  const accuracy =
    playerMoves.length > 0
      ? Math.round((goodOrBetter / playerMoves.length) * 100)
      : 100;

  // クリティカルエラー数
  const criticalErrors = playerMoves.filter(
    (m) => m.quality === "mistake" || m.quality === "blunder",
  ).length;

  return {
    evaluatedMoves,
    accuracy,
    criticalErrors,
    losingMove: findLosingMove(evaluatedMoves),
  };
}

/**
 * 敗着を推定する
 *
 * 被追詰の手を古い順に探し、そこから遡及する。
 * 被追詰の判定: forcedLossType が設定されている、または全候補が opponentForcedWin。
 * 全候補が負けなら前の手を確認し、生存候補がある手を敗着と判定する。
 *
 * 「この手で追詰を許した。別の手に打てば助かったのに」が敗着の定義。
 */
export function findLosingMove(
  evaluatedMoves: EvaluatedMove[],
): LosingMoveInfo | undefined {
  // プレイヤーの手を moveIndex 昇順で抽出
  const playerMoves = evaluatedMoves
    .filter((m) => m.isPlayerMove)
    .sort((a, b) => a.moveIndex - b.moveIndex);

  // 被追詰の最も古いプレイヤーの手を見つける
  // forcedLossType 設定済み、または全候補が opponentForcedWin
  const firstLossIdx = playerMoves.findIndex(
    (m) => m.forcedLossType || allCandidatesLose(m),
  );
  if (firstLossIdx === -1) {
    return undefined;
  }

  // そこから遡及: 全候補が負け → 前の手が敗着
  for (let i = firstLossIdx; i >= 0; i--) {
    const move = playerMoves[i]!;
    if (!allCandidatesLose(move)) {
      // 生存する候補がある → この手が敗着（別の手に打てば助かった）
      return { moveIndex: move.moveIndex };
    }
    // 全候補負け → さらに前の手を確認
  }

  // 全手で全候補が負け → 最も古い手が敗着
  return { moveIndex: playerMoves[0]!.moveIndex };
}

/**
 * 全候補手が opponentForcedWin を持つか（＝どの良い手も負け）
 *
 * verifyCandidates は安全な手を見つけたら即 break するため、
 * 全候補に opponentForcedWin が付いている = 全候補チェック済み = 全部負け。
 * 候補が空の場合は判定不能として false を返す。
 */
export function allCandidatesLose(move: EvaluatedMove): boolean {
  if (move.candidates.length === 0) {
    return false;
  }
  return move.candidates.every((c) => c.opponentForcedWin !== undefined);
}

/**
 * 追詰を許す候補手のスコアを引き下げ、安全な候補で bestScore/bestMove を再計算
 *
 * opponentForcedWin が付いた候補は FORCED_LOSS_PENALTY_SCORE に引き下げ、
 * スコア順にソートし直す。先頭の安全な候補を bestMove/bestScore にする。
 */
export function adjustCandidatesForForcedLoss(
  candidates: ReviewCandidate[],
  originalBestScore: number,
  originalBestMove: Position,
): { bestScore: number; bestMove: Position } {
  if (candidates.length === 0 || !candidates.some((c) => c.opponentForcedWin)) {
    return { bestScore: originalBestScore, bestMove: originalBestMove };
  }

  for (const c of candidates) {
    if (c.opponentForcedWin) {
      c.searchScore = Math.min(c.searchScore, FORCED_LOSS_PENALTY_SCORE);
    }
  }
  candidates.sort((a, b) => b.searchScore - a.searchScore);

  const [topCand] = candidates;
  if (topCand && !topCand.opponentForcedWin) {
    return { bestScore: topCand.searchScore, bestMove: topCand.position };
  }
  return { bestScore: originalBestScore, bestMove: originalBestMove };
}

/**
 * 遡及チェック用: 前の手への forcedLossSequence を構築
 *
 * 中間の実戦手（脅威手 + 防御手）+ 元の forcedLossSequence を結合。
 */
export function buildBacktrackSequence(
  moves: string[],
  prevMoveIndex: number,
  currentMoveIndex: number,
  currentSequence: Position[] | undefined,
): Position[] {
  const intermediate = moves
    .slice(prevMoveIndex + 1, currentMoveIndex + 1)
    .map(parseMove);
  return [...intermediate, ...(currentSequence ?? [])];
}

/**
 * 遡及チェック用: 前の手への分岐情報を構築
 *
 * 各候補の防御手 + VCT 手順を分岐として収集。
 * 実戦手と同じ位置の候補はメインラインに含まれるためスキップ。
 */
export function buildBacktrackBranches(
  moves: string[],
  prevMoveIndex: number,
  currentMoveIndex: number,
  candidates: ReviewCandidate[],
): ForcedWinBranch[] {
  const threatMoves = moves
    .slice(prevMoveIndex + 1, currentMoveIndex)
    .map(parseMove);
  const actualDefense = parseMove(moves[currentMoveIndex]!);

  const branches: ForcedWinBranch[] = [];
  for (const c of candidates) {
    if (
      !c.opponentForcedWinSequence ||
      (c.position.row === actualDefense.row &&
        c.position.col === actualDefense.col)
    ) {
      continue;
    }
    branches.push({
      defenseIndex: threatMoves.length,
      defenseMove: c.position,
      continuation: c.opponentForcedWinSequence,
    });
  }
  return branches;
}

/**
 * 品質に対応する色を取得
 */
export function getQualityColor(quality: MoveQuality): string {
  switch (quality) {
    case "excellent":
      return "#00bcd4";
    case "good":
      return "#4caf50";
    case "inaccuracy":
      return "#ff9800";
    case "mistake":
      return "#f44336";
    case "blunder":
      return "#f44336";
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

/**
 * 品質に対応するラベルを取得
 */
export function getQualityLabel(quality: MoveQuality): string {
  switch (quality) {
    case "excellent":
      return "最善手";
    case "good":
      return "好手";
    case "inaccuracy":
      return "疑問手";
    case "mistake":
      return "悪手";
    case "blunder":
      return "悪手";
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}
