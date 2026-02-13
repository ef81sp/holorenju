/**
 * シナリオパーサー共通ユーティリティ
 *
 * 型ガード、バリデーションヘルパー、定数
 */

import type { EmotionId } from "../../types/character";

import {
  DIFFICULTIES,
  type ScenarioDifficulty,
  type Position,
  type QuestionFeedback,
} from "../../types/scenario";

export const BOARD_SIZE = 15;

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
export function toEmotionId(n: unknown): EmotionId {
  if (typeof n !== "number") {
    return 0;
  }
  const clamped = Math.min(39, Math.max(0, Math.floor(n)));
  // 0-39にクランプ済みなのでEmotionIdとして安全
  return clamped as EmotionId;
}

// ===== 型ガード =====

export function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

// ===== プリミティブバリデーション =====

export function validateString(
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

export function validateNumber(
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

export function validateStringArray(
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

export function validateEnum<T extends string>(
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

export function validateDifficulty(
  data: Record<string, unknown>,
  key: string,
): ScenarioDifficulty {
  return validateEnum(data, key, DIFFICULTIES, `Scenario.${key}`);
}

export function validatePosition(data: unknown, path: string): Position {
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

export function validatePositionArray(
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
