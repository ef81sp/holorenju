/**
 * リッチテキストパーサー
 * 記法形式をASTに変換
 * - ルビ: {base|ruby}
 * - 強調: **text**
 */

import type { TextNode } from "@/types/text";

/**
 * テキストを記法からASTにパース
 * @param raw パースするテキスト
 * @returns パース済みノード配列
 */
export function parseDialogueText(raw: string): TextNode[] {
  const nodes: TextNode[] = [];
  let buffer = "";
  let i = 0;

  while (i < raw.length) {
    // ルビ検出: {base|ruby}
    if (raw[i] === "{") {
      // バッファに溜まったテキストをノードに追加
      if (buffer) {
        nodes.push({ type: "text", content: buffer });
        buffer = "";
      }

      // ルビパターンをマッチ
      const rubyMatch = raw.slice(i).match(/^\{([^|]+)\|([^}]+)\}/);
      if (rubyMatch) {
        nodes.push({
          type: "ruby",
          base: rubyMatch[1],
          ruby: rubyMatch[2],
        });
        i += rubyMatch[0].length;
        continue;
      }
    }

    // 強調検出: **text**
    if (raw[i] === "*" && raw[i + 1] === "*") {
      // バッファに溜まったテキストをノードに追加
      if (buffer) {
        nodes.push({ type: "text", content: buffer });
        buffer = "";
      }

      // 強調パターンをマッチ
      const emphasisMatch = raw.slice(i).match(/^\*\*([^*]+)\*\*/);
      if (emphasisMatch) {
        nodes.push({
          type: "emphasis",
          content: emphasisMatch[1],
        });
        i += emphasisMatch[0].length;
        continue;
      }
    }

    // 通常文字
    buffer += raw[i];
    i++;
  }

  // 残りのテキストをノードに追加
  if (buffer) {
    nodes.push({ type: "text", content: buffer });
  }

  return nodes;
}
