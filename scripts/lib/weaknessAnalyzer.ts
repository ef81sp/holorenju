/**
 * 弱点パターン分析ロジック
 *
 * ベンチマーク対局結果から弱点パターンを自動検出する。
 * 盤面の再構築は gameAnalyzer.ts の analyzeMove パターンを踏襲。
 */

import type {
  GameResult,
  MoveRecord,
} from "../../src/logic/cpu/benchmark/headless.ts";
import type { BoardState, Position } from "../../src/types/game.ts";
import type { BenchmarkResultFile } from "../types/analysis.ts";
import type {
  AdvantageSquanderedWeakness,
  BlunderWeakness,
  DepthDisagreementWeakness,
  ForbiddenVulnerabilityWeakness,
  ImprovementSuggestion,
  MissedVcfWeakness,
  TimePressureErrorWeakness,
  WeaknessInstance,
  WeaknessPatternSummary,
  WeaknessReport,
  WeaknessType,
} from "../types/weakness.ts";

import { applyMove } from "../../src/logic/cpu/core/boardUtils.ts";
import { detectOpponentThreats } from "../../src/logic/cpu/evaluation/threatDetection.ts";
import { findVCFSequence } from "../../src/logic/cpu/search/vcf.ts";
import { createEmptyBoard } from "../../src/logic/renjuRules.ts";

// ============================================================================
// 定数
// ============================================================================

/** blunder 判定の最小スコア差（FOUR=1500 で四の獲得/喪失が3000点差を生むため引き上げ） */
const BLUNDER_THRESHOLD = 3000;

/** advantage-squandered のスコア閾値 */
const ADVANTAGE_THRESHOLD = 3000;

/** VCF再探索の時間制限（分析用なので長め） */
const VCF_ANALYSIS_TIME_LIMIT = 500;

/**
 * 敗者の色を正しく算出する
 *
 * headless.ts の runMultipleGames は先手/後手を交互に入れ替え、
 * isABlack=false の場合 winner を反転して記録する。
 * そのため winner="A" は必ずしも黒の勝利を意味しない。
 */
function getLoserColor(game: GameResult): "black" | "white" {
  const winnerIsBlack = (game.winner === "A") === game.isABlack;
  return winnerIsBlack ? "white" : "black";
}

// ============================================================================
// ベンチマークファイル分析
// ============================================================================

/**
 * ベンチマーク結果ファイルを分析して弱点レポートを生成
 */
export function analyzeWeaknesses(
  benchResult: BenchmarkResultFile,
  sourceFile: string,
): WeaknessReport {
  const weaknesses: WeaknessInstance[] = [];

  for (let gi = 0; gi < benchResult.games.length; gi++) {
    const game = benchResult.games[gi];
    if (!game) {
      continue;
    }

    const gameWeaknesses = analyzeGameWeaknesses(game, gi);
    weaknesses.push(...gameWeaknesses);
  }

  const patterns = summarizePatterns(weaknesses, benchResult.games.length);
  const suggestions = generateSuggestions(patterns, weaknesses);

  return {
    timestamp: new Date().toISOString(),
    sourceFile,
    totalGames: benchResult.games.length,
    weaknesses,
    patterns,
    suggestions,
  };
}

// ============================================================================
// 個別対局の分析
// ============================================================================

/**
 * 1対局を分析して弱点インスタンスを返す
 */
function analyzeGameWeaknesses(
  game: GameResult,
  gameIndex: number,
): WeaknessInstance[] {
  const weaknesses: WeaknessInstance[] = [];

  // blunder / time-pressure-error / depth-disagreement の検出
  weaknesses.push(...detectMoveWeaknesses(game, gameIndex));

  // missed-vcf の検出
  weaknesses.push(...detectMissedVcf(game, gameIndex));

  // advantage-squandered の検出
  weaknesses.push(...detectAdvantageSquandered(game, gameIndex));

  // forbidden-vulnerability の検出
  weaknesses.push(...detectForbiddenVulnerability(game, gameIndex));

  return weaknesses;
}

// ============================================================================
// blunder / time-pressure-error / depth-disagreement
// ============================================================================

/**
 * 各手のスコア情報から blunder, time-pressure-error, depth-disagreement を検出
 */
function detectMoveWeaknesses(
  game: GameResult,
  gameIndex: number,
): WeaknessInstance[] {
  const weaknesses: WeaknessInstance[] = [];

  for (let mi = 0; mi < game.moveHistory.length; mi++) {
    const move = game.moveHistory[mi];
    if (!move) {
      continue;
    }

    const color: "black" | "white" = mi % 2 === 0 ? "black" : "white";
    const position: Position = { row: move.row, col: move.col };

    // --- blunder 検出 ---
    if (mi > 0 && move.score !== undefined) {
      const prevMove = game.moveHistory[mi - 1];
      if (prevMove?.score !== undefined) {
        // スコアは手番視点なので符号反転して比較
        // 前手の相手視点スコア = -prevMove.score
        // 今手の自分視点スコア = move.score
        // scoreDrop = 前手の「自分有利度」 - 今手の「自分有利度」
        const prevScoreFromMyView = -prevMove.score;
        const currentScore = move.score;
        const scoreDrop = prevScoreFromMyView - currentScore;

        // 強制手のスコアは参考値なのでblunder判定しない
        const isForcedMove = move.forcedMove || prevMove.forcedMove;
        if (scoreDrop >= BLUNDER_THRESHOLD && !isForcedMove) {
          const weakness: BlunderWeakness = {
            type: "blunder",
            gameIndex,
            moveNumber: mi + 1,
            color,
            position,
            previousScore: prevScoreFromMyView,
            currentScore,
            scoreDrop,
            description: `手${mi + 1}: スコアが${prevScoreFromMyView}→${currentScore}に急落（差${scoreDrop}）`,
          };
          weaknesses.push(weakness);
        }
      }
    }

    // --- time-pressure-error 検出 ---
    if (
      move.stats?.interrupted &&
      move.depthHistory &&
      move.depthHistory.length >= 2
    ) {
      const lastCompleted = move.depthHistory[move.depthHistory.length - 2];
      const finalResult = move.depthHistory[move.depthHistory.length - 1];

      if (lastCompleted && finalResult) {
        // 最終深度の手と完了深度の手が異なり、スコアが悪化
        const isDifferentMove =
          lastCompleted.position.row !== finalResult.position.row ||
          lastCompleted.position.col !== finalResult.position.col;

        if (isDifferentMove && finalResult.score < lastCompleted.score) {
          const weakness: TimePressureErrorWeakness = {
            type: "time-pressure-error",
            gameIndex,
            moveNumber: mi + 1,
            color,
            position,
            previousDepthScore: lastCompleted.score,
            previousDepthMove: lastCompleted.position,
            finalScore: finalResult.score,
            completedDepth: move.stats.completedDepth,
            maxDepth: move.stats.maxDepth,
            description: `手${mi + 1}: 時間切れで深度${move.stats.completedDepth}/${move.stats.maxDepth}中断。前深度のスコア${lastCompleted.score}→${finalResult.score}に悪化`,
          };
          weaknesses.push(weakness);
        }
      }
    }

    // --- depth-disagreement 検出 ---
    if (move.depthHistory && move.depthHistory.length >= 2) {
      const positions = new Set(
        move.depthHistory.map((d) => `${d.position.row},${d.position.col}`),
      );
      if (positions.size > 1) {
        const weakness: DepthDisagreementWeakness = {
          type: "depth-disagreement",
          gameIndex,
          moveNumber: mi + 1,
          color,
          position,
          depthHistory: move.depthHistory.map((d) => ({
            depth: d.depth,
            position: d.position,
            score: d.score,
          })),
          description: `手${mi + 1}: 深度間で最善手が${positions.size}パターンに分散`,
        };
        weaknesses.push(weakness);
      }
    }
  }

  return weaknesses;
}

// ============================================================================
// missed-vcf 検出
// ============================================================================

/**
 * VCFレースで相手が先着するか判定
 * 自VCFが2手以上かつ相手VCFがより短い場合にtrue
 */
function isVcfRaceLoss(
  board: BoardState,
  color: "black" | "white",
  mySequenceLength: number,
): boolean {
  const myMoveCount = Math.ceil(mySequenceLength / 2);
  if (myMoveCount <= 1) {
    return false;
  }

  const opponentColor = color === "black" ? "white" : "black";
  const oppVcf = findVCFSequence(board, opponentColor, {
    timeLimit: VCF_ANALYSIS_TIME_LIMIT,
  });
  if (!oppVcf) {
    return false;
  }

  const oppMoveCount = Math.ceil(oppVcf.sequence.length / 2);
  return myMoveCount > oppMoveCount;
}

/**
 * 負けた側の局面でVCFがあったのに見逃した手を検出
 */
function detectMissedVcf(
  game: GameResult,
  gameIndex: number,
): MissedVcfWeakness[] {
  const weaknesses: MissedVcfWeakness[] = [];

  // 引き分けは対象外
  if (game.winner === "draw") {
    return weaknesses;
  }

  // 負けた側の色を特定
  const loserColor = getLoserColor(game);

  // 盤面を再構築しながら、負けた側のターンでVCFがあるか検証
  let board: BoardState = createEmptyBoard();

  for (let mi = 0; mi < game.moveHistory.length; mi++) {
    const move = game.moveHistory[mi];
    if (!move) {
      continue;
    }

    const color: "black" | "white" = mi % 2 === 0 ? "black" : "white";
    const position: Position = { row: move.row, col: move.col };

    // 負けた側のターンでVCFを探索
    if (color === loserColor && mi >= 4) {
      const vcfWeakness = checkMissedVcfAtPosition(
        board,
        color,
        position,
        gameIndex,
        mi,
      );
      if (vcfWeakness) {
        weaknesses.push(vcfWeakness);
      }
    }

    // 盤面に着手を適用
    board = applyMove(board, position, color);
  }

  return weaknesses;
}

/**
 * 特定の局面でVCFが存在し、実際に使用可能か（レース・強制防御を考慮）を判定
 */
function checkMissedVcfAtPosition(
  board: BoardState,
  color: "black" | "white",
  actualPosition: Position,
  gameIndex: number,
  mi: number,
): MissedVcfWeakness | null {
  // 相手に止め四/活四がある場合、VCFは実行不可（防御が強制される）
  const opponentColor = color === "black" ? "white" : "black";
  const threats = detectOpponentThreats(board, opponentColor);
  if (threats.openFours.length > 0 || threats.fours.length > 0) {
    return null;
  }

  const vcfResult = findVCFSequence(board, color, {
    timeLimit: VCF_ANALYSIS_TIME_LIMIT,
  });
  if (!vcfResult) {
    return null;
  }
  if (
    vcfResult.firstMove.row === actualPosition.row &&
    vcfResult.firstMove.col === actualPosition.col
  ) {
    return null;
  }

  // VCFレース判定: 相手もVCFを持っていて先着する場合は除外
  if (isVcfRaceLoss(board, color, vcfResult.sequence.length)) {
    return null;
  }

  return {
    type: "missed-vcf",
    gameIndex,
    moveNumber: mi + 1,
    color,
    position: actualPosition,
    vcfMove: vcfResult.firstMove,
    actualMove: actualPosition,
    description: `手${mi + 1}: VCFが(${vcfResult.firstMove.row},${vcfResult.firstMove.col})にあったが(${actualPosition.row},${actualPosition.col})を選択`,
  };
}

// ============================================================================
// advantage-squandered 検出
// ============================================================================

/**
 * 優勢からの逆転負けを検出
 */
function detectAdvantageSquandered(
  game: GameResult,
  gameIndex: number,
): AdvantageSquanderedWeakness[] {
  const weaknesses: AdvantageSquanderedWeakness[] = [];

  // 引き分けは対象外
  if (game.winner === "draw") {
    return weaknesses;
  }

  // 負けた側のピークスコアを追跡
  const loserColor = getLoserColor(game);
  let peakScore = 0;
  let peakMoveNumber = 0;

  for (let mi = 0; mi < game.moveHistory.length; mi++) {
    const move = game.moveHistory[mi];
    if (!move || move.score === undefined) {
      continue;
    }

    const color: "black" | "white" = mi % 2 === 0 ? "black" : "white";

    if (color === loserColor) {
      if (move.score > peakScore) {
        peakScore = move.score;
        peakMoveNumber = mi + 1;
      }
    }
  }

  if (peakScore >= ADVANTAGE_THRESHOLD) {
    // ピークスコアの手を使って弱点インスタンスを生成
    const peakMove = game.moveHistory[peakMoveNumber - 1];
    if (peakMove) {
      weaknesses.push({
        type: "advantage-squandered",
        gameIndex,
        moveNumber: peakMoveNumber,
        color: loserColor,
        position: { row: peakMove.row, col: peakMove.col },
        peakScore,
        peakMoveNumber,
        finalResult: game.winner,
        description: `手${peakMoveNumber}でスコア${peakScore}の優勢があったが最終的に敗北`,
      });
    }
  }

  return weaknesses;
}

// ============================================================================
// forbidden-vulnerability 検出
// ============================================================================

/**
 * 禁手追い込みが成立した局面を検出
 */
function detectForbiddenVulnerability(
  game: GameResult,
  gameIndex: number,
): ForbiddenVulnerabilityWeakness[] {
  const weaknesses: ForbiddenVulnerabilityWeakness[] = [];

  if (game.reason !== "forbidden") {
    return weaknesses;
  }

  // 最後の手を確認
  const lastMove = game.moveHistory[game.moveHistory.length - 1] as
    | MoveRecord
    | undefined;

  if (!lastMove) {
    return weaknesses;
  }

  const totalMoves = game.moveHistory.length;
  const lastMoveNumber = totalMoves;
  const lastColor: "black" | "white" =
    (totalMoves - 1) % 2 === 0 ? "black" : "white";

  if (lastMove.forcedForbidden) {
    // 白の禁手追い込みで黒が負けた場合
    // 禁手追い込みが成立した白の手を見つける（最終手の1つ前 = 最後の白の手）
    const trapMoveIndex = totalMoves - 1; // 最後の手（白が打った禁手追い込み手）
    weaknesses.push({
      type: "forbidden-vulnerability",
      gameIndex,
      moveNumber: lastMoveNumber,
      color: "black", // 黒が弱点を突かれた
      position: { row: lastMove.row, col: lastMove.col },
      trapMoveNumber: trapMoveIndex + 1,
      description: `手${lastMoveNumber}: 白の禁手追い込みで黒が敗北`,
    });
  } else {
    // 黒が自滅禁手を打った場合
    weaknesses.push({
      type: "forbidden-vulnerability",
      gameIndex,
      moveNumber: lastMoveNumber,
      color: lastColor,
      position: { row: lastMove.row, col: lastMove.col },
      trapMoveNumber: lastMoveNumber,
      description: `手${lastMoveNumber}: 黒が禁手を自滅的に着手`,
    });
  }

  return weaknesses;
}

// ============================================================================
// パターン集計
// ============================================================================

/**
 * 弱点パターンを集計
 */
function summarizePatterns(
  weaknesses: WeaknessInstance[],
  totalGames: number,
): WeaknessPatternSummary[] {
  const types: WeaknessType[] = [
    "blunder",
    "missed-vcf",
    "advantage-squandered",
    "depth-disagreement",
    "forbidden-vulnerability",
    "time-pressure-error",
  ];

  return types.map((type) => {
    const matching = weaknesses.filter((w) => w.type === type);
    const byColor = { black: 0, white: 0 };
    for (const w of matching) {
      byColor[w.color]++;
    }

    return {
      type,
      count: matching.length,
      rate: totalGames > 0 ? matching.length / totalGames : 0,
      byColor,
    };
  });
}

// ============================================================================
// 改善提案
// ============================================================================

/**
 * 弱点パターンから改善提案を生成
 */
function generateSuggestions(
  patterns: WeaknessPatternSummary[],
  weaknesses: WeaknessInstance[],
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];
  let priority = 1;

  // forbidden-vulnerability が多い場合
  const forbiddenPattern = patterns.find(
    (p) => p.type === "forbidden-vulnerability",
  );
  if (forbiddenPattern && forbiddenPattern.count > 0) {
    suggestions.push({
      priority: priority++,
      targetWeakness: "forbidden-vulnerability",
      suggestion: `禁手負けが${forbiddenPattern.count}件（${forbiddenPattern.rate.toFixed(2)}/局）。FORBIDDEN_TRAP_STRONGの調整、または黒番の禁手回避ロジック強化を検討`,
      relatedParams: [
        "FORBIDDEN_TRAP_STRONG",
        "FORBIDDEN_VULNERABILITY_STRONG",
        "FORBIDDEN_VULNERABILITY_MILD",
      ],
    });
  }

  // blunder が多い場合
  const blunderPattern = patterns.find((p) => p.type === "blunder");
  if (blunderPattern && blunderPattern.count > 0) {
    // 平均スコアドロップを計算
    const blunders = weaknesses.filter(
      (w): w is BlunderWeakness => w.type === "blunder",
    );
    const avgDrop =
      blunders.length > 0
        ? blunders.reduce((sum, b) => sum + b.scoreDrop, 0) / blunders.length
        : 0;

    suggestions.push({
      priority: priority++,
      targetWeakness: "blunder",
      suggestion: `大悪手が${blunderPattern.count}件（平均スコア差${Math.round(avgDrop)}）。探索深度の増加またはOPEN_FOUR/FOUR_THREE_BONUSの調整を検討`,
      relatedParams: ["OPEN_FOUR", "FOUR_THREE_BONUS", "OPEN_THREE"],
    });
  }

  // missed-vcf が多い場合
  const missedVcfPattern = patterns.find((p) => p.type === "missed-vcf");
  if (missedVcfPattern && missedVcfPattern.count > 0) {
    suggestions.push({
      priority: priority++,
      targetWeakness: "missed-vcf",
      suggestion: `VCF見逃しが${missedVcfPattern.count}件。VCF探索の深度/時間制限の拡大を検討`,
      relatedParams: ["FUKUMI_BONUS"],
    });
  }

  // advantage-squandered が多い場合
  const advantagePattern = patterns.find(
    (p) => p.type === "advantage-squandered",
  );
  if (advantagePattern && advantagePattern.count > 0) {
    suggestions.push({
      priority: priority++,
      targetWeakness: "advantage-squandered",
      suggestion: `優勢からの逆転負けが${advantagePattern.count}件。防御評価のバランスまたはMISE_BONUSの調整を検討`,
      relatedParams: ["MISE_BONUS", "FOUR", "OPEN_THREE"],
    });
  }

  // time-pressure-error が多い場合
  const timePressurePattern = patterns.find(
    (p) => p.type === "time-pressure-error",
  );
  if (timePressurePattern && timePressurePattern.count > 0) {
    suggestions.push({
      priority: priority++,
      targetWeakness: "time-pressure-error",
      suggestion: `時間切れによるスコア悪化が${timePressurePattern.count}件。FUTILITY_MARGINの調整でノード数削減を検討`,
      relatedParams: ["FUTILITY_MARGIN_1", "FUTILITY_MARGIN_2"],
    });
  }

  // depth-disagreement が多い場合
  const depthPattern = patterns.find((p) => p.type === "depth-disagreement");
  if (depthPattern && depthPattern.count > 0) {
    suggestions.push({
      priority: priority++,
      targetWeakness: "depth-disagreement",
      suggestion: `深度間の最善手不一致が${depthPattern.count}件。評価関数の安定性改善を検討`,
      relatedParams: ["ASPIRATION_WINDOW"],
    });
  }

  return suggestions;
}

// ============================================================================
// フォーマット出力
// ============================================================================

/**
 * レポートをコンソール用にフォーマット
 */
export function formatWeaknessReport(report: WeaknessReport): string {
  const lines: string[] = [];
  const ln = (s = ""): number => lines.push(s);

  ln(`=== 弱点パターン分析レポート ===`);
  ln(`ソース: ${report.sourceFile}`);
  ln(`対局数: ${report.totalGames}`);
  ln(`弱点検出数: ${report.weaknesses.length}`);
  ln();

  // パターン別集計
  ln("【パターン別集計】");
  for (const pattern of report.patterns) {
    if (pattern.count === 0) {
      continue;
    }
    const perGame = pattern.rate.toFixed(2);
    ln(
      `  ${pattern.type}: ${pattern.count}件 (${perGame}/局) [黒${pattern.byColor.black}/白${pattern.byColor.white}]`,
    );
  }
  ln();

  // 弱点インスタンス（タイプ別に表示）
  const typeOrder: WeaknessType[] = [
    "blunder",
    "missed-vcf",
    "advantage-squandered",
    "forbidden-vulnerability",
    "time-pressure-error",
    "depth-disagreement",
  ];

  for (const type of typeOrder) {
    const instances = report.weaknesses.filter((w) => w.type === type);
    if (instances.length === 0) {
      continue;
    }

    ln(`【${type}】 (${instances.length}件)`);
    // 最大10件表示
    const displayCount = Math.min(instances.length, 10);
    for (let i = 0; i < displayCount; i++) {
      const w = instances[i];
      if (!w) {
        continue;
      }
      ln(`  game ${w.gameIndex}: ${w.description}`);
    }
    if (instances.length > displayCount) {
      ln(`  ... 他${instances.length - displayCount}件`);
    }
    ln();
  }

  // 改善提案
  if (report.suggestions.length > 0) {
    ln("【改善提案】");
    for (const s of report.suggestions) {
      ln(`  [${s.priority}] ${s.suggestion}`);
      if (s.relatedParams) {
        ln(`      関連パラメータ: ${s.relatedParams.join(", ")}`);
      }
    }
    ln();
  }

  ln("=== 分析完了 ===");
  return `${lines.join("\n")}\n`;
}
