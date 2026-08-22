/**
 * 強制勝ち検出（VCF/VCT/両ミセ/Mise-VCF）
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinNode, ForcedWinType } from "@/types/review";

import type { VCTSearchOptions, VCTSequenceResult } from "../search/types";
import type { WasmSearchEngine } from "../wasm/searchEngine";

import { validateVCTSequence } from "../search/vctValidation";
// #37 P3 PR5/PR5b/PR6: 四三判定・両ミセ手・脅威手列挙を Zig 単一ソース経由に（合法局面で TS と一致、未ロード時 TS フォールバック）。
import {
  createsFourThree,
  findDoubleMiseMoves,
  findThreatMoves,
} from "../wasm/threatAdapter";
import {
  filterByCounterThreats,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./forcedLossCheck";
import { REVIEW_VCT_OPTIONS_WITH_BRANCHES } from "./reviewConstants";
import {
  wasmFindVCFSequence,
  wasmFindMiseVCFSequence,
  wasmFindVCTSequence,
  wasmFindVCTSequenceFromFirstMove,
} from "./wasmAdapters";

export interface ForcedWinInfo {
  firstMove: Position;
  sequence: Position[];
  isForbiddenTrap: boolean;
  /** 詰み木（#22。VCT/Mise-VCF は Zig 由来。VCF/両ミセ/単一初手は fullEval で合成） */
  tree?: ForcedWinNode;
}

export interface ForcedWinDetectionResult {
  forcedWin: ForcedWinInfo | null;
  forcedWinType: ForcedWinType | undefined;
  doubleMiseMoves: Position[];
  doubleMiseBestMove: Position | null;
}

/** フォールバック時の最大初手検証数 */
const VCT_FALLBACK_MAX_FIRST_MOVES = 40;

/**
 * フォールバックの初手 1 手あたりの VCT 探索ノード数上限
 *
 * 歯止めは 1 手あたり 5s の時間上限（`perMoveOptions.timeLimit`）で、
 * こちらは暴走時の安全弁。#119 で VCT 経路のノード計上が機能するように
 * なった結果、旧 100_000 は 5s よりはるかに手前で効く実効上限になり、
 * それまで数秒で検出できていた追い詰めが出なくなる回帰が出たため引き上げた
 * （実測: 14 石局面の初手 (8,9) は 500k では未検出、1M で約 2.3s / len13）。
 */
const VCT_FALLBACK_MAX_NODES = 2_000_000;

/**
 * 脅威手を1手ずつ findVCTSequenceFromFirstMove で検証する
 *
 * findVCTSequence の補完。findVCTSequence は全脅威手を再帰的に探索
 * するため、リスト後方にある VCT を見つけられないことがある。
 * 本関数は各脅威手に独自の TimeLimiter を割り当てるため、
 * 前の手の探索に影響されない。
 *
 * findVCTSequence との違い:
 * - 最初に見つかった有効な VCT で即座に返す（最短探索はしない）
 * - 最大 VCT_FALLBACK_MAX_FIRST_MOVES 手まで検証
 *
 * 詰み木は二段構えで作る（issue #122 レバー1）。分岐収集モードは全受けを
 * 完全展開するぶん重いので、総当たりの検証は非収集モードで回し、
 * 有効な初手が決まったときだけその 1 手を収集モードで引き直す。
 * 引き直しが空振りしたら非収集の結果をそのまま使う（木なし＝従来の表示）。
 */
function findVCTByFirstMoveIteration(
  board: BoardState,
  color: "black" | "white",
  options: VCTSearchOptions,
  wasmSearchEngine: WasmSearchEngine,
): VCTSequenceResult | null {
  const threats = findThreatMoves(board, color);
  const perMoveOptions: VCTSearchOptions = {
    ...options,
    // 元は Infinity。密局面で maxNodes が消化されず単発タスクが 60-120s に伸びる
    // 問題の対策 (#104)。fallback iteration 全体では複数手ぶん時間が積み上がるので、
    // 1 手あたりは短めに切る。
    timeLimit: 5_000,
    maxNodes: VCT_FALLBACK_MAX_NODES,
    vcfOptions: {
      ...options.vcfOptions,
    },
    collectBranches: false,
  };
  const searchFrom = (
    firstMove: Position,
    searchOptions: VCTSearchOptions,
  ): VCTSequenceResult | null =>
    wasmFindVCTSequenceFromFirstMove(
      wasmSearchEngine,
      board,
      firstMove,
      color,
      searchOptions,
    );

  // 詰み木の引き直しは「VCT と確定した初手 1 手」に対する確認パスで、
  // 40 手の総当たりには乗らない。総当たり用の切り詰めた予算（5s）だと
  // 収集モードのぶん（実測 約1.8倍）を賄えず木が付かないので、
  // 主経路と同じ予算（REVIEW_VCT_OPTIONS_WITH_BRANCHES）を与える。
  const treeOptions: VCTSearchOptions = { ...options, collectBranches: true };

  for (let i = 0; i < threats.length && i < VCT_FALLBACK_MAX_FIRST_MOVES; i++) {
    const threat = threats[i]!;
    const result = searchFrom(threat, perMoveOptions);
    if (result && validateVCTSequence(board, color, result.sequence)) {
      const withTree = searchFrom(threat, treeOptions);
      // 収集モードは ct=none の子探索も全受け展開になるため、手順が
      // 同値な別解に変わりうる。木が付いていて、かつ検証を通ったときだけ
      // 差し替える（木が無いなら手順だけ別解に変える意味がない）。
      if (
        withTree?.tree &&
        validateVCTSequence(board, color, withTree.sequence)
      ) {
        return withTree;
      }
      return result;
    }
  }
  return null;
}

/**
 * 局面から強制勝ちを検出する
 *
 * 優先順: 1手四三 > 両ミセ ≥ 長VCF > Mise-VCF > VCT
 */
export function detectForcedWin(
  board: BoardState,
  color: "black" | "white",
  opponentHasFour: boolean,
  isLightEval: boolean,
  wasmSearchEngine: WasmSearchEngine,
): ForcedWinDetectionResult {
  // 両ミセ検出（VCF探索より前に1回だけ呼ぶ、~5ms）
  // 相手に活三やミセ手がある場合、両ミセ手で脅威も潰していなければ不成立
  // （相手は四三防御を無視して棒四や四三を打てるため）
  const doubleMiseMoves =
    !isLightEval && !opponentHasFour
      ? filterByCounterThreats(board, color, findDoubleMiseMoves(board, color))
      : [];
  const doubleMiseBestMove =
    doubleMiseMoves.length > 0 ? (doubleMiseMoves[0] ?? null) : null;

  // 拡張VCF/VCT探索（高速パス）
  // 相手の四がある場合はVCF/VCTをスキップ（四を止めなければ即負け）
  // 両ミセがある場合: maxDepth 2 で1手四三を検出（四三はVCF的に3手=depth 2）
  // 両ミセがない場合: 通常のVCF全探索
  // lightEval時: timeLimit を制限（Mise-VCFスキップのため VCF のみで判定）
  let vcfOptions = REVIEW_VCF_OPTIONS;
  if (isLightEval) {
    vcfOptions = { ...REVIEW_VCF_OPTIONS, timeLimit: 2000, maxNodes: 50_000 };
  } else if (doubleMiseBestMove) {
    vcfOptions = { ...REVIEW_VCF_OPTIONS, maxDepth: 2 };
  }
  let vcfResult = null;
  if (!opponentHasFour) {
    vcfResult = wasmFindVCFSequence(wasmSearchEngine, board, color, vcfOptions);
  }

  // 1手四三: VCFの初手が四三を作る場合、両ミセより優先
  // （VCF sequence ≤ 1 は即五/活四、≤ 3 かつ初手が四三なら1手四三）
  const isImmediateFourThree =
    vcfResult &&
    (vcfResult.sequence.length <= 1 ||
      (doubleMiseBestMove &&
        createsFourThree(
          board,
          vcfResult.firstMove.row,
          vcfResult.firstMove.col,
          color,
        )));

  // Mise-VCF検出（VCFも両ミセもない場合のみ、lightEvalではスキップ）
  let miseVcfResult = null;
  if (!isLightEval && !vcfResult && !doubleMiseBestMove && !opponentHasFour) {
    miseVcfResult = wasmFindMiseVCFSequence(
      wasmSearchEngine,
      board,
      color,
      // 振り返り表示で三の代替防御を分岐タブに出すため分岐収集を有効化（issue #18）
      { ...REVIEW_MISE_VCF_OPTIONS, collectBranches: true },
    );
  }

  // forcedWin 構築（優先順: 1手四三 > 両ミセ ≥ 長VCF > Mise-VCF > VCT）
  let forcedWin: ForcedWinInfo | null = null;
  if (isImmediateFourThree) {
    forcedWin = vcfResult;
  } else if (doubleMiseBestMove) {
    forcedWin = {
      firstMove: doubleMiseBestMove,
      sequence: [doubleMiseBestMove],
      isForbiddenTrap: false,
    };
  } else {
    forcedWin =
      vcfResult ??
      miseVcfResult ??
      // VCT探索はlightEvalではスキップ（重いため、fullEvalで検出する）
      (!isLightEval && !opponentHasFour
        ? (wasmFindVCTSequence(
            wasmSearchEngine,
            board,
            color,
            REVIEW_VCT_OPTIONS_WITH_BRANCHES,
          ) ??
          findVCTByFirstMoveIteration(
            board,
            color,
            REVIEW_VCT_OPTIONS_WITH_BRANCHES,
            wasmSearchEngine,
          ))
        : null);
  }

  // 詰み木が劣化した状態で作られていたら知らせる（issue #122 レバー4）。
  // 詰み判定は壊れないが表示の受け分岐が欠けるので、症状が出たときに
  // 原因を特定できるようにログだけ残す（ユーザー向けの表示は変えない）。
  if (forcedWin?.tree) {
    const health = wasmSearchEngine.lastForcedWinTreeHealth();
    if (health.overflow || health.defenseTruncated) {
      console.warn(
        "[review] 詰み木の分岐が一部欠けています",
        JSON.stringify({ ...health, firstMove: forcedWin.firstMove }),
      );
    }
  }

  // forcedWinType 判定
  let forcedWinType: ForcedWinType | undefined = undefined;
  if (forcedWin?.isForbiddenTrap) {
    forcedWinType = "forbidden-trap";
  } else if (isImmediateFourThree) {
    forcedWinType = "vcf";
  } else if (doubleMiseBestMove) {
    forcedWinType = "double-mise";
  } else if (vcfResult) {
    forcedWinType = "vcf";
  } else if (miseVcfResult) {
    forcedWinType = "mise-vcf";
  } else if (forcedWin) {
    forcedWinType = "vct";
  }

  return { forcedWin, forcedWinType, doubleMiseMoves, doubleMiseBestMove };
}
