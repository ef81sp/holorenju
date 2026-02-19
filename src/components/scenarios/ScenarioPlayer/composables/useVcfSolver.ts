/**
 * VCFパズル専用のインタラクションループを管理するComposable
 *
 * useQuestionSolver とは SRP で分離。
 * 四追い問題のマルチステップインタラクション（四→防御→四→...→五連）を制御する。
 */

import { type ComputedRef, computed, ref } from "vue";

import type { CharacterType } from "@/types/character";
import type { BoardState, Position } from "@/types/game";
import type { QuestionSection, VcfCondition } from "@/types/scenario";

import {
  findDummyDefensePosition,
  getDefenseResponse,
  hasRemainingAttacks,
  validateAttackMove,
} from "@/logic/vcfPuzzle";
import { useAudioStore } from "@/stores/audioStore";
import { cloneBoard, useBoardStore } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useProgressStore } from "@/stores/progressStore";
import { useScenarioAnimationStore } from "@/stores/scenarioAnimationStore";

/** VCF石のdialogueIndex（シナリオダイアログとは別のスロット） */
const VCF_DIALOGUE_INDEX = 9000;

function getInvalidMoveMessage(reason: string): string {
  switch (reason) {
    case "occupied":
      return "その場所には既に石があります";
    case "forbidden":
      return "禁手です";
    case "not-four":
      return "四になる手を打ってください";
    default:
      return "無効な手です";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const useVcfSolver = (
  scenarioId: string,
  onSectionComplete: () => void,
  onShowCorrectCutin?: () => void,
  onShowIncorrectCutin?: () => void,
): {
  handleVcfPlaceStone: (
    position: Position,
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ) => Promise<void>;
  resetVcf: () => void;
  isResetAvailable: ComputedRef<boolean>;
} => {
  const boardStore = useBoardStore();
  const dialogStore = useDialogStore();
  const progressStore = useProgressStore();
  const audioStore = useAudioStore();
  const animationStore = useScenarioAnimationStore();

  // VCF中の初期盤面（リセット用）
  let vcfBaseBoard: BoardState | null = null;

  // 1手以上打ったかどうか（リセットボタン表示用）
  const hasMoves = ref(false);

  // VCFモードの石ID用カウンタ
  let vcfMoveCounter = 0;

  // カウンターフォー後のCPU勝ち手位置（プレイヤーの次の手を待つ）
  let pendingCounterFive: Position | null = null;

  const isResetAvailable = computed(() => hasMoves.value);

  // ===== ヘルパー =====

  type PlayerColor = "black" | "white";

  function getAttackerColor(section: QuestionSection): PlayerColor {
    const vcfCondition = section.successConditions.find(
      (c) => c.type === "vcf",
    ) as VcfCondition | undefined;
    return vcfCondition?.color ?? "black";
  }

  function getOpponentColor(attackerColor: PlayerColor): PlayerColor {
    return attackerColor === "black" ? "white" : "black";
  }

  /** 石を配置する（addStones使用） */
  function placeStone(position: Position, color: PlayerColor): void {
    const row = boardStore.board[position.row];
    if (row) {
      row[position.col] = color;
    }
    boardStore.addStones(
      [{ position, color }],
      VCF_DIALOGUE_INDEX + vcfMoveCounter,
    );
    vcfMoveCounter++;
  }

  /** 防御石をアニメーション付きで配置する */
  async function placeDefenseStone(
    defensePos: Position,
    opponentColor: PlayerColor,
  ): Promise<void> {
    await delay(300);
    const stoneId = `${VCF_DIALOGUE_INDEX + vcfMoveCounter}-${defensePos.row}-${defensePos.col}`;
    animationStore.prepareForAnimation([stoneId]);
    const row = boardStore.board[defensePos.row];
    if (row) {
      row[defensePos.col] = opponentColor;
    }
    const addedStones = boardStore.addStones(
      [{ position: defensePos, color: opponentColor }],
      VCF_DIALOGUE_INDEX + vcfMoveCounter,
    );
    vcfMoveCounter++;
    audioStore.playSfx("stone-place");
    await animationStore.animateStones(addedStones, { animate: true });
  }

  // ===== 不正手処理 =====

  async function handleInvalidMove(
    position: Position,
    reason: string,
  ): Promise<void> {
    // クロスマーク表示（×カットインなし）
    boardStore.addMarks(
      [{ positions: [position], markType: "cross" }],
      VCF_DIALOGUE_INDEX + vcfMoveCounter,
    );
    audioStore.playSfx("incorrect");

    const message = getInvalidMoveMessage(reason);

    dialogStore.showMessage({
      id: `vcf-invalid-${Date.now()}`,
      character: "fubuki" as CharacterType,
      text: [{ type: "text", content: message }],
      emotion: 4,
    });

    // 500ms後にクロスマーク削除
    await delay(500);
    boardStore.removeMarks([{ positions: [position], markType: "cross" }]);
  }

  // ===== 成功処理 =====

  function handleSuccess(section: QuestionSection): void {
    onSectionComplete();
    onShowCorrectCutin?.();

    const [msg] = section.feedback.success;
    if (msg) {
      dialogStore.showMessage({
        id: `feedback-success-${msg.character}`,
        character: msg.character as CharacterType,
        text: msg.text,
        emotion: msg.emotion,
      });
    }

    progressStore.completeSection(scenarioId, section.id);
  }

  // ===== 失敗処理（カウンターフォー） =====

  function handleCounterFiveFailure(section: QuestionSection): void {
    onShowIncorrectCutin?.();

    const [msg] = section.feedback.failure;
    if (msg) {
      dialogStore.showMessage({
        id: `feedback-failure-${msg.character}`,
        character: msg.character as CharacterType,
        text: msg.text,
        emotion: msg.emotion,
      });
    }
  }

  // ===== メインフロー =====

  async function handleVcfPlaceStone(
    position: Position,
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ): Promise<void> {
    // ガード: セクション完了済み / アニメーション中
    if (isSectionCompleted) {
      return;
    }
    if (animationStore.animatingIds.size > 0) {
      return;
    }

    // 初回なら vcfBaseBoard を保存
    if (!vcfBaseBoard) {
      vcfBaseBoard = cloneBoard(boardStore.board);
    }

    const attackerColor = getAttackerColor(questionSection);
    const opponentColor = getOpponentColor(attackerColor);

    // 攻め手検証
    const result = validateAttackMove(
      boardStore.board,
      position,
      attackerColor,
    );

    // カウンターフォー保留中の処理
    if (pendingCounterFive) {
      if (result.valid && result.type === "five") {
        // プレイヤーが五連達成 → 成功（CPUの脅威より先に勝利）
        pendingCounterFive = null;
        placeStone(position, attackerColor);
        audioStore.playSfx("stone-place");
        handleSuccess(questionSection);
        return;
      }

      // 五連以外 → CPUが五連を完成させて失敗
      const winPos = pendingCounterFive;
      pendingCounterFive = null;
      await placeDefenseStone(winPos, opponentColor);
      handleCounterFiveFailure(questionSection);
      return;
    }

    if (result.valid === false) {
      await handleInvalidMove(position, result.reason);
      return;
    }

    hasMoves.value = true;

    // 石を配置
    placeStone(position, attackerColor);
    audioStore.playSfx("stone-place");

    // 五連達成 → 成功
    if (result.type === "five") {
      handleSuccess(questionSection);
      return;
    }

    // 四を作った → 防御応手を計算
    const defense = getDefenseResponse(
      boardStore.board,
      position,
      attackerColor,
    );

    switch (defense.type) {
      case "blocked":
        // 通常の防御 → 防御石をアニメーション付きで配置
        await placeDefenseStone(defense.position, opponentColor);
        // 攻め手が尽きた場合は失敗
        if (!hasRemainingAttacks(boardStore.board, attackerColor)) {
          handleCounterFiveFailure(questionSection);
        }
        break;

      case "open-four": {
        // 活四 → ダミー防御石を配置、次の手で五連を完成させる
        const dummyPos = findDummyDefensePosition(
          boardStore.board,
          defense.winPositions,
        );
        if (dummyPos) {
          await placeDefenseStone(dummyPos, opponentColor);
        }
        break;
      }

      case "counter-five":
        // 防御石のみ配置、CPUの勝ち手を保留してプレイヤーの手を待つ
        await placeDefenseStone(defense.defensePos, opponentColor);
        pendingCounterFive = defense.winPos;
        break;

      case "forbidden-trap":
        // 禁手陥穽 → 即座に成功
        handleSuccess(questionSection);
        break;
      default:
        break;
    }
  }

  // ===== リセット =====

  function resetVcf(): void {
    if (vcfBaseBoard) {
      boardStore.setBoard(cloneBoard(vcfBaseBoard), "question");
    }
    boardStore.clearMarks();
    boardStore.clearLines();
    hasMoves.value = false;
    vcfMoveCounter = 0;
    pendingCounterFive = null;
  }

  return {
    handleVcfPlaceStone,
    resetVcf,
    isResetAvailable,
  };
};
