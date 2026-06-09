/**
 * review 戦術出力スナップショット harness（Issue #37 P0 / #39）
 *
 * 目的: review の戦術解析（P3 #42 で Zig へ移す対象）の**現在の出力を golden 凍結**し、
 * P3 の各移行 PR が「出力不変」を機械的に証明できる安全網にする。本テストはロジックを
 * 一切変えない（現状凍結のみ）。
 *
 * 決定性（flaky 回避）: review の minimax は時間制限探索で非決定なので**対象にしない**。
 * 代わりに P3 直撃の bounded 探索関数（detectForcedWin / checkForcedLoss）を直接呼ぶ。
 * これらは `timeLimit=Infinity` を渡すと探索が node/maxDepth のみで打ち切られ
 * **マシン速度に非依存（決定的）**になる（Zig: time_limit==0 で時刻チェック skip）。
 *
 * 凍結する契約 = 構造的・戦術的フィールドのみ:
 *   detectForcedWin: forcedWinType / forcedWin(firstMove,sequence,isForbiddenTrap,tree) /
 *                    doubleMiseBestMove / doubleMiseMoves
 *   checkForcedLoss: type / sequence
 * 除外（非決定 or P3 非対象）: minimax 由来スコア・候補順序・completedDepth・timings。
 *
 * 正規化: forcedWinTree の防御分岐 `defenses` は探索順依存なので座標でソートして順序非依存化
 * （主筋は ForcedWinInfo.sequence が別途凍結するので分岐集合の一致だけ見れば十分）。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinNode, ReviewCandidate } from "@/types/review";

import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import { countStones } from "../core/boardUtils";
import { detectOpponentThreats } from "../evaluation";
import { findDoubleMiseMoves } from "../evaluation/tactics";
import { detectWhiteWinningPattern } from "../evaluation/winningPatterns";
import {
  findWinningMove,
  getFourDefensePosition,
} from "../search/threatPatterns";
import { hasFourThreeAvailable, hasOpenThree } from "../search/vctHelpers";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import { annotateFukumiMoves } from "./candidateVerification";
import {
  checkCandidateForcedLoss,
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
  type ForcedLossCheckOptions,
} from "./forcedLossCheck";
import { detectForcedWin } from "./forcedWinDetection";

// 決定的設定: timeLimit を Infinity にして探索を node/maxDepth のみで打ち切る
const DETERMINISTIC_LOSS_OPTIONS: ForcedLossCheckOptions = {
  vcfOptions: { ...REVIEW_VCF_OPTIONS, timeLimit: Infinity },
  miseVcfOptions: { ...REVIEW_MISE_VCF_OPTIONS, timeLimit: Infinity },
  vctOptions: { ...FORCED_LOSS_VCT_OPTIONS, timeLimit: Infinity },
};

/** コーパス: 速攻確定する forcing 局面に厳選（決定性＋CI速度の前提） */
const CORPUS: { name: string; record: string; moveCount: number }[] = [
  {
    // #18 Mise-VCF 局面（44手目=白番、G6 ミセ手で追詰）
    name: "mise-vcf-#18",
    record:
      "H8 H9 I9 I8 G7 F6 G10 G9 F9 H11 H7 F7 F10 G8 I10 H10 K11 J10 " +
      "F8 K9 I11 I13 H6 E9 F11 F12 I5 J4 G5 H5 I7 J8 J6 J7 K7 L8 " +
      "F4 E3 G3 H4 I6 K6 L5",
    moveCount: 43,
  },
  {
    // 被追い詰め多数の白番棋譜（reference_review_test_kifu）。複数手数で凍結
    name: "white29-m20",
    record:
      "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12",
    moveCount: 20,
  },
  {
    name: "white29-m24",
    record:
      "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12",
    moveCount: 24,
  },
];

/** 決定的な候補手検証オプション（被必勝層を timeLimit=Infinity で node-bound 化） */
const DETERMINISTIC_CANDIDATE_OPTIONS: ForcedLossCheckOptions = {
  vcfOptions: { ...REVIEW_VCF_OPTIONS, timeLimit: Infinity },
  miseVcfOptions: { ...REVIEW_MISE_VCF_OPTIONS, timeLimit: Infinity },
  vctOptions: { ...FORCED_LOSS_VCT_OPTIONS, timeLimit: Infinity },
};

const sortPos = (
  a: { row: number; col: number },
  b: { row: number; col: number },
): number => a.row - b.row || a.col - b.col;

/** 棋譜の1手（例 "H8"）を盤面座標へ変換（左下原点。fullEval と同じ規約） */
function parseMove(token: string): Position {
  const col = token.charCodeAt(0) - "A".charCodeAt(0);
  const row = 15 - parseInt(token.slice(1), 10);
  return { row, col };
}

/** ThreatInfo の全リストを座標昇順に正規化（探索順非依存化） */
function normalizeThreatInfo(t: {
  openFours: Position[];
  fours: Position[];
  openThrees: Position[];
  mises: Position[];
  doubleThrees: Position[];
}): unknown {
  return {
    openFours: [...t.openFours].sort(sortPos),
    fours: [...t.fours].sort(sortPos),
    openThrees: [...t.openThrees].sort(sortPos),
    mises: [...t.mises].sort(sortPos),
    doubleThrees: [...t.doubleThrees].sort(sortPos),
  };
}

/**
 * 棋譜の moveCount 以降から `color` の着手候補を最大3点抽出する。
 * board（moveCount 手前の局面）で空きのものだけを返す（決定的）。
 */
function candidatePositions(
  board: BoardState,
  moves: string[],
  moveCount: number,
): Position[] {
  const result: Position[] = [];
  // moveCount, +2, +4 は同色（color）の着手
  for (const offset of [0, 2, 4]) {
    const token = moves[moveCount + offset];
    if (!token) {
      continue;
    }
    const pos = parseMove(token);
    if (board[pos.row]?.[pos.col] === null) {
      result.push(pos);
    }
  }
  return result;
}

/** 詰み木を分岐順非依存に正規化（defenses を defenderMove 座標でソート） */
function normalizeTree(node: ForcedWinNode): unknown {
  return {
    attackerMove: node.attackerMove,
    defenses: node.defenses
      .map((d) => ({
        defenderMove: d.defenderMove,
        next: normalizeTree(d.next),
      }))
      .sort((x, y) => sortPos(x.defenderMove, y.defenderMove)),
  };
}

// WASM は1回だけロードして全テストで使い回す
const engine = new WasmSearchEngine(await loadWasmModule());
// #37 P3: 脅威分類 thin wasm も preload し、本番(worker)と同じ Zig 経路で凍結する。
// 合法な実戦コーパスなので Zig==TS（threatAdapter.test で検証済）→ golden は不変。
await preloadThreatWasm();

describe("review 戦術出力スナップショット (#37 P0)", () => {
  it.each(CORPUS)("detectForcedWin: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    const r = detectForcedWin(board, nextColor, false, false, engine);
    const snapshot = {
      forcedWinType: r.forcedWinType ?? null,
      doubleMiseBestMove: r.doubleMiseBestMove,
      doubleMiseMoves: [...r.doubleMiseMoves].sort(sortPos),
      forcedWin: r.forcedWin
        ? {
            firstMove: r.forcedWin.firstMove,
            sequence: r.forcedWin.sequence,
            isForbiddenTrap: r.forcedWin.isForbiddenTrap,
            tree: r.forcedWin.tree
              ? normalizeTree(r.forcedWin.tree)
              : undefined,
          }
        : null,
    };
    expect(snapshot).toMatchSnapshot();
  });

  it.each(CORPUS)("checkForcedLoss: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    // 直前に着手された側の相手 = nextColor が追詰を持つか
    const result = checkForcedLoss(
      board,
      nextColor,
      moveCount,
      engine,
      DETERMINISTIC_LOSS_OPTIONS,
    );
    expect(result ?? null).toMatchSnapshot();
  });
});

/**
 * P3 #42 で Zig へ移す戦術ヘルパーの**直接出力**を凍結する安全網。
 *
 * detectForcedWin / checkForcedLoss は上の describe が top-level（type/sequence）で凍結済だが、
 * P3 の各 PR が置き換えるのは中の戦術プリミティブ（脅威検出・両ミセ・活三/四三・被必勝層）。
 * これらは VCF/VCT と違い**時間非依存の純粋関数**（または timeLimit=Infinity で node-bound 化
 * できる被必勝層）なので、ここで直接凍結すれば各移行 PR の「1ビット不変」を細粒度で検知できる。
 *
 * 対応する P3 PR:
 *   detectOpponentThreats        → PR4（fullEval / forcedLossCheck の脅威検出）
 *   findDoubleMiseMoves          → PR5（両ミセ）
 *   hasOpenThree/hasFourThree    → PR6（filterByCounterThreats / VCT 安全性）
 *   checkCandidateForcedLoss     → PR3/PR4（候補手の被必勝＝opponentForcedWin の出所）
 *   annotateFukumiMoves          → PR3（createsFour/createsOpenThree を使う isFukumi 判定）
 */
describe("review 戦術プリミティブ出力スナップショット (#37 P3 安全網)", () => {
  it.each(CORPUS)("detectOpponentThreats: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    const opponentColor = nextColor === "black" ? "white" : "black";
    const snapshot = {
      // 手番側の脅威（fullEval の selfThreats 経路 / 着手後の自分の四判定）
      self: normalizeThreatInfo(detectOpponentThreats(board, nextColor)),
      // 相手の脅威（fullEval L385 / forcedLossCheck L324 の経路）
      opponent: normalizeThreatInfo(
        detectOpponentThreats(board, opponentColor),
      ),
    };
    expect(snapshot).toMatchSnapshot();
  });

  it.each(CORPUS)("findDoubleMiseMoves: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    const opponentColor = nextColor === "black" ? "white" : "black";
    const snapshot = {
      self: [...findDoubleMiseMoves(board, nextColor)].sort(sortPos),
      opponent: [...findDoubleMiseMoves(board, opponentColor)].sort(sortPos),
    };
    expect(snapshot).toMatchSnapshot();
  });

  it.each(CORPUS)("counterThreatGuards: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    const opponentColor = nextColor === "black" ? "white" : "black";
    const snapshot = {
      hasOpenThreeSelf: hasOpenThree(board, nextColor),
      hasOpenThreeOpponent: hasOpenThree(board, opponentColor),
      hasFourThreeSelf: hasFourThreeAvailable(board, nextColor),
      hasFourThreeOpponent: hasFourThreeAvailable(board, opponentColor),
    };
    expect(snapshot).toMatchSnapshot();
  });

  it.each(CORPUS)(
    "checkCandidateForcedLoss: $name",
    ({ record, moveCount }) => {
      const { board, nextColor } = createBoardFromRecord(record, moveCount);
      const opponentColor = nextColor === "black" ? "white" : "black";
      const moves = record.trim().split(/\s+/);
      const stoneCount = countStones(board);
      // moveCount 以降の手番側着手を候補に、被必勝（opponentForcedWin 相当）を凍結
      const snapshot = candidatePositions(board, moves, moveCount).map(
        (pos) => ({
          position: pos,
          loss:
            checkCandidateForcedLoss(
              board,
              pos,
              nextColor,
              opponentColor,
              stoneCount,
              engine,
              DETERMINISTIC_CANDIDATE_OPTIONS,
            ) ?? null,
        }),
      );
      expect(snapshot).toMatchSnapshot();
    },
  );

  it.each(CORPUS)("annotateFukumiMoves: $name", ({ record, moveCount }) => {
    const { board, nextColor } = createBoardFromRecord(record, moveCount);
    const moves = record.trim().split(/\s+/);
    const candidates: ReviewCandidate[] = candidatePositions(
      board,
      moves,
      moveCount,
    ).map((position) => ({ position, searchScore: 0 }));
    // timeLimit=Infinity を注入して node-bound 決定化
    annotateFukumiMoves(candidates, board, nextColor, engine, {
      ...REVIEW_VCF_OPTIONS,
      timeLimit: Infinity,
    });
    const snapshot = candidates.map((c) => ({
      position: c.position,
      isFukumi: c.isFukumi ?? false,
      fukumiDepth: c.fukumiDepth ?? null,
    }));
    expect(snapshot).toMatchSnapshot();
  });
});

/**
 * 図形プリミティブ出力スナップショット（#43 PR-3 安全網）
 *
 * #43 では `search/`・`evaluation/winningPatterns` の判定ロジック本体は温存し、
 * 内部の葉プリミティブ（checkJumpFour/checkJumpThree/checkStraightFour/checkForbiddenMove）
 * のみを Zig アダプタへ張り替える。張替えが**出力不変**であることを純TS関数の現状出力を
 * 凍結して検知する。realistic CORPUS で覆えない分岐（double-four / findWinningMove /
 * getFourDefensePosition の跳び四・止め四経路）を手作り盤面で固定する。
 *
 * - detectWhiteWinningPattern: forcedLossCheck の live 依存。double-three は CORPUS
 *   (mise-vcf-#18 @11,8) でカバー済。ここでは double-four と各盤面の全空き点を凍結。
 * - findWinningMove / getFourDefensePosition: vcfPuzzle / vctValidation の live 依存。
 */
function boardFromStones(
  white: [number, number][],
  black: [number, number][],
): BoardState {
  const board = createEmptyBoard();
  for (const [r, c] of white) {
    const row = board[r];
    if (row) {
      row[c] = "white";
    }
  }
  for (const [r, c] of black) {
    const row = board[r];
    if (row) {
      row[c] = "black";
    }
  }
  return board;
}

describe("review 図形プリミティブ出力スナップショット (#43 PR-3 安全網)", () => {
  it.each(CORPUS)(
    "detectWhiteWinningPattern (全空き点): $name",
    ({ record, moveCount }) => {
      const { board } = createBoardFromRecord(record, moveCount);
      const hits: { row: number; col: number; type: string }[] = [];
      for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 15; col++) {
          if (board[row]?.[col] === null) {
            const type = detectWhiteWinningPattern(board, row, col);
            if (type) {
              hits.push({ row, col, type });
            }
          }
        }
      }
      expect(hits.sort(sortPos)).toMatchSnapshot();
    },
  );

  it("detectWhiteWinningPattern: double-four", () => {
    // 白が(7,8)に置くと横(7,5-8)と縦(5-8,8)で四四
    const board = boardFromStones(
      [
        [7, 5],
        [7, 6],
        [7, 7],
        [5, 8],
        [6, 8],
        [8, 8],
      ],
      [],
    );
    expect(detectWhiteWinningPattern(board, 7, 8)).toBe("double-four");
  });

  it("findWinningMove: 活四", () => {
    // 白の活四(7,5-8) -> 両端どちらかで五
    const whiteOpenFour = boardFromStones(
      [
        [7, 5],
        [7, 6],
        [7, 7],
        [7, 8],
      ],
      [],
    );
    const blackOpenFour = boardFromStones(
      [],
      [
        [7, 5],
        [7, 6],
        [7, 7],
        [7, 8],
      ],
    );
    expect({
      white: findWinningMove(whiteOpenFour, "white"),
      black: findWinningMove(blackOpenFour, "black"),
    }).toMatchSnapshot();
  });

  it("getFourDefensePosition: 止め四・跳び四", () => {
    // 止め四: 黒(7,5-8)連続四、片端(7,4)を白で塞ぐ -> 防御点(7,9)
    const closedFour = boardFromStones(
      [[7, 4]],
      [
        [7, 5],
        [7, 6],
        [7, 7],
        [7, 8],
      ],
    );
    // 跳び四: 黒 X_XXX (7,5 _ 7,7 7,8 7,9) -> 防御点(7,6)
    const jumpFour = boardFromStones(
      [],
      [
        [7, 5],
        [7, 7],
        [7, 8],
        [7, 9],
      ],
    );
    expect({
      closedFour: getFourDefensePosition(
        closedFour,
        { row: 7, col: 8 },
        "black",
      ),
      jumpFour: getFourDefensePosition(jumpFour, { row: 7, col: 9 }, "black"),
    }).toMatchSnapshot();
  });
});
