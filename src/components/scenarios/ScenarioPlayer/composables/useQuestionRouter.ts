/**
 * 問題タイプに基づくソルバーへのルーティング
 *
 * ScenarioPlayer.vue の行数増加を抑制するため、
 * 条件タイプに基づいて useQuestionSolver と useVcfSolver を切り替える。
 */

import { type ComputedRef, computed, ref } from "vue";

import type { Position } from "@/types/game";
import type { QuestionSection } from "@/types/scenario";

import { useQuestionSolver } from "./useQuestionSolver";
import { useVcfSolver } from "./useVcfSolver";

function hasVcfCondition(section: QuestionSection): boolean {
  return section.successConditions.some((c) => c.type === "vcf");
}

function hasVctCondition(section: QuestionSection): boolean {
  return section.successConditions.some((c) => c.type === "vct");
}

export const useQuestionRouter = (
  scenarioId: string,
  onSectionComplete: () => void,
  onShowCorrectCutin?: () => void,
  onShowIncorrectCutin?: () => void,
): {
  handlePlaceStone: (
    position: Position,
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ) => void;
  submitAnswer: (
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ) => void;
  resetPuzzle: (questionSection: QuestionSection) => void;
  isResetAvailable: ComputedRef<boolean>;
  isVctUnsupported: (section: QuestionSection) => boolean;
} => {
  const questionSolver = useQuestionSolver(
    scenarioId,
    onSectionComplete,
    onShowCorrectCutin,
    onShowIncorrectCutin,
  );

  const vcfSolver = useVcfSolver(
    scenarioId,
    onSectionComplete,
    onShowCorrectCutin,
  );

  // VCFモードで1手以上打っているかの追跡
  const vcfActive = ref(false);

  const isResetAvailable = computed(
    () => vcfActive.value && vcfSolver.isResetAvailable.value,
  );

  function handlePlaceStone(
    position: Position,
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ): void {
    if (hasVctCondition(questionSection)) {
      // VCTは未実装 — 操作不可
      return;
    }

    if (hasVcfCondition(questionSection)) {
      vcfActive.value = true;
      void vcfSolver.handleVcfPlaceStone(
        position,
        questionSection,
        isSectionCompleted,
      );
      return;
    }

    questionSolver.handlePlaceStone(
      position,
      questionSection,
      isSectionCompleted,
    );
  }

  function submitAnswer(
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ): void {
    // VCF/VCTモードでは回答ボタン不要
    if (hasVcfCondition(questionSection) || hasVctCondition(questionSection)) {
      return;
    }

    questionSolver.submitAnswer(questionSection, isSectionCompleted);
  }

  function resetPuzzle(questionSection: QuestionSection): void {
    if (hasVcfCondition(questionSection)) {
      vcfSolver.resetVcf();
      vcfActive.value = false;
    }
  }

  function isVctUnsupported(section: QuestionSection): boolean {
    return hasVctCondition(section);
  }

  return {
    handlePlaceStone,
    submitAnswer,
    resetPuzzle,
    isResetAvailable,
    isVctUnsupported,
  };
};
