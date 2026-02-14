/**
 * シナリオパーサー
 *
 * JSONをScenario型にパースしてバリデーション
 */

import type { TextNode, InlineTextNode } from "../../types/text";

import {
  BOARD_ACTION_TYPES,
  type Scenario,
  type DemoSection,
  type DemoDialogue,
  type QuestionSection,
  type Section,
  type BoardAction,
  type SuccessCondition,
  type Position,
  type QuestionFeedback,
  type DialogueLine,
} from "../../types/scenario";
import { parseText, parseInlineTextFromString } from "../textParser";
import {
  isObject,
  validateString,
  validateStringArray,
  validateEnum,
  validateDifficulty,
  validatePosition,
  validatePositionArray,
  toEmotionId,
  DEFAULT_FEEDBACK,
} from "./parserUtils";
import { validateBoardState } from "./validateBoardState";

// ===== メインパーサー =====

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

// ===== セクションバリデーション =====

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

// ===== ダイアログバリデーション =====

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

// ===== 盤面操作バリデーション =====

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

// ===== 成功条件バリデーション =====

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

  const conditions = value.map((item, index) =>
    validateSuccessCondition(item, `${path}[${index}]`),
  );

  // VCF/VCT条件は他の条件タイプと混在不可（1件のみ許可）
  const hasVcfVct = conditions.some(
    (c) => c.type === "vcf" || c.type === "vct",
  );
  if (hasVcfVct && conditions.length > 1) {
    throw new Error(
      `${path}: vcf/vct cannot be mixed with other condition types`,
    );
  }

  return conditions;
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
    ["position", "pattern", "sequence", "vcf", "vct"],
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

    case "vcf":
    case "vct": {
      const color = validateEnum(
        data,
        "color",
        ["black", "white"],
        `${path}.color`,
      );
      return { type, color };
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

// ===== フィードバックバリデーション =====

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

// ===== テキストバリデーション =====

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

// ===== 盤面配列バリデーション =====

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
