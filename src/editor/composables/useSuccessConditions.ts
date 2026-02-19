import type { Position } from "@/types/game";
import type {
  QuestionSection,
  SuccessCondition,
  PositionCondition,
  PatternCondition,
  SequenceCondition,
  VcfCondition,
  VctCondition,
} from "@/types/scenario";

function createBaseCondition(type: SuccessCondition["type"]): SuccessCondition {
  switch (type) {
    case "position":
      return { type: "position", positions: [], color: "black" };
    case "pattern":
      return { type: "pattern", pattern: "", color: "black" };
    case "sequence":
      return { type: "sequence", moves: [], strict: false };
    case "vcf":
      return { type: "vcf", color: "black" };
    case "vct":
      return { type: "vct", color: "black" };
    default:
      return { type: "position", positions: [], color: "black" };
  }
}

/**
 * 成功条件の管理ロジックを提供するComposable
 * Position、Pattern、Sequenceの3種類の成功条件を管理する
 */
export function useSuccessConditions(
  getCurrentSection: () => QuestionSection | null,
  updateSection: (updates: Partial<QuestionSection>) => void,
): {
  isPositionCondition: (
    condition: SuccessCondition,
  ) => condition is PositionCondition;
  isPatternCondition: (
    condition: SuccessCondition,
  ) => condition is PatternCondition;
  isSequenceCondition: (
    condition: SuccessCondition,
  ) => condition is SequenceCondition;
  isVcfCondition: (condition: SuccessCondition) => condition is VcfCondition;
  isVctCondition: (condition: SuccessCondition) => condition is VctCondition;
  addSuccessCondition: () => void;
  removeSuccessCondition: (index: number) => void;
  changeConditionType: (index: number, type: SuccessCondition["type"]) => void;
  updateConditionColor: (index: number, color: "black" | "white") => void;
  updatePositionCondition: (
    index: number,
    updates: Partial<PositionCondition>,
  ) => void;
  addPositionToCondition: (conditionIndex: number) => void;
  updatePositionField: (
    conditionIndex: number,
    positionIndex: number,
    field: "row" | "col",
    value: number,
  ) => void;
  removePositionFromCondition: (
    conditionIndex: number,
    positionIndex: number,
  ) => void;
  updatePatternCondition: (
    index: number,
    updates: Partial<PatternCondition>,
  ) => void;
  addSequenceMove: (index: number) => void;
  updateSequenceMove: (
    conditionIndex: number,
    moveIndex: number,
    field: "row" | "col" | "color",
    value: number | "black" | "white",
  ) => void;
  removeSequenceMove: (conditionIndex: number, moveIndex: number) => void;
  toggleSequenceStrict: (index: number, strict: boolean) => void;
} {
  // ===== 型ガード関数 =====
  const isPositionCondition = (
    condition: SuccessCondition,
  ): condition is PositionCondition => condition.type === "position";

  const isPatternCondition = (
    condition: SuccessCondition,
  ): condition is PatternCondition => condition.type === "pattern";

  const isSequenceCondition = (
    condition: SuccessCondition,
  ): condition is SequenceCondition => condition.type === "sequence";

  const isVcfCondition = (
    condition: SuccessCondition,
  ): condition is VcfCondition => condition.type === "vcf";

  const isVctCondition = (
    condition: SuccessCondition,
  ): condition is VctCondition => condition.type === "vct";

  // ===== 内部ヘルパー関数 =====
  const setSuccessConditions = (conditions: SuccessCondition[]): void => {
    const section = getCurrentSection();
    if (section) {
      updateSection({ successConditions: conditions });
    }
  };

  // ===== 条件の追加・削除・タイプ変更 =====
  const addSuccessCondition = (): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newCondition: PositionCondition = {
      type: "position",
      positions: [],
      color: "black",
    };
    setSuccessConditions([...section.successConditions, newCondition]);
  };

  const removeSuccessCondition = (index: number): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newConditions = section.successConditions.filter(
      (_, i) => i !== index,
    );
    setSuccessConditions(newConditions);
  };

  const changeConditionType = (
    index: number,
    type: SuccessCondition["type"],
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newConditions = [...section.successConditions];
    const baseCondition = createBaseCondition(type);

    newConditions[index] = baseCondition;
    setSuccessConditions(newConditions);
  };

  // ===== Position条件の操作 =====
  const updatePositionCondition = (
    index: number,
    updates: Partial<PositionCondition>,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[index];
    if (!condition || !isPositionCondition(condition)) {
      return;
    }

    const updated: PositionCondition = {
      ...condition,
      ...updates,
      positions: updates.positions ?? condition.positions ?? [],
      color: updates.color ?? condition.color,
    };

    const newConditions = [...section.successConditions];
    newConditions[index] = updated;
    setSuccessConditions(newConditions);
  };

  const addPositionToCondition = (conditionIndex: number): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[conditionIndex];
    if (!condition || !isPositionCondition(condition)) {
      return;
    }

    const positions = [...(condition.positions || [])];
    positions.push({ row: 0, col: 0 });
    updatePositionCondition(conditionIndex, { positions });
  };

  const updatePositionField = (
    conditionIndex: number,
    positionIndex: number,
    field: "row" | "col",
    value: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[conditionIndex];
    if (!condition || !isPositionCondition(condition)) {
      return;
    }

    const positions = [...(condition.positions || [])];
    const nextValue = Math.max(0, Math.min(14, value));
    positions[positionIndex] = {
      ...positions[positionIndex],
      [field]: nextValue,
    } as Position;
    updatePositionCondition(conditionIndex, { positions });
  };

  const removePositionFromCondition = (
    conditionIndex: number,
    positionIndex: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[conditionIndex];
    if (!condition || !isPositionCondition(condition)) {
      return;
    }

    const positions = (condition.positions || []).filter(
      (_, i) => i !== positionIndex,
    );
    updatePositionCondition(conditionIndex, { positions });
  };

  // ===== Pattern条件の操作 =====
  const updatePatternCondition = (
    index: number,
    updates: Partial<PatternCondition>,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[index];
    if (!condition || !isPatternCondition(condition)) {
      return;
    }

    const newConditions = [...section.successConditions];
    newConditions[index] = {
      ...condition,
      ...updates,
      pattern: updates.pattern ?? condition.pattern,
      color: updates.color ?? condition.color,
    };
    setSuccessConditions(newConditions);
  };

  // ===== Sequence条件の操作 =====
  const addSequenceMove = (index: number): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[index];
    if (!condition || !isSequenceCondition(condition)) {
      return;
    }

    const moves = [
      ...condition.moves,
      { row: 0, col: 0, color: "black" as const },
    ];
    const newConditions = [...section.successConditions];
    newConditions[index] = { ...condition, moves };
    setSuccessConditions(newConditions);
  };

  const updateSequenceMove = (
    conditionIndex: number,
    moveIndex: number,
    field: "row" | "col" | "color",
    value: number | "black" | "white",
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[conditionIndex];
    if (!condition || !isSequenceCondition(condition)) {
      return;
    }

    const moves = [...condition.moves];
    const existingMove = moves[moveIndex];
    if (!existingMove) {
      return;
    }
    if (field === "color") {
      moves[moveIndex] = {
        ...existingMove,
        color: value as "black" | "white",
      };
    } else {
      const nextValue = Math.max(0, Math.min(14, value as number));
      moves[moveIndex] = {
        ...existingMove,
        [field]: nextValue,
      } as SequenceCondition["moves"][number];
    }

    const newConditions = [...section.successConditions];
    newConditions[conditionIndex] = { ...condition, moves };
    setSuccessConditions(newConditions);
  };

  const removeSequenceMove = (
    conditionIndex: number,
    moveIndex: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[conditionIndex];
    if (!condition || !isSequenceCondition(condition)) {
      return;
    }

    const moves = condition.moves.filter((_, i) => i !== moveIndex);
    const newConditions = [...section.successConditions];
    newConditions[conditionIndex] = { ...condition, moves };
    setSuccessConditions(newConditions);
  };

  const toggleSequenceStrict = (index: number, strict: boolean): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[index];
    if (!condition || !isSequenceCondition(condition)) {
      return;
    }

    const newConditions = [...section.successConditions];
    newConditions[index] = { ...condition, strict };
    setSuccessConditions(newConditions);
  };

  // ===== VCF/VCT共通: 色の更新 =====
  const updateConditionColor = (
    index: number,
    color: "black" | "white",
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const condition = section.successConditions[index];
    if (!condition || (condition.type !== "vcf" && condition.type !== "vct")) {
      return;
    }

    const newConditions = [...section.successConditions];
    newConditions[index] = { ...condition, color };
    setSuccessConditions(newConditions);
  };

  return {
    // 型ガード
    isPositionCondition,
    isPatternCondition,
    isSequenceCondition,
    isVcfCondition,
    isVctCondition,
    // 条件の追加・削除・タイプ変更
    addSuccessCondition,
    removeSuccessCondition,
    changeConditionType,
    updateConditionColor,
    // Position用
    updatePositionCondition,
    addPositionToCondition,
    updatePositionField,
    removePositionFromCondition,
    // Pattern用
    updatePatternCondition,
    // Sequence用
    addSequenceMove,
    updateSequenceMove,
    removeSequenceMove,
    toggleSequenceStrict,
  };
}
