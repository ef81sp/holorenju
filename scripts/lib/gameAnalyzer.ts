/**
 * ベンチマーク棋譜の分析ロジック
 *
 * 棋譜ベースの分析（探索不要）:
 * - 各手が四/活三/四三を作ったかは盤面から判定
 * - VCF勝ちは最後の数手が「四→四→...→四三/五連」かで判定
 */

import type { BoardState, Position } from "../../src/types/game.ts";
import type {
  BenchGameResult,
  BenchmarkResultFile,
  GameAnalysis,
  MoveAnalysis,
  OpeningInfo,
  Tag,
} from "../types/analysis.ts";

import {
  createsFourThree,
  evaluateForbiddenTrap,
  findDoubleMiseMoves,
  findMiseTargets,
  isDoubleMise,
} from "../../src/logic/cpu/evaluation/tactics.ts";
import { detectOpponentThreats } from "../../src/logic/cpu/evaluation/threatDetection.ts";
import { getOpeningPatternInfo } from "../../src/logic/cpu/opening.ts";
import {
  createsFour,
  createsOpenThree,
} from "../../src/logic/cpu/search/threatMoves.ts";
import { formatMove } from "../../src/logic/gameRecordParser.ts";
import {
  checkFive,
  checkForbiddenMove,
  createEmptyBoard,
} from "../../src/logic/renjuRules/index.ts";

/**
 * 1手を分析してタグを付与（盤面ベース、探索なし）
 *
 * @param board 盤面（この手を打つ前の状態）
 * @param position 打つ位置
 * @param color 打つ色
 * @param moveNumber 手番号
 * @returns 分析結果（盤面はこの関数内で更新される）
 */
export function analyzeMove(
  board: BoardState,
  position: Position,
  color: "black" | "white",
  moveNumber: number,
): MoveAnalysis {
  const tags: Tag[] = [];

  // === 手を打つ前の盤面で判定 ===

  // 禁手チェック（黒のみ）
  if (color === "black") {
    const forbiddenResult = checkForbiddenMove(
      board,
      position.row,
      position.col,
    );
    if (forbiddenResult.isForbidden) {
      if (forbiddenResult.type === "double-three") {
        tags.push("double-three");
      } else if (forbiddenResult.type === "double-four") {
        tags.push("double-four");
      } else if (forbiddenResult.type === "overline") {
        tags.push("overline");
      }
    }
  }

  // 四三を作ったか（石を置く前に判定、内部で一時的に石を置く）
  const isFourThree = createsFourThree(
    board,
    position.row,
    position.col,
    color,
  );
  if (isFourThree) {
    tags.push("four-three");
  }

  // 両ミセ見逃し検出（石を置く前の盤面で判定）
  // 四三を打った手や五連は見逃しチェック不要（それらは両ミセより強い）
  let isMissedDoubleMise = false;
  if (!isFourThree) {
    const dmMoves = findDoubleMiseMoves(board, color);
    if (dmMoves.length > 0) {
      isMissedDoubleMise = true;
    }
  }

  // === 手を打つ ===
  const row = board[position.row];
  if (row) {
    row[position.col] = color;
  }

  // === 手を打った後の盤面で判定 ===

  // 五連チェック
  const isFive = checkFive(board, position.row, position.col, color);
  if (isFive) {
    tags.push("winning-move");
  }

  // 四を作ったか（四三でない場合）
  // createsFourは石を置いた後の盤面で判定
  if (!isFourThree && createsFour(board, position.row, position.col, color)) {
    tags.push("four");
  }

  // 活三を作ったか（四、四三でない場合）
  if (
    !isFourThree &&
    !tags.includes("four") &&
    createsOpenThree(board, position.row, position.col, color)
  ) {
    tags.push("open-three");
  }

  // 禁手追い込み（白がこの手で禁手追い込みを作った）
  if (color === "white") {
    const trapScore = evaluateForbiddenTrap(board, position.row, position.col);
    if (trapScore > 0) {
      tags.push("forbidden-trap");
    }
  }

  // 両ミセ検出（四三でない場合のみ）
  let isDoubleMiseMove = false;
  if (!isFourThree) {
    const targets = findMiseTargets(board, position.row, position.col, color);
    if (
      targets.length >= 2 &&
      isDoubleMise(board, position.row, position.col, color, targets)
    ) {
      tags.push("double-mise");
      isDoubleMiseMove = true;
    }
  }

  // 両ミセ見逃しタグ付与（自分が両ミセを打っておらず、五連でもない場合）
  if (isMissedDoubleMise && !isDoubleMiseMove && !isFive) {
    tags.push("missed-double-mise");
  }

  // 開局手
  if (moveNumber <= 3) {
    tags.push("opening-move");
  }

  return {
    moveNumber,
    position,
    color,
    notation: formatMove(position),
    tags,
  };
}

/**
 * 禁手追い込みの禁手タイプを判定してタグを返す
 */
function detectForbiddenTrapType(board: BoardState): Tag | null {
  const whiteThreats = detectOpponentThreats(board, "white");
  const defensePosArray =
    whiteThreats.openFours.length > 0
      ? whiteThreats.openFours
      : whiteThreats.fours;

  const [defensePos] = defensePosArray;
  if (!defensePos) {
    return null;
  }

  const forbiddenResult = checkForbiddenMove(
    board,
    defensePos.row,
    defensePos.col,
  );
  if (!forbiddenResult.isForbidden) {
    return null;
  }

  switch (forbiddenResult.type) {
    case "double-three":
      return "double-three";
    case "double-four":
      return "double-four";
    case "overline":
      return "overline";
    default:
      return null;
  }
}

/**
 * 開局情報を取得してタグを追加
 */
function getOpeningInfo(
  game: BenchGameResult,
  gameTags: Tag[],
): OpeningInfo | undefined {
  if (game.moveHistory.length < 3) {
    return undefined;
  }

  // 盤面を3手目まで再現
  const boardFor3Moves = createEmptyBoard();
  for (let i = 0; i < 3 && i < game.moveHistory.length; i++) {
    const moveData = game.moveHistory[i];
    if (!moveData) {
      continue;
    }
    const color: "black" | "white" = i % 2 === 0 ? "black" : "white";
    const row = boardFor3Moves[moveData.row];
    if (row) {
      row[moveData.col] = color;
    }
  }

  const patternInfo = getOpeningPatternInfo(boardFor3Moves);
  if (!patternInfo) {
    return undefined;
  }

  // 珠型タグを追加
  gameTags.push(`jushu:${patternInfo.name}` as Tag);
  gameTags.push(patternInfo.type as Tag);

  return {
    jushu: patternInfo.name,
    type: patternInfo.type,
  };
}

/** VCF検出結果 */
interface VcfResult {
  /** VCF開始インデックス */
  startIndex: number;
  /** VCFの手数（勝者の手のみカウント） */
  vcfLength: number;
}

/**
 * 四追い勝ち（VCF）を検出
 *
 * 勝者の最後の数手を遡り、四→四→...→四三/五連のパターンを検出
 * @returns VCF結果（開始インデックスと手数）、VCFでなければnull
 */
function detectVcfWin(
  moves: MoveAnalysis[],
  winner: "A" | "B" | "draw",
  reason: string,
): VcfResult | null {
  if (winner === "draw" || reason !== "five") {
    return null;
  }

  // 勝者の色を特定（A=黒先手、B=白後手）
  const winnerColor = winner === "A" ? "black" : "white";

  // 最後の手から遡る
  let vcfStartIndex: number | null = null;

  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (!move || move.color !== winnerColor) {
      continue;
    }

    // 四三または五連（最終手）
    if (
      move.tags.includes("four-three") ||
      move.tags.includes("winning-move")
    ) {
      vcfStartIndex = i;
      continue;
    }

    // 四を打っている
    if (move.tags.includes("four")) {
      vcfStartIndex = i;
      continue;
    }

    // 四でも四三でもない手に到達したら終了
    break;
  }

  // 2手以上の四追いがあればVCF勝ち
  if (vcfStartIndex !== null) {
    const lastMove = moves[moves.length - 1];
    if (!lastMove) {
      return null;
    }

    // 最終手が勝者の手で、vcfStartIndexから連続して四を打っていた
    const vcfMoves: MoveAnalysis[] = [];
    for (let i = vcfStartIndex; i < moves.length; i++) {
      const move = moves[i];
      if (move && move.color === winnerColor) {
        vcfMoves.push(move);
      }
    }

    // 2手以上の四追いならVCF
    if (vcfMoves.length >= 2) {
      return {
        startIndex: vcfStartIndex,
        vcfLength: vcfMoves.length,
      };
    }
  }

  return null;
}

/**
 * 四追い禁手追い込み（VCF → forbidden）を検出
 *
 * 最後の手（白の禁手追い込み手）から遡り、白の連続四を追跡。
 * 白の連続四が2手以上あればVCF禁手追い込みと判定する。
 */
function detectVcfForbidden(moves: MoveAnalysis[]): VcfResult | null {
  let vcfStartIndex: number | null = null;

  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (!move || move.color !== "white") {
      continue;
    }

    // 四、四三、禁手追い込みのいずれかであればVCFの一部
    if (
      move.tags.includes("four") ||
      move.tags.includes("four-three") ||
      move.tags.includes("forbidden-trap")
    ) {
      vcfStartIndex = i;
      continue;
    }

    // それ以外の白の手に到達したら終了
    break;
  }

  if (vcfStartIndex === null) {
    return null;
  }

  // 白の手数をカウント
  let vcfLength = 0;
  for (let i = vcfStartIndex; i < moves.length; i++) {
    const move = moves[i];
    if (move?.color === "white") {
      vcfLength++;
    }
  }

  // 2手以上の四追いならVCF
  if (vcfLength >= 2) {
    return { startIndex: vcfStartIndex, vcfLength };
  }

  return null;
}

/**
 * 1対局を分析
 */
export function analyzeGame(
  game: BenchGameResult,
  gameId: string,
  sourceFile: string,
): GameAnalysis {
  const board = createEmptyBoard();
  const moves: MoveAnalysis[] = [];
  const gameTags: Tag[] = [];
  const gameRecord: string[] = [];

  // 各手を順次再現しながら分析
  for (let i = 0; i < game.moveHistory.length; i++) {
    const moveData = game.moveHistory[i];
    if (!moveData) {
      continue;
    }

    const position: Position = { row: moveData.row, col: moveData.col };
    const color: "black" | "white" = i % 2 === 0 ? "black" : "white";

    const moveAnalysis = analyzeMove(board, position, color, i + 1);

    moves.push(moveAnalysis);
    gameRecord.push(moveAnalysis.notation);
  }

  // 四追い勝ち（VCF）の検出
  const vcfResult = detectVcfWin(moves, game.winner, game.reason);
  if (vcfResult !== null) {
    // VCF開始手以降にタグを付与
    const winnerColor = game.winner === "A" ? "black" : "white";
    for (let i = vcfResult.startIndex; i < moves.length; i++) {
      const move = moves[i];
      if (
        move &&
        move.color === winnerColor &&
        !move.tags.includes("vcf-win")
      ) {
        move.tags.push("vcf-win");
      }
    }
    gameTags.push("vcf-win");
    // VCF手数タグを追加（例: vcf-3 = 3手のVCF）
    gameTags.push(`vcf-${vcfResult.vcfLength}` as Tag);
  }

  // 禁手負けの検出
  if (game.reason === "forbidden") {
    const lastMoveData = game.moveHistory[game.moveHistory.length - 1];
    const lastMove = moves[moves.length - 1];

    // 禁手追い込み（forcedForbidden=true）の場合、防御位置の禁手タイプを判定
    if (lastMoveData?.forcedForbidden && lastMove) {
      const forbiddenTag = detectForbiddenTrapType(board);
      if (forbiddenTag) {
        lastMove.tags.push(forbiddenTag);
      }
      lastMove.tags.push("forbidden-loss");
    } else if (lastMove) {
      // 直接禁手（黒が禁手を打った）の場合
      // analyzeMoveで既に禁手タイプがタグ付けされているはず
      lastMove.tags.push("forbidden-loss");
    }
    gameTags.push("forbidden-loss");

    // 四追い禁手追い込み（VCF → forbidden）の検出
    const vcfForbiddenResult = lastMoveData?.forcedForbidden
      ? detectVcfForbidden(moves)
      : null;
    if (vcfForbiddenResult !== null) {
      for (let i = vcfForbiddenResult.startIndex; i < moves.length; i++) {
        const move = moves[i];
        if (move?.color === "white") {
          move.tags.push("vcf-forbidden");
        }
      }
      gameTags.push("vcf-forbidden");
      gameTags.push(`vcf-${vcfForbiddenResult.vcfLength}` as Tag);
    }
  }

  // 対局レベルのタグを収集
  for (const move of moves) {
    for (const tag of move.tags) {
      if (!gameTags.includes(tag)) {
        gameTags.push(tag);
      }
    }
  }

  // 開局情報の取得（3手目以降）
  const opening = getOpeningInfo(game, gameTags);

  const matchup = `${game.playerA} vs ${game.playerB}`;

  // isABlack=false のとき winner を反転して色ベースに正規化
  // A=黒勝, B=白勝 の慣例に合わせる
  let colorWinner: "A" | "B" | "draw" = game.winner;
  if (!game.isABlack) {
    switch (game.winner) {
      case "A":
        colorWinner = "B";
        break;
      case "B":
        colorWinner = "A";
        break;
      default:
        colorWinner = "draw";
    }
  }

  return {
    gameId,
    sourceFile,
    matchup,
    winner: colorWinner,
    reason: game.reason,
    totalMoves: game.moves,
    gameTags,
    moves,
    gameRecord: gameRecord.join(" "),
    opening,
  };
}

/**
 * ベンチマーク結果ファイルを分析
 */
export function analyzeBenchmarkFile(
  benchResult: BenchmarkResultFile,
  sourceFile: string,
): GameAnalysis[] {
  const analyses: GameAnalysis[] = [];

  for (let i = 0; i < benchResult.games.length; i++) {
    const game = benchResult.games[i];
    if (!game) {
      continue;
    }

    const gameId = `${sourceFile}-game${i + 1}`;
    const analysis = analyzeGame(game, gameId, sourceFile);
    analyses.push(analysis);
  }

  return analyses;
}
