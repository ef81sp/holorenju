/**
 * シナリオパーサー・バリデーター
 *
 * 2段階のバリデーション機能：
 * 1. validateScenario: JSON/オブジェクトをScenario型にパースする（実行時用）
 * 2. validateBoardState: 盤面の妥当性を検証する（JSON編集時用）
 */

import type { EmotionId } from "../types/character";
import type {
  Scenario,
  DemoSection,
  DemoDialogue,
  ProblemSection,
  Section,
  BoardAction,
  SuccessCondition,
  Position,
  ProblemFeedback,
  DialogueLine,
} from "../types/scenario";
import type { TextNode } from "../types/text";

// ===== パース・バリデーション =====

/**
 * JSONをScenario型にパースしてバリデーション
 * 失敗時は例外を投げる
 */
export function parseScenario(data: unknown): Scenario {
  if (!isObject(data)) {
    throw new Error("Scenario must be an object");
  }

  const id = validateString(data, "id", "Scenario.id");
  const title = validateString(data, "title", "Scenario.title");
  const difficulty = validateDifficulty(data, "difficulty");
  const description = validateString(
    data,
    "description",
    "Scenario.description",
  );
  const objectives = validateStringArray(
    data,
    "objectives",
    "Scenario.objectives",
  );
  const sections = validateSectionArray(data, "sections", "Scenario.sections");

  return {
    id,
    title,
    difficulty,
    description,
    objectives,
    sections,
  };
}

/**
 * セクション配列をバリデーション
 */
function validateSectionArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): Section[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((item, index) => validateSection(item, `${path}[${index}]`));
}

/**
 * セクションをバリデーション
 */
function validateSection(data: unknown, path: string): Section {
  if (!isObject(data)) {
    throw new Error(`${path} must be an object`);
  }

  const type = validateEnum(data, "type", ["demo", "problem"], path);

  if (type === "demo") {
    return validateDemoSection(data, path);
  }
  return validateProblemSection(data, path);
}

/**
 * デモセクションをバリデーション
 */
function validateDemoSection(
  data: Record<string, unknown>,
  path: string,
): DemoSection {
  const id = validateString(data, "id", `${path}.id`);
  const title = validateString(data, "title", `${path}.title`);
  const initialBoard = validateBoardArray(
    data,
    "initialBoard",
    `${path}.initialBoard`,
  );
  const dialogues = validateDialogueArray(
    data,
    "dialogues",
    `${path}.dialogues`,
  );

  return {
    id,
    type: "demo",
    title,
    initialBoard,
    dialogues,
  };
}

/**
 * 問題セクションをバリデーション
 */
function validateProblemSection(
  data: Record<string, unknown>,
  path: string,
): ProblemSection {
  const id = validateString(data, "id", `${path}.id`);
  const title = validateString(data, "title", `${path}.title`);
  const initialBoard = validateBoardArray(
    data,
    "initialBoard",
    `${path}.initialBoard`,
  );
  const description = validateString(
    data,
    "description",
    `${path}.description`,
  );
  const successOperator =
    data.successOperator === "and" || data.successOperator === "or"
      ? data.successOperator
      : "or";
  const successConditions = validateSuccessConditionArray(
    data,
    "successConditions",
    `${path}.successConditions`,
  );
  const feedback = validateFeedback(data, "feedback", `${path}.feedback`);
  const dialogues =
    data.dialogues === undefined
      ? []
      : validateDialogueArray(data, "dialogues", `${path}.dialogues`);

  return {
    id,
    type: "problem",
    title,
    initialBoard,
    description,
    dialogues,
    successOperator,
    successConditions,
    feedback,
  };
}

/**
 * ダイアログ配列をバリデーション
 */
function validateDialogueArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): DemoDialogue[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((item, index) =>
    validateDialogue(item, `${path}[${index}]`),
  );
}

/**
 * ダイアログをバリデーション
 */
function validateDialogue(data: unknown, path: string): DemoDialogue {
  if (!isObject(data)) {
    throw new Error(`${path} must be an object`);
  }

  const id = validateString(data, "id", `${path}.id`);
  const character = validateEnum(
    data,
    "character",
    ["fubuki", "miko", "narration"],
    `${path}.character`,
  );
  const text = validateTextNodeArray(data, "text", `${path}.text`);
  // Emotionは0-39の数値、デフォルトは0
  const emotion =
    typeof data.emotion === "number"
      ? Math.min(39, Math.max(0, data.emotion))
      : 0;
  const boardAction = data.boardAction
    ? validateBoardAction(data.boardAction, `${path}.boardAction`)
    : undefined;

  return {
    id,
    character,
    text,
    emotion: emotion as unknown as EmotionId,
    boardAction,
  };
}

/**
 * 盤面操作をバリデーション
 */
function validateBoardAction(data: unknown, path: string): BoardAction {
  if (!isObject(data)) {
    throw new Error(`${path} must be an object`);
  }

  const type = validateEnum(
    data,
    "type",
    ["place", "remove", "setBoard", "mark", "line"],
    path,
  );

  switch (type) {
    case "place": {
      const position = validatePosition(data.position, `${path}.position`);
      const color = validateEnum(
        data,
        "color",
        ["black", "white"],
        `${path}.color`,
      );
      const highlight = data.highlight ? Boolean(data.highlight) : undefined;
      return { type: "place", position, color, highlight };
    }

    case "remove": {
      const position = validatePosition(data.position, `${path}.position`);
      return { type: "remove", position };
    }

    case "setBoard": {
      const board = validateBoardArray(data, "board", `${path}.board`);
      return { type: "setBoard", board };
    }

    case "mark": {
      const positions = validatePositionArray(
        data,
        "positions",
        `${path}.positions`,
      );
      const markType = validateEnum(
        data,
        "markType",
        ["circle", "cross", "arrow"],
        `${path}.markType`,
      );
      const label = data.label
        ? validateString(data, "label", `${path}.label`)
        : undefined;
      return { type: "mark", positions, markType, label };
    }

    case "line": {
      const fromPosition = validatePosition(
        data.fromPosition,
        `${path}.fromPosition`,
      );
      const toPosition = validatePosition(
        data.toPosition,
        `${path}.toPosition`,
      );
      const action = validateEnum(
        data,
        "action",
        ["draw", "remove"],
        `${path}.action`,
      );
      const style = data.style
        ? validateEnum(data, "style", ["solid", "dashed"], `${path}.style`)
        : undefined;
      return { type: "line", fromPosition, toPosition, action, style };
    }
    default:
      throw new Error(`Unknown board action type: ${type}`);
  }
}

/**
 * 成功条件配列をバリデーション
 */
function validateSuccessConditionArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): SuccessCondition[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  if (value.length === 0) {
    throw new Error(`${path} must not be empty`);
  }

  return value.map((item, index) =>
    validateSuccessCondition(item, `${path}[${index}]`),
  );
}

/**
 * 成功条件をバリデーション
 */
function validateSuccessCondition(
  data: unknown,
  path: string,
): SuccessCondition {
  if (!isObject(data)) {
    throw new Error(`${path} must be an object`);
  }

  const type = validateEnum(
    data,
    "type",
    ["position", "pattern", "sequence"],
    path,
  );

  switch (type) {
    case "position": {
      const positions = validatePositionArray(
        data,
        "positions",
        `${path}.positions`,
      );
      const color = validateEnum(
        data,
        "color",
        ["black", "white"],
        `${path}.color`,
      );
      return { type: "position", positions, color };
    }

    case "pattern": {
      const pattern = validateString(data, "pattern", `${path}.pattern`);
      const color = validateEnum(
        data,
        "color",
        ["black", "white"],
        `${path}.color`,
      );
      return { type: "pattern", pattern, color };
    }

    case "sequence": {
      const moves = validateMoveArray(data, "moves", `${path}.moves`);
      const strict = Boolean(data.strict);
      return { type: "sequence", moves, strict };
    }
    default:
      throw new Error(`Unknown success condition type: ${type}`);
  }
}

/**
 * 手の配列をバリデーション
 */
function validateMoveArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): (Position & { color: "black" | "white" })[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`${path}[${index}] must be an object`);
    }

    const position = validatePosition(
      item.position,
      `${path}[${index}].position`,
    );
    const color = validateEnum(
      item,
      "color",
      ["black", "white"],
      `${path}[${index}].color`,
    );

    return { ...position, color };
  });
}

/**
 * ヒント配列をバリデーション
 */
/**
 * フィードバックをバリデーション
 */
function validateFeedback(
  data: Record<string, unknown>,
  key: string,
  path: string,
): ProblemFeedback {
  const value = data[key];

  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }

  const success = validateDialogueLineArray(
    value,
    "success",
    `${path}.success`,
  );
  const failure = validateDialogueLineArray(
    value,
    "failure",
    `${path}.failure`,
  );
  const progress = value.progress
    ? validateDialogueLineArray(value, "progress", `${path}.progress`)
    : undefined;

  return { success, failure, progress };
}

/**
 * ダイアログラインの配列をバリデーション
 */
function validateDialogueLineArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): DialogueLine[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`${path}[${index}] must be an object`);
    }

    const text = validateTextNodeArray(item, "text", `${path}[${index}].text`);
    // Emotionは0-39の数値、デフォルトは0
    const emotion =
      typeof item.emotion === "number"
        ? Math.min(39, Math.max(0, item.emotion))
        : 0;

    return {
      character: validateEnum(
        item,
        "character",
        ["fubuki", "miko", "narration"],
        `${path}[${index}].character`,
      ),
      text,
      emotion: emotion as unknown as EmotionId,
    };
  });
}

// ===== 盤面バリデーション =====

const BOARD_SIZE = 15;
const VALID_BOARD_CHARS = /^[-xo]*$/; // -(未指定), x(黒), o(白)

/**
 * 盤面の妥当性を検証（JSON編集時の検証用）
 * エラーメッセージの配列を返す（複数エラーを一度に報告できる）
 */
export function validateBoardState(board: unknown[]): string[] {
  const errors: string[] = [];

  if (!Array.isArray(board)) {
    return ["Board must be an array"];
  }

  if (board.length !== BOARD_SIZE) {
    errors.push(
      `Board must have exactly ${BOARD_SIZE} rows, got ${board.length}`,
    );
  }

  board.forEach((row, rowIndex) => {
    if (typeof row !== "string") {
      errors.push(`Board[${rowIndex}] must be a string, got ${typeof row}`);
      return;
    }

    if (row.length !== BOARD_SIZE) {
      errors.push(
        `Board[${rowIndex}] must have exactly ${BOARD_SIZE} characters, got ${row.length}`,
      );
    }

    if (!VALID_BOARD_CHARS.test(row)) {
      errors.push(
        `Board[${rowIndex}] contains invalid characters. Use only '-' (unspecified), 'x' (black), 'o' (white)`,
      );
    }
  });

  return errors;
}

/**
 * TextNodeArray をバリデーション
 */
function validateTextNodeArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): TextNode[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`${path}[${index}] must be an object`);
    }

    const type = validateEnum(
      item,
      "type",
      ["text", "ruby", "emphasis"],
      `${path}[${index}].type`,
    );

    if (type === "text") {
      const content = validateString(
        item,
        "content",
        `${path}[${index}].content`,
      );
      return { type: "text", content } as TextNode;
    } else if (type === "ruby") {
      const base = validateString(item, "base", `${path}[${index}].base`);
      const ruby = validateString(item, "ruby", `${path}[${index}].ruby`);
      return { type: "ruby", base, ruby } as TextNode;
    }
    const content = validateString(
      item,
      "content",
      `${path}[${index}].content`,
    );
    return { type: "emphasis", content } as TextNode;
  });
}

// ===== ヘルパー関数 =====

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function validateString(
  data: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = data[key];

  if (typeof value !== "string") {
    throw new Error(`${path} must be a string, got ${typeof value}`);
  }

  if (value.length === 0) {
    throw new Error(`${path} must not be empty`);
  }

  return value;
}

function validateNumber(
  data: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = data[key];

  if (typeof value !== "number") {
    throw new Error(`${path} must be a number, got ${typeof value}`);
  }

  return value;
}

function validateStringArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  value.forEach((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${path}[${index}] must be a string, got ${typeof item}`);
    }
  });

  return value;
}

function validateEnum<T extends string>(
  data: Record<string, unknown>,
  key: string,
  allowedValues: T[],
  path: string,
): T {
  const value = data[key];

  if (typeof value !== "string") {
    throw new Error(`${path} must be a string, got ${typeof value}`);
  }

  if (!allowedValues.includes(value as T)) {
    throw new Error(
      `${path} must be one of [${allowedValues.join(", ")}], got "${value}"`,
    );
  }

  return value as T;
}

function validateDifficulty(
  data: Record<string, unknown>,
  key: string,
): "beginner" | "intermediate" | "advanced" {
  return validateEnum(
    data,
    key,
    ["beginner", "intermediate", "advanced"],
    `Scenario.${key}`,
  );
}

function validatePosition(data: unknown, path: string): Position {
  if (!isObject(data)) {
    throw new Error(`${path} must be an object`);
  }

  const row = validateNumber(data, "row", `${path}.row`);
  const col = validateNumber(data, "col", `${path}.col`);

  if (row < 0 || row >= BOARD_SIZE) {
    throw new Error(
      `${path}.row must be between 0 and ${BOARD_SIZE - 1}, got ${row}`,
    );
  }

  if (col < 0 || col >= BOARD_SIZE) {
    throw new Error(
      `${path}.col must be between 0 and ${BOARD_SIZE - 1}, got ${col}`,
    );
  }

  return { row, col };
}

function validatePositionArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): Position[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  if (value.length === 0) {
    throw new Error(`${path} must not be empty`);
  }

  return value.map((item, index) =>
    validatePosition(item, `${path}[${index}]`),
  );
}

function validateBoardArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const value = data[key];

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  const errors = validateBoardState(value);
  if (errors.length > 0) {
    throw new Error(`${path}: ${errors.join("; ")}`);
  }

  return value;
}
