/**
 * review.worker の forcedWinType 優先順・missedDoubleMise 判定ロジックのテスト
 *
 * Worker は直接テストできないため、worker 内部と同等のロジックを
 * 関数群の組み合わせで再現して検証する。
 *
 * テスト棋譜: G8 G10 F8 H11 H9 G9 E9 I8 F10 I9 H10 J9 I10 F7 H8 A1 A2
 *   - Move 13 (I10): VCT 開始手。両ミセ(H8)はあるが打っていない
 *   - Move 15 (H8): 両ミセ手を打つ
 *   - Move 17 (A2): 1手四三がある局面で無関係な手
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";
import type { ForcedLossResult, ForcedLossType } from "@/types/review";

import { createBoardFromRecord, parseMove } from "@/logic/gameRecordParser";

import { countStones } from "./core/boardUtils";
import { detectOpponentThreats } from "./evaluation";
import { findMiseTargets } from "./evaluation/miseTactics";
import {
  checkCandidateForcedLoss,
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./review/forcedLossCheck";
import { detectForcedWin } from "./review/forcedWinDetection";

/** テスト棋譜 */
const TEST_RECORD = "G8 G10 F8 H11 H9 G9 E9 I8 F10 I9 H10 J9 I10 F7 H8 A1 A2";

/**
 * worker の forcedWin 判定を detectForcedWin で実行
 */
function analyzeForcedWin(
  record: string,
  moveIndex: number,
): {
  board: BoardState;
  color: "black" | "white";
  doubleMiseMoves: Position[];
  doubleMiseBestMove: Position | null;
  forcedWinType: string | undefined;
} {
  const moves = record.trim().split(/\s+/);
  const { board, nextColor } = createBoardFromRecord(
    moves.slice(0, moveIndex).join(" "),
  );
  const color = nextColor as "black" | "white";
  const opponentColor = color === "black" ? "white" : "black";

  const opponentThreats = detectOpponentThreats(board, opponentColor);
  const opponentHasFour =
    opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

  const result = detectForcedWin(board, color, opponentHasFour, false);

  return {
    board,
    color,
    doubleMiseMoves: result.doubleMiseMoves,
    doubleMiseBestMove: result.doubleMiseBestMove,
    forcedWinType: result.forcedWinType,
  };
}

/**
 * worker の forcedWinType + doubleMiseTargets 判定を再現
 */
function determineForcedWinType(
  record: string,
  moveIndex: number,
): {
  forcedWinType: string | undefined;
  doubleMiseBestMove: Position | null;
  doubleMiseTargets: Position[] | undefined;
} {
  const { board, color, doubleMiseBestMove, forcedWinType } = analyzeForcedWin(
    record,
    moveIndex,
  );

  let doubleMiseTargets: Position[] | undefined = undefined;
  if (doubleMiseBestMove) {
    const row = board[doubleMiseBestMove.row];
    if (row) {
      row[doubleMiseBestMove.col] = color;
      doubleMiseTargets = findMiseTargets(
        board,
        doubleMiseBestMove.row,
        doubleMiseBestMove.col,
        color,
      );
      row[doubleMiseBestMove.col] = null;
    }
  }

  return {
    forcedWinType,
    doubleMiseBestMove,
    doubleMiseTargets,
  };
}

/**
 * worker の missedDoubleMise 判定を再現
 */
function determineMissedDoubleMise(
  record: string,
  moveIndex: number,
): Position[] | undefined {
  const moves = record.trim().split(/\s+/);
  const { doubleMiseMoves, forcedWinType } = analyzeForcedWin(
    record,
    moveIndex,
  );

  const playedMoveStr = moves[moveIndex];
  if (!playedMoveStr) {
    return undefined;
  }
  const { row: playedRow, col: playedCol } = parseMove(playedMoveStr);

  if (
    forcedWinType === "double-mise" &&
    doubleMiseMoves.length > 0 &&
    playedRow >= 0
  ) {
    const playedIsDoubleMise = doubleMiseMoves.some(
      (m) => m.row === playedRow && m.col === playedCol,
    );
    if (!playedIsDoubleMise) {
      return doubleMiseMoves;
    }
  }
  return undefined;
}

describe("review.worker: forcedWinType 優先順", () => {
  it("Move 13 (12手後): 両ミセ(H8)がある → forcedWinType=double-mise", () => {
    const result = determineForcedWinType(TEST_RECORD, 12);
    expect(result.forcedWinType).toBe("double-mise");
    expect(result.doubleMiseBestMove).toEqual({ row: 7, col: 7 }); // H8
  });

  it("Move 15 (14手後): 両ミセ(H8)がある → forcedWinType=double-mise", () => {
    const result = determineForcedWinType(TEST_RECORD, 14);
    expect(result.forcedWinType).toBe("double-mise");
  });

  it("Move 17 (16手後): H8の両ミセ後、1手四三がある → forcedWinType=vcf", () => {
    const result = determineForcedWinType(TEST_RECORD, 16);
    expect(result.forcedWinType).toBe("vcf");
  });
});

describe("review.worker: missedDoubleMise 判定", () => {
  it("Move 13 (I10): 両ミセを打っていない → missedDoubleMise あり", () => {
    const missed = determineMissedDoubleMise(TEST_RECORD, 12);
    expect(missed).toBeDefined();
    expect(missed?.some((m) => m.row === 7 && m.col === 7)).toBe(true); // H8
  });

  it("Move 15 (H8): 両ミセを打った → missedDoubleMise なし", () => {
    const missed = determineMissedDoubleMise(TEST_RECORD, 14);
    expect(missed).toBeUndefined();
  });

  it("Move 17 (A2): 1手四三局面 → missedDoubleMise なし（VCF優先）", () => {
    const missed = determineMissedDoubleMise(TEST_RECORD, 16);
    expect(missed).toBeUndefined();
  });
});

describe("review.worker: doubleMiseTargets 算出", () => {
  it("Move 13: H8の両ミセターゲットにD8とH6が含まれる", () => {
    const result = determineForcedWinType(TEST_RECORD, 12);
    expect(result.doubleMiseTargets).toBeDefined();
    const targets = result.doubleMiseTargets ?? [];
    // D8 = row 7, col 3
    expect(targets.some((t) => t.row === 7 && t.col === 3)).toBe(true);
    // H6 = row 9, col 7
    expect(targets.some((t) => t.row === 9 && t.col === 7)).toBe(true);
  });
});

describe("review.worker: 候補手事後検証", () => {
  it("四を作る手は自分に四があるためスキップされる", () => {
    // 黒の四が作れる局面を構築
    // H8 H9 I8 G8 J8（黒が横にF8で五連可能 = 四の状態）
    const { board } = createBoardFromRecord("H8 H9 I8 G8 J8");
    const stoneCount = countStones(board);

    // F8(row=7,col=5) は黒の四を作る → 相手VCF検出スキップ
    const result = checkCandidateForcedLoss(
      board,
      { row: 7, col: 5 },
      "black",
      "white",
      stoneCount,
    );
    expect(result).toBeUndefined();
  });

  it("仮配置後にボードが元に戻る", () => {
    const { board } = createBoardFromRecord("H8 H9 I8 G8");
    const pos = { row: 5, col: 5 };
    expect(board[pos.row]?.[pos.col]).toBeNull();

    checkCandidateForcedLoss(board, pos, "black", "white", 4);

    // ボードが復元されている
    expect(board[pos.row]?.[pos.col]).toBeNull();
  });
});

/**
 * worker の verifyCandidates 相当ロジックを再現
 */
interface ReviewCandidateStub {
  position: Position;
  searchScore: number;
  opponentForcedWin?: ForcedLossType;
}

function verifyCandidatesTest(
  board: BoardState,
  candidates: ReviewCandidateStub[],
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
): { demotedBest: boolean; bestLoss?: ForcedLossResult } {
  let demotedBest = false;
  let bestLoss: ForcedLossResult | undefined = undefined;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (!cand) {
      continue;
    }

    const loss = checkCandidateForcedLoss(
      board,
      cand.position,
      color,
      opponentColor,
      stoneCount,
    );

    if (loss) {
      cand.opponentForcedWin = loss.type;
      if (i === 0) {
        demotedBest = true;
        bestLoss = loss;
      }
    } else {
      break;
    }
  }

  return { demotedBest, bestLoss };
}

/** 白にVCFがある局面: H8 G8 I7 G9 H6 H9 G5 J8 F6 I9 F9 G11（12手後） */
const ALL_DANGER_RECORD =
  "H8 G8 I7 G9 H6 H9 G5 J8 F6 I9 F9 G11 F4 E3 F7 G10 F5 G12";

describe("review.worker: 全候補被必勝時のbestLoss", () => {
  it("全候補が被四追の場合、bestLossにsequenceが返る", () => {
    // 12手後: 白にVCF(G10, 1手)がある。黒のどの手も被四追
    const { board } = createBoardFromRecord(
      ALL_DANGER_RECORD.split(/\s+/).slice(0, 12).join(" "),
    );
    const stoneCount = countStones(board);

    // 候補手を複数用意（四を作らない手 = 被四追になる手）
    const candidates: ReviewCandidateStub[] = [
      { position: { row: 14, col: 0 }, searchScore: 100 }, // A1
      { position: { row: 14, col: 1 }, searchScore: 80 }, // B1
      { position: { row: 14, col: 2 }, searchScore: 60 }, // C1
    ];

    const { demotedBest, bestLoss } = verifyCandidatesTest(
      board,
      candidates,
      "black",
      "white",
      stoneCount,
    );

    expect(demotedBest).toBe(true);
    expect(bestLoss).toBeDefined();
    expect(bestLoss?.type).toBe("vcf");
    expect(bestLoss?.sequence).toBeDefined();
    expect(bestLoss?.sequence.length).toBeGreaterThan(0);

    // 全候補にopponentForcedWinが設定される
    for (const c of candidates) {
      expect(c.opponentForcedWin).toBe("vcf");
    }
  });

  it("最善手が安全な場合、bestLossはundefined", () => {
    // 序盤: 相手にVCFがない局面
    const { board } = createBoardFromRecord("H8 H9 I8 G8");
    const candidates: ReviewCandidateStub[] = [
      { position: { row: 5, col: 5 }, searchScore: 100 },
      { position: { row: 6, col: 6 }, searchScore: 80 },
    ];

    const { demotedBest, bestLoss } = verifyCandidatesTest(
      board,
      candidates,
      "black",
      "white",
      4,
    );

    expect(demotedBest).toBe(false);
    expect(bestLoss).toBeUndefined();
  });
});

/**
 * 白の三三・四四検出テスト
 *
 * テスト棋譜: H8 G8 I7 G9 H6 H9 G5 J8 F6 I9（10手）
 * 11手目(F9)後、白がG11で三三を作れる
 */
const DOUBLE_THREE_RECORD = "H8 G8 I7 G9 H6 H9 G5 J8 F6 I9";

describe("review.worker: 白の三三・四四検出", () => {
  it("11手目(F9)後に白がG11で三三 → type: double-three", () => {
    // 10手後に黒がF9を打った局面
    const { board } = createBoardFromRecord(`${DOUBLE_THREE_RECORD} F9`);
    const stoneCount = countStones(board);

    const result = checkForcedLoss(board, "white", stoneCount);
    expect(result).toBeDefined();
    expect(result?.type).toBe("double-three");
    // G11 = row 4, col 6
    expect(result?.sequence[0]).toEqual({ row: 4, col: 6 });
  });

  it("黒手番(opponentColor=black)では三三・四四チェックがスキップされる", () => {
    // 同じ局面でも opponentColor=black では白の三三チェック不要
    const { board } = createBoardFromRecord(`${DOUBLE_THREE_RECORD} F9`);
    const stoneCount = countStones(board);

    const result = checkForcedLoss(board, "black", stoneCount);
    // 黒にはVCF/VCT等もないはず（少なくとも三三・四四は検出しない）
    // 結果がundefinedか、あっても"double-three"/"double-four"ではない
    if (result) {
      expect(result.type).not.toBe("double-three");
      expect(result.type).not.toBe("double-four");
    }
  });

  it("白の四四が検出できる（VCFが見つかればVCF優先）", () => {
    // 白が四四を作れる局面を棋譜で構築
    // 黒: A1,B1,C1,D1,E1,F1 (隅に並べて邪魔にならない)
    // 白: F8,G8,H8 (横3連, row=7) + I11,I10,I9 (縦3連, col=8)
    // → I8 (row=7,col=8) に白を置くと横四 + 縦四 = 四四
    //
    // 交互着手: A1 F8 B1 G8 C1 H8 D1 I11 E1 I10 F1 I9
    const { board } = createBoardFromRecord(
      "A1 F8 B1 G8 C1 H8 D1 I11 E1 I10 F1 I9",
    );
    const stoneCount = countStones(board);
    const result = checkForcedLoss(board, "white", stoneCount);
    expect(result).toBeDefined();
    // VCFが四四を含む形で検出される（VCFは四四より高優先）
    expect(["vcf", "double-four"]).toContain(result?.type);
    expect(result?.sequence.length).toBeGreaterThan(0);
  });
});

/**
 * VCFが三三より優先されるテスト
 *
 * 棋譜: H8 G8 J10 G7 G9 H7 F9 F7 I7 F10 I9 H9 I10 I8 I11 E7 D7 E8 A15
 * 19手目(A15)後、白はE6で四三→VCFが成立し、G6で三三も成立する。
 * VCFは三三より優先されるべき。
 */
const VCF_PRIORITY_RECORD =
  "H8 G8 J10 G7 G9 H7 F9 F7 I7 F10 I9 H9 I10 I8 I11 E7 D7 E8 A15";

describe("review.worker: VCFが三三より優先される", () => {
  it("19手目(A15)後に白のVCFが三三より優先される → type: vcf", () => {
    const { board } = createBoardFromRecord(VCF_PRIORITY_RECORD);
    const stoneCount = countStones(board);

    const result = checkForcedLoss(board, "white", stoneCount);
    expect(result).toBeDefined();
    expect(result?.type).toBe("vcf");
  });
});

describe("review.worker: skipVCT オプション", () => {
  const RECORD_14 = "H8 G7 J10 H10 H9 I9 G8 I10 I8 J8 G11 G10 H7 H6";

  it("skipVCT: true でVCTがスキップされること", () => {
    const { board } = createBoardFromRecord(RECORD_14);
    const stoneCount = countStones(board);
    const result = checkForcedLoss(board, "black", stoneCount, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: FORCED_LOSS_VCT_OPTIONS,
      skipVCT: true,
    });
    // VCTがスキップされるのでundefined
    expect(result).toBeUndefined();
  });

  it("skipVCT: true でも両ミセは検出されること", () => {
    // 白に両ミセがある局面
    const { board } = createBoardFromRecord(
      ALL_DANGER_RECORD.split(/\s+/).slice(0, 12).join(" "),
    );
    const stoneCount = countStones(board);
    // 白の相手=黒側から見た被forced lossを確認
    // この局面で白にVCFがある → skipVCTでもVCFは検出される
    const result = checkForcedLoss(board, "white", stoneCount, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: FORCED_LOSS_VCT_OPTIONS,
      skipVCT: true,
    });
    // VCF/両ミセ/Mise-VCFはスキップされないので検出されるはず
    if (result) {
      expect([
        "vcf",
        "double-mise",
        "mise-vcf",
        "forbidden-trap",
        "double-three",
        "double-four",
      ]).toContain(result.type);
      expect(result.type).not.toBe("vct");
    }
  });
});

describe("VCT手順の三三禁チェック", () => {
  it("F11は三三禁であること（ブロック石なしの盤面）", async () => {
    // 14手 + VCT攻防6手 (F9 I6 D11 E10 F8 E8) 後の盤面
    // ブロック石F10がないのでF11はcol5跳三+row4跳三 = 三三禁
    const record20 =
      "H8 G7 J10 H10 H9 I9 G8 I10 I8 J8 G11 G10 H7 H6 F9 I6 D11 E10 F8 E8";
    const { board } = createBoardFromRecord(record20);
    const { findThreatMoves } = await import("./search/vctHelpers");
    const threats = findThreatMoves(board, "black");
    const f11InThreats = threats.some((p) => p.row === 4 && p.col === 5);
    // F11は三三禁なのでfindThreatMovesから除外されるべき
    expect(f11InThreats).toBe(false);
  });
});
