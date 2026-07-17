/**
 * ゲート1（opening-book-2026-07-16.md §5-1）: 序盤定石ブック有効時に、採掘済みの
 * severity-A トラップレコードが再現しないことを検証するロジック。
 *
 * 黒の手順（黒1・黒3・黒5・黒7）は記録どおり固定し、白の各手（白4・白6・白8）は
 * ブックにヒットすればブックの候補（randomPool があれば全候補）を、ヒットしなければ
 * 記録された手を使って局面を進める。white4/white6 でブックが記録と異なる手を選んだ
 * 場合、それ以降は記録の ply8 局面（canonicalKeyPly8）に到達しないため、そのブランチは
 * 「乖離（diverged）」として安全側（blocked=true）扱いにする
 * （＝この特定のトラップ経路自体がブックによって手前で回避されたということ）。
 *
 * ply8（記録の局面に到達したブランチ）でブックにエントリが無い場合は異常
 * （severity-A として記録された局面は本来ブックに収録されているはず）として
 * bookMissingAtPly8=true・blocked=false で報告する。
 *
 * ランダム候補（randomPool）は1つを乱数で選ぶのではなく、全件を決定的に列挙して
 * それぞれ検証する（§5-1: 「ランダム候補はプール全手を決定的に列挙して検証」）。
 */
import type { BoardState, Position } from "@/types/game";

import { canonicalKey } from "@/logic/boardSymmetry";
import { applyMove } from "@/logic/cpu/core/boardUtils";
import { parseMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

export interface TrapRecordForVerify {
  route: string;
  /** 黒7着手後・白番の局面の canonicalKey（severity-A レコードの主キー）。 */
  canonicalKeyPly8: string;
  /** [黒1, 白2, 黒3, 白4, 黒5, 白6, 黒7]（棋譜表記、7手）。 */
  moves: string[];
}

export interface BookLookup {
  /** board（color番）のブック候補（実盤座標、棋譜表記）を全列挙する。ヒットなしは null。 */
  candidateMoves(board: BoardState, color: "black" | "white"): string[] | null;
}

export interface ForcedWinChecker {
  /** sideToMove が move を打った後、相手に強制勝ち（VCF/VCT）が生じるか。 */
  check(
    board: BoardState,
    sideToMove: "black" | "white",
    move: Position,
  ): "VCF" | "VCT" | null;
}

export interface VerifyBranch {
  white4: string;
  white6: string;
  /** 記録の ply8 局面から乖離した場合は null（未検証）。 */
  white8: string | null;
  /** white4/white6 のいずれかがブックにより記録と異なり、記録の ply8 局面に到達しなかった。 */
  diverged: boolean;
  /** diverged=false なのに ply8 にブックのエントリが無い（異常。要調査）。 */
  bookMissingAtPly8: boolean;
  forcedWinKind: "VCF" | "VCT" | null;
  /** このブランチが安全か。 */
  blocked: boolean;
}

export interface VerifyRecordResult {
  route: string;
  canonicalKeyPly8: string;
  /** 全ブランチが安全なら true。 */
  blocked: boolean;
  branches: VerifyBranch[];
}

/**
 * 1件の severity-A レコードを検証する。
 */
export function verifyRecordBlocked(
  record: TrapRecordForVerify,
  book: BookLookup,
  checker: ForcedWinChecker,
): VerifyRecordResult {
  if (record.moves.length !== 7) {
    throw new Error(
      `不正なレコード: moves は7手必要（route=${record.route}, 実際=${record.moves.length}）`,
    );
  }
  const [
    black1Str,
    white2Str,
    black3Str,
    recordedWhite4Str,
    black5Str,
    recordedWhite6Str,
    black7Str,
  ] = record.moves;

  const black1 = parseMove(black1Str!);
  const white2 = parseMove(white2Str!);
  const black3 = parseMove(black3Str!);
  const black5 = parseMove(black5Str!);
  const black7 = parseMove(black7Str!);

  let board = createEmptyBoard();
  board = applyMove(board, black1, "black");
  board = applyMove(board, white2, "white");
  board = applyMove(board, black3, "black");

  const white4Candidates = book.candidateMoves(board, "white") ?? [
    recordedWhite4Str!,
  ];

  const branches: VerifyBranch[] = [];

  for (const white4Str of white4Candidates) {
    const boardAfterWhite4 = applyMove(board, parseMove(white4Str), "white");
    const boardAfterBlack5 = applyMove(boardAfterWhite4, black5, "black");

    const white6Candidates = book.candidateMoves(boardAfterBlack5, "white") ?? [
      recordedWhite6Str!,
    ];

    for (const white6Str of white6Candidates) {
      const boardAfterWhite6 = applyMove(
        boardAfterBlack5,
        parseMove(white6Str),
        "white",
      );
      const boardAfterBlack7 = applyMove(boardAfterWhite6, black7, "black");

      const reachedKey = canonicalKey(boardAfterBlack7, "white");
      const diverged = reachedKey !== record.canonicalKeyPly8;

      if (diverged) {
        branches.push({
          white4: white4Str,
          white6: white6Str,
          white8: null,
          diverged: true,
          bookMissingAtPly8: false,
          forcedWinKind: null,
          blocked: true,
        });
        continue;
      }

      const white8Candidates = book.candidateMoves(boardAfterBlack7, "white");
      if (!white8Candidates || white8Candidates.length === 0) {
        branches.push({
          white4: white4Str,
          white6: white6Str,
          white8: null,
          diverged: false,
          bookMissingAtPly8: true,
          forcedWinKind: null,
          blocked: false,
        });
        continue;
      }

      for (const white8Str of white8Candidates) {
        const forcedWinKind = checker.check(
          boardAfterBlack7,
          "white",
          parseMove(white8Str),
        );
        branches.push({
          white4: white4Str,
          white6: white6Str,
          white8: white8Str,
          diverged: false,
          bookMissingAtPly8: false,
          forcedWinKind,
          blocked: forcedWinKind === null,
        });
      }
    }
  }

  return {
    route: record.route,
    canonicalKeyPly8: record.canonicalKeyPly8,
    blocked: branches.every((b) => b.blocked),
    branches,
  };
}

// ─── 黒番トラップ個別対応（opening-book-2026-07-16.md 黒対応） ───────────────
//
// 黒番採掘は白番と役割が反転する: 黒（黒5・黒7）がブック対象（hard）、
// 白（白4・白6）は攻め側フィルタとして記録どおり固定して進める。
// 黒7がトラップ対象の着手（severity-A レコードは黒7着手前の局面を記録する）。

export interface BlackTrapRecordForVerify {
  route: string;
  /** 黒7着手前・黒番の局面の canonicalKey（severity-A レコードの主キー）。 */
  canonicalKeyBeforeBlack7: string;
  /** [黒1, 白2, 黒3, 白4, 黒5, 白6]（棋譜表記、6手）。 */
  moves: string[];
}

export interface BlackVerifyBranch {
  black5: string;
  white6: string;
  /** 記録の黒7着手前局面から乖離した場合は null（未検証）。 */
  black7: string | null;
  /** black5 がブックにより記録と異なり、記録の黒7着手前局面に到達しなかった。 */
  diverged: boolean;
  /** diverged=false なのに黒7着手前局面にブックのエントリが無い（異常。要調査）。 */
  bookMissingAtPly7: boolean;
  forcedWinKind: "VCF" | "VCT" | null;
  /** このブランチが安全か。 */
  blocked: boolean;
}

export interface BlackVerifyRecordResult {
  route: string;
  canonicalKeyBeforeBlack7: string;
  /** 全ブランチが安全なら true。 */
  blocked: boolean;
  branches: BlackVerifyBranch[];
}

/**
 * 1件の黒番severity-Aレコードを検証する。white4/white6 は記録どおり固定し、
 * black5/black7（ブック対象）はブックにヒットすればブックの候補（randomPool
 * があれば全候補）を、ヒットしなければ記録された手を使う。
 */
export function verifyBlackRecordBlocked(
  record: BlackTrapRecordForVerify,
  book: BookLookup,
  checker: ForcedWinChecker,
): BlackVerifyRecordResult {
  if (record.moves.length !== 6) {
    throw new Error(
      `不正なレコード: moves は6手必要（route=${record.route}, 実際=${record.moves.length}）`,
    );
  }
  const [
    black1Str,
    white2Str,
    black3Str,
    recordedWhite4Str,
    recordedBlack5Str,
    recordedWhite6Str,
  ] = record.moves;

  const black1 = parseMove(black1Str!);
  const white2 = parseMove(white2Str!);
  const black3 = parseMove(black3Str!);
  const white4 = parseMove(recordedWhite4Str!);
  const white6 = parseMove(recordedWhite6Str!);

  let board = createEmptyBoard();
  board = applyMove(board, black1, "black");
  board = applyMove(board, white2, "white");
  board = applyMove(board, black3, "black");
  board = applyMove(board, white4, "white");

  const black5Candidates = book.candidateMoves(board, "black") ?? [
    recordedBlack5Str!,
  ];

  const branches: BlackVerifyBranch[] = [];

  for (const black5Str of black5Candidates) {
    const boardAfterBlack5 = applyMove(board, parseMove(black5Str), "black");
    const boardAfterWhite6 = applyMove(boardAfterBlack5, white6, "white");

    const reachedKey = canonicalKey(boardAfterWhite6, "black");
    const diverged = reachedKey !== record.canonicalKeyBeforeBlack7;

    if (diverged) {
      branches.push({
        black5: black5Str,
        white6: recordedWhite6Str!,
        black7: null,
        diverged: true,
        bookMissingAtPly7: false,
        forcedWinKind: null,
        blocked: true,
      });
      continue;
    }

    const black7Candidates = book.candidateMoves(boardAfterWhite6, "black");
    if (!black7Candidates || black7Candidates.length === 0) {
      branches.push({
        black5: black5Str,
        white6: recordedWhite6Str!,
        black7: null,
        diverged: false,
        bookMissingAtPly7: true,
        forcedWinKind: null,
        blocked: false,
      });
      continue;
    }

    for (const black7Str of black7Candidates) {
      const forcedWinKind = checker.check(
        boardAfterWhite6,
        "black",
        parseMove(black7Str),
      );
      branches.push({
        black5: black5Str,
        white6: recordedWhite6Str!,
        black7: black7Str,
        diverged: false,
        bookMissingAtPly7: false,
        forcedWinKind,
        blocked: forcedWinKind === null,
      });
    }
  }

  return {
    route: record.route,
    canonicalKeyBeforeBlack7: record.canonicalKeyBeforeBlack7,
    blocked: branches.every((b) => b.blocked),
    branches,
  };
}
