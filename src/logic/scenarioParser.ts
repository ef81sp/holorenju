/**
 * シナリオパーサー・バリデーター
 *
 * 2段階のバリデーション機能：
 * 1. validateScenario: JSON/オブジェクトをScenario型にパースする（実行時用）
 * 2. validateBoardState: 盤面の妥当性を検証する（JSON編集時用）
 */

import type { EmotionId } from "../types/character";
import type { TextNode, InlineTextNode } from "../types/text";

import {
  DIFFICULTIES,
  BOARD_ACTION_TYPES,
  type Scenario,
  type ScenarioDifficulty,
  type DemoSection,
  type DemoDialogue,
  type QuestionSection,
  type Section,
  type BoardAction,
  type SuccessCondition,
  type Position,
  type QuestionFeedback,
  type DialogueLine,
} from "../types/scenario";
import { parseText, parseInlineTextFromString } from "./textParser";

/**
 * フィードバックのデフォルト値
 */
export const DEFAULT_FEEDBACK: QuestionFeedback = {
  success: [
    {
      character: "fubuki",
      text: [{ type: "text", content: "ないすー！" }],
      emotion: 37,
    },
  ],
  failure: [
    {
      character: "miko",
      text: [{ type: "text", content: "おうおうおう……" }],
      emotion: 34,
    },
  ],
};

/**
 * 数値を0-39にクランプしてEmotionIdとして返す
 */
function toEmotionId(n: unknown): EmotionId {
  if (typeof n !== "number") {
    return 0;
  }
  const clamped = Math.min(39, Math.max(0, Math.floor(n)));
  // 0-39にクランプ済みなのでEmotionIdとして安全
  return clamped as EmotionId;
}

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

  const type = validateEnum(data, "type", ["demo", "question"], path);

  if (type === "demo") {
    return validateDemoSection(data, path);
  }
  return validateQuestionSection(data, path);
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

  if (dialogues.length === 0) {
    throw new Error(`${path}.dialogues must not be empty`);
  }

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
function validateQuestionSection(
  data: Record<string, unknown>,
  path: string,
): QuestionSection {
  const id = validateString(data, "id", `${path}.id`);
  const title = validateString(data, "title", `${path}.title`);
  const initialBoard = validateBoardArray(
    data,
    "initialBoard",
    `${path}.initialBoard`,
  );
  const description = validateTextContent(
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

  if (dialogues.length === 0) {
    throw new Error(`${path}.dialogues must not be empty`);
  }

  return {
    id,
    type: "question",
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
  const emotion = toEmotionId(data.emotion);
  const boardActions = Array.isArray(data.boardActions)
    ? data.boardActions.map((action, idx) =>
        validateBoardAction(action, `${path}.boardActions[${idx}]`),
      )
    : [];

  // Description: オプショナル、type未指定時は"continue"
  let description: DemoDialogue["description"] | undefined = undefined;
  if (data.description !== undefined) {
    if (!isObject(data.description)) {
      throw new Error(`${path}.description must be an object`);
    }
    const descriptionText = validateTextNodeArray(
      data.description,
      "text",
      `${path}.description.text`,
    );
    const clear = data.description.clear === true ? true : undefined;
    description = {
      text: descriptionText,
      clear,
    };
  }

  return {
    id,
    character,
    text,
    emotion,
    description,
    boardActions,
  };
}

/**
 * 盤面操作をバリデーション
 */
function validateBoardAction(data: unknown, path: string): BoardAction {
  if (!isObject(data)) {
    throw new Error(`${path} must be an object`);
  }

  const type = validateEnum(data, "type", BOARD_ACTION_TYPES, path);

  switch (type) {
    case "place": {
      const position = validatePosition(data.position, `${path}.position`);
      const color = validateEnum(
        data,
        "color",
        ["black", "white"],
        `${path}.color`,
      );
      return { type: "place", position, color };
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
      const action = data.action
        ? validateEnum(data, "action", ["draw", "remove"], `${path}.action`)
        : undefined;
      return { type: "mark", positions, markType, label, action };
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

    case "resetAll": {
      return { type: "resetAll" };
    }

    case "resetMarkLine": {
      return { type: "resetMarkLine" };
    }

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown board action type: ${_exhaustive}`);
    }
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
 * フィードバックをバリデーション
 * feedbackが省略された場合、またはsuccess/failureが個別に省略された場合は
 * デフォルト値を適用する
 */
function validateFeedback(
  data: Record<string, unknown>,
  key: string,
  path: string,
): QuestionFeedback {
  const value = data[key];

  // feedbackが省略された場合はデフォルト値を返す
  if (value === undefined) {
    return DEFAULT_FEEDBACK;
  }

  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }

  // success/failureが省略されている場合は個別にデフォルト値を適用
  const success =
    value.success === undefined
      ? DEFAULT_FEEDBACK.success
      : validateDialogueLineArray(value, "success", `${path}.success`);
  const failure =
    value.failure === undefined
      ? DEFAULT_FEEDBACK.failure
      : validateDialogueLineArray(value, "failure", `${path}.failure`);
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
    const emotion = toEmotionId(item.emotion);

    return {
      character: validateEnum(
        item,
        "character",
        ["fubuki", "miko", "narration"],
        `${path}[${index}].character`,
      ),
      text,
      emotion,
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

  return value.map((item, index) =>
    validateTextNode(item, `${path}[${index}]`),
  );
}

function validateTextNode(item: unknown, path: string): TextNode {
  if (!isObject(item)) {
    throw new Error(`${path} must be an object`);
  }

  const type = validateEnum(
    item,
    "type",
    ["text", "ruby", "emphasis", "link", "lineBreak", "list"],
    `${path}.type`,
  );

  if (type === "text") {
    const content = validateString(item, "content", `${path}.content`, true);
    return { type: "text", content } as TextNode;
  }

  if (type === "ruby") {
    const base = validateString(item, "base", `${path}.base`, true);
    const ruby = validateString(item, "ruby", `${path}.ruby`, true);
    return { type: "ruby", base, ruby } as TextNode;
  }

  if (type === "emphasis") {
    const contentRaw = item.content;
    // eslint-disable-next-line init-declarations
    let content: InlineTextNode[];

    if (typeof contentRaw === "string") {
      // 旧形式: string
      content = parseInlineTextFromString(contentRaw);
    } else if (Array.isArray(contentRaw)) {
      // 新形式: InlineTextNode[]
      content = contentRaw.map((node, nodeIndex) =>
        validateInlineNode(node, `${path}.content[${nodeIndex}]`),
      );
    } else {
      throw new Error(`${path}.content must be string or array`);
    }

    return { type: "emphasis", content } as TextNode;
  }

  if (type === "link") {
    const url = validateString(item, "url", `${path}.url`, true);
    const contentRaw = item.content;
    // eslint-disable-next-line init-declarations
    let content: InlineTextNode[];

    if (typeof contentRaw === "string") {
      content = parseInlineTextFromString(contentRaw);
    } else if (Array.isArray(contentRaw)) {
      content = contentRaw.map((node, nodeIndex) =>
        validateInlineNode(node, `${path}.content[${nodeIndex}]`),
      );
    } else {
      throw new Error(`${path}.content must be string or array`);
    }

    return { type: "link", content, url } as TextNode;
  }

  if (type === "lineBreak") {
    return { type: "lineBreak" } as TextNode;
  }

  // List
  const itemsRaw = item.items;
  if (!Array.isArray(itemsRaw)) {
    throw new Error(`${path}.items must be an array`);
  }
  const items = itemsRaw.map((child, childIndex) => {
    if (!Array.isArray(child)) {
      throw new Error(`${path}.items[${childIndex}] must be an array`);
    }
    return child.map((grand, grandIndex) =>
      validateInlineNode(grand, `${path}.items[${childIndex}][${grandIndex}]`),
    );
  });
  return { type: "list", items } as TextNode;
}

function validateInlineNode(item: unknown, path: string): InlineTextNode {
  if (!isObject(item)) {
    throw new Error(`${path} must be an object`);
  }
  const type = validateEnum(
    item,
    "type",
    ["text", "ruby", "emphasis", "link"],
    `${path}.type`,
  );
  if (type === "text") {
    const content = validateString(item, "content", `${path}.content`, true);
    return { type: "text", content } as InlineTextNode;
  }
  if (type === "ruby") {
    const base = validateString(item, "base", `${path}.base`, true);
    const ruby = validateString(item, "ruby", `${path}.ruby`, true);
    return { type: "ruby", base, ruby } as InlineTextNode;
  }

  const contentRaw = item.content;
  // eslint-disable-next-line init-declarations
  let content: InlineTextNode[];

  if (typeof contentRaw === "string") {
    content = parseInlineTextFromString(contentRaw);
  } else if (Array.isArray(contentRaw)) {
    content = contentRaw.map((node, nodeIndex) =>
      validateInlineNode(node, `${path}.content[${nodeIndex}]`),
    );
  } else {
    throw new Error(`${path}.content must be string or array`);
  }

  if (type === "link") {
    const url = validateString(item, "url", `${path}.url`, true);
    return { type: "link", content, url } as InlineTextNode;
  }

  return { type: "emphasis", content } as InlineTextNode;
}

function validateTextContent(
  data: Record<string, unknown>,
  key: string,
  path: string,
): TextNode[] {
  const value = data[key];

  if (typeof value === "string") {
    return parseText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      validateTextNode(item, `${path}[${index}]`),
    );
  }

  throw new Error(`${path} must be string or TextNode[]`);
}

// ===== ヘルパー関数 =====

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function validateString(
  data: Record<string, unknown>,
  key: string,
  path: string,
  allowEmpty = false,
): string {
  const value = data[key];

  if (typeof value !== "string") {
    throw new Error(`${path} must be a string, got ${typeof value}`);
  }

  if (!allowEmpty && value.length === 0) {
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
  allowedValues: readonly T[],
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
): ScenarioDifficulty {
  return validateEnum(data, key, DIFFICULTIES, `Scenario.${key}`);
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
