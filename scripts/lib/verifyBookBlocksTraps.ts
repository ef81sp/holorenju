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
  /** board（白番）のブック候補（実盤座標、棋譜表記）を全列挙する。ヒットなしは null。 */
  candidateMoves(board: BoardState): string[] | null;
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

  const white4Candidates = book.candidateMoves(board) ?? [recordedWhite4Str!];

  const branches: VerifyBranch[] = [];

  for (const white4Str of white4Candidates) {
    const boardAfterWhite4 = applyMove(board, parseMove(white4Str), "white");
    const boardAfterBlack5 = applyMove(boardAfterWhite4, black5, "black");

    const white6Candidates = book.candidateMoves(boardAfterBlack5) ?? [
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

      const white8Candidates = book.candidateMoves(boardAfterBlack7);
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
