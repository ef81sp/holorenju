/**
 * シナリオファイルハンドラー
 *
 * JSONファイルの読み込み・保存・バリデーション
 */

import type { TextNode } from "../types/text";

import {
  DIFFICULTIES,
  type Scenario,
  type DemoSection,
  type QuestionSection,
} from "../types/scenario";
import {
  parseScenario,
  validateBoardState,
  DEFAULT_FEEDBACK,
} from "./scenarioParser";

// ===== 文字数制限定数 =====

export const TITLE_MAX_LENGTH = 7;
export const DIALOGUE_MAX_LENGTH_NO_NEWLINE = 40;
export const DIALOGUE_MAX_LENGTH_PER_LINE = 20;
export const DIALOGUE_MAX_LINES = 2;

// ===== ファイル読み込み =====

/**
 * JSONファイルを読み込んでScenario型にパース
 * @throws {Error} パース失敗時
 */
export async function loadScenarioFromFile(file: File): Promise<Scenario> {
  const text = await file.text();
  const data = JSON.parse(text);
  return parseScenario(data);
}

/**
 * JSONテキストをScenario型にパース
 * @throws {Error} パース失敗時
 */
export function parseScenarioFromText(text: string): Scenario {
  const data = JSON.parse(text);
  return parseScenario(data);
}

// ===== ファイル保存 =====

/**
 * ScenarioをJSONファイルとしてダウンロード
 */
export function downloadScenarioAsJSON(scenario: Scenario): void {
  const json = `${JSON.stringify(scenario, null, 2)}\n`;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${scenario.id}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * ScenarioをJSONテキストに変換
 */
export function scenarioToJSON(scenario: Scenario): string {
  return `${JSON.stringify(scenario, null, 2)}\n`;
}

// ===== バリデーション結果 =====

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  type: "parse" | "board" | "length";
  path: string;
  message: string;
}

// ===== 文字数バリデーション =====

/**
 * タイトルの文字数をバリデーション
 * @returns エラーメッセージ（有効な場合はnull）
 */
export function validateTitleLength(title: string): string | null {
  if (title.length > TITLE_MAX_LENGTH) {
    return `タイトルは${TITLE_MAX_LENGTH}文字以内にしてください（現在${title.length}文字）`;
  }
  return null;
}

/**
 * TextNode[]から表示文字数をカウント
 * - ルビ: baseのみカウント
 * - 強調: 中身のみカウント
 * - 改行: 改行としてカウント（行分割に使用）
 */
export function countDisplayCharacters(nodes: TextNode[]): number {
  let count = 0;
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        count += node.content.length;
        break;
      case "ruby":
        count += node.base.length;
        break;
      case "emphasis":
        count += countDisplayCharacters(node.content);
        break;
      case "link":
        count += countDisplayCharacters(node.content);
        break;
      case "lineBreak":
        // 改行は文字数としてカウントしない（行分割に使用）
        break;
      case "list":
        // リストはダイアログでは通常使用しないが、念のため対応
        for (const item of node.items) {
          count += countDisplayCharacters(item);
        }
        break;
    }
  }
  return count;
}

/**
 * TextNode[]を行ごとに分割して各行の文字数を取得
 */
export function countDisplayCharactersPerLine(nodes: TextNode[]): number[] {
  const lines: TextNode[][] = [[]];

  for (const node of nodes) {
    if (node.type === "lineBreak") {
      lines.push([]);
    } else {
      const currentLine = lines[lines.length - 1];
      if (currentLine) {
        currentLine.push(node);
      }
    }
  }

  return lines.map((line) => countDisplayCharacters(line));
}

/**
 * ダイアログテキストの文字数をバリデーション
 * @returns エラーメッセージ（有効な場合はnull）
 */
export function validateDialogueLength(nodes: TextNode[]): string | null {
  const hasLineBreak = nodes.some((n) => n.type === "lineBreak");

  if (!hasLineBreak) {
    // 改行なし: 40文字まで
    const count = countDisplayCharacters(nodes);
    if (count > DIALOGUE_MAX_LENGTH_NO_NEWLINE) {
      return `ダイアログは${DIALOGUE_MAX_LENGTH_NO_NEWLINE}文字以内にしてください（現在${count}文字）`;
    }
  } else {
    // 改行あり: 1行あたり20文字 × 最大2行
    const lineCounts = countDisplayCharactersPerLine(nodes);

    if (lineCounts.length > DIALOGUE_MAX_LINES) {
      return `ダイアログは${DIALOGUE_MAX_LINES}行以内にしてください（現在${lineCounts.length}行）`;
    }

    for (let i = 0; i < lineCounts.length; i++) {
      const lineCount = lineCounts[i];
      if (lineCount !== undefined && lineCount > DIALOGUE_MAX_LENGTH_PER_LINE) {
        return `ダイアログの各行は${DIALOGUE_MAX_LENGTH_PER_LINE}文字以内にしてください（${i + 1}行目: ${lineCount}文字）`;
      }
    }
  }

  return null;
}

export interface ValidationOptions {
  /** 文字数チェックを行うか（デフォルト: false） */
  checkLength?: boolean;
}

/**
 * シナリオ全体をバリデーション
 * @param data バリデーション対象のデータ
 * @param options バリデーションオプション
 * @returns バリデーション結果
 */
export function validateScenarioCompletely(
  data: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  const { checkLength = false } = options;
  const errors: ValidationError[] = [];

  // 1. パース時のエラーをキャッチ
  let scenario: Scenario | null = null;
  try {
    scenario = parseScenario(data);
  } catch (error) {
    return {
      isValid: false,
      errors: [
        {
          type: "parse",
          path: "root",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      ],
    };
  }

  if (!scenario) {
    return {
      isValid: false,
      errors: [],
    };
  }

  // 2. シナリオタイトルの文字数チェック（オプション）
  if (checkLength) {
    const scenarioTitleError = validateTitleLength(scenario.title);
    if (scenarioTitleError) {
      errors.push({
        type: "length",
        path: "title",
        message: scenarioTitleError,
      });
    }
  }

  // 3. 盤面のバリデーション + セクションタイトル + ダイアログの文字数チェック
  for (
    let sectionIndex = 0;
    sectionIndex < scenario.sections.length;
    sectionIndex += 1
  ) {
    const section = scenario.sections[sectionIndex];
    if (!section) {
      continue;
    }

    // 盤面チェック
    const boardErrors = validateBoardState(section.initialBoard);
    for (const msg of boardErrors) {
      errors.push({
        type: "board",
        path: `sections[${sectionIndex}].initialBoard`,
        message: msg,
      });
    }

    // セクションタイトルの文字数チェック（オプション）
    if (checkLength) {
      const sectionTitleError = validateTitleLength(section.title);
      if (sectionTitleError) {
        errors.push({
          type: "length",
          path: `sections[${sectionIndex}].title`,
          message: sectionTitleError,
        });
      }
    }

    // ダイアログの文字数チェック（オプション）
    if (checkLength) {
      const { dialogues } = section;
      for (
        let dialogueIndex = 0;
        dialogueIndex < dialogues.length;
        dialogueIndex += 1
      ) {
        const dialogue = dialogues[dialogueIndex];
        if (!dialogue) {
          continue;
        }
        const dialogueError = validateDialogueLength(dialogue.text);
        if (dialogueError) {
          errors.push({
            type: "length",
            path: `sections[${sectionIndex}].dialogues[${dialogueIndex}].text`,
            message: dialogueError,
          });
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ===== テンプレート =====

/**
 * 空の新規シナリオテンプレート
 */
/**
 * 自動採番でシナリオIDを生成
 */
export function generateScenarioId(): string {
  const timestamp = Date.now().toString(36); // タイムスタンプを36進数に変換
  const random = Math.random().toString(36).substring(2, 7); // ランダムな文字を5文字
  return `scenario_${timestamp}_${random}`;
}

/**
 * シナリオ内のセクション数に基づいて自動採番されたセクションIDを生成
 */
export function generateSectionId(scenarioSections: unknown[]): string {
  const sectionNumber = scenarioSections.length + 1;
  return `section_${sectionNumber}`;
}

/**
 * ダイアログ数に基づいて自動採番されたダイアログIDを生成
 */
export function generateDialogueId(dialogues: unknown[]): string {
  const dialogueNumber = dialogues.length + 1;
  return `dialogue_${dialogueNumber}`;
}

export function createEmptyScenario(): Scenario {
  return {
    id: generateScenarioId(),
    title: "新しいシナリオ",
    difficulty: DIFFICULTIES[0],
    description: "",
    objectives: [],
    sections: [],
  };
}

/**
 * 空のデモセクションテンプレート
 */
export function createEmptyDemoSection(): DemoSection {
  return {
    id: "demo_section",
    type: "demo" as const,
    title: "デモセクション",
    initialBoard: Array(15).fill("-".repeat(15)),
    dialogues: [],
  };
}

/**
 * 空の問題セクションテンプレート
 */
export function createEmptyQuestionSection(): QuestionSection {
  return {
    id: "question_section",
    type: "question" as const,
    title: "問題セクション",
    initialBoard: Array(15).fill("-".repeat(15)),
    description: [],
    dialogues: [],
    successOperator: "or",
    successConditions: [
      {
        type: "position" as const,
        positions: [],
        color: "black" as const,
      },
    ],
    feedback: DEFAULT_FEEDBACK,
  };
}

// ===== 盤面変換 =====

/**
 * 盤面文字列配列をASCII表示（デバッグ用）
 */
export function boardToASCII(board: string[]): string {
  const header = `  ${Array.from({ length: 15 }, (_, i) => i.toString().padStart(2, " ")).join("")}`;
  const lines = [header];

  board.forEach((row, i) => {
    const chars = row.split("").map((c) => {
      switch (c) {
        case "-":
          return " .";
        case "x":
          return " ●";
        case "o":
          return " ○";
        default:
          return " ?";
      }
    });
    lines.push(i.toString().padStart(2, " ") + chars.join(""));
  });

  return lines.join("\n");
}

/**
 * 盤面配列を編集可能な2次元配列に変換
 */
/**
 * 盤面文字列配列を2次元配列に変換
 */
export function boardStringToArray(board: string[]): string[][] {
  return board.map((row) => row.split(""));
}

/**
 * 盤面文字列配列をBoardStateに変換（e='null', x='black', o='white'）
 */
export function boardStringToBoardState(
  board: string[],
): ("black" | "white" | null)[][] {
  return board.map((row) =>
    row.split("").map((char) => {
      if (char === "x") {
        return "black";
      }
      if (char === "o") {
        return "white";
      }
      return null;
    }),
  );
}

/**
 * 編集済み2次元配列を盤面文字列配列に変換
 */
export function boardArrayToString(board: string[][]): string[] {
  return board.map((row) => row.join(""));
}

// ===== ボード座標ユーティリティ =====

export interface BoardCell {
  row: number;
  col: number;
}

/**
 * セルの内容を取得
 */
export function getBoardCell(board: string[], cell: BoardCell): string {
  return board[cell.row]?.[cell.col] ?? "-";
}

/**
 * セルの内容を設定（新しい盤面を返す）
 */
export function setBoardCell(
  board: string[],
  cell: BoardCell,
  value: "-" | "x" | "o",
): string[] {
  const newBoard = [...board];
  const rowStr = newBoard[cell.row];
  if (!rowStr) {
    return newBoard;
  }
  const row = rowStr.split("");
  row[cell.col] = value;
  newBoard[cell.row] = row.join("");
  return newBoard;
}

/**
 * セルを次の状態に循環させる（- → x → o → -）
 */
export function cycleBoardCell(board: string[], cell: BoardCell): string[] {
  const current = getBoardCell(board, cell);
  let next: "-" | "x" | "o" = "-";
  if (current === "-") {
    next = "x";
  } else if (current === "x") {
    next = "o";
  } else {
    next = "-";
  }
  return setBoardCell(board, cell, next);
}
