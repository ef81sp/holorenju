/**
 * リッチテキストパーサー
 * 記法形式をASTに変換
 * - ルビ: {base|ruby}
 * - 強調: **text**
 * - 改行: \n
 * - 箇条書き: 行頭「- 」
 */

import type { InlineTextNode, TextNode } from "@/types/text";

// インライン要素をパース
function parseInlineText(raw: string): InlineTextNode[] {
  const nodes: InlineTextNode[] = [];
  let buffer = "";
  let i = 0;

  while (i < raw.length) {
    // ルビ検出: {base|ruby}
    if (raw[i] === "{") {
      if (buffer) {
        nodes.push({ type: "text", content: buffer });
        buffer = "";
      }

      const rubyMatch = raw.slice(i).match(/^\{([^|]+)\|([^}]+)\}/);
      if (rubyMatch) {
        nodes.push({ type: "ruby", base: rubyMatch[1], ruby: rubyMatch[2] });
        i += rubyMatch[0].length;
        continue;
      }
    }

    // 強調検出: **text**
    if (raw[i] === "*" && raw[i + 1] === "*") {
      if (buffer) {
        nodes.push({ type: "text", content: buffer });
        buffer = "";
      }

      const emphasisMatch = raw.slice(i).match(/^\*\*([^*]+)\*\*/);
      if (emphasisMatch) {
        nodes.push({ type: "emphasis", content: emphasisMatch[1] });
        i += emphasisMatch[0].length;
        continue;
      }
    }

    buffer += raw[i];
    i++;
  }

  if (buffer) {
    nodes.push({ type: "text", content: buffer });
  }

  return nodes;
}

/**
 * 記法テキストをASTにパース（共通）
 * - 行頭「- 」は箇条書き
 * - 改行は lineBreak
 */
export function parseText(raw: string): TextNode[] {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const nodes: TextNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 箇条書きブロックをまとめて処理
    if (/^\s*-\s+/.test(line)) {
      const items: InlineTextNode[][] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*-\s+/, "");
        items.push(parseInlineText(content));
        i++;
      }
      nodes.push({ type: "list", items });

      if (i < lines.length) {
        nodes.push({ type: "lineBreak" });
      }
      continue;
    }

    // 空行は改行ノードにする
    if (line.trim().length === 0) {
      nodes.push({ type: "lineBreak" });
      i++;
      continue;
    }

    // 通常行: インラインノードとして追加
    const inlineNodes = parseInlineText(line);
    nodes.push(...inlineNodes);

    if (i < lines.length - 1) {
      nodes.push({ type: "lineBreak" });
    }

    i++;
  }

  return nodes;
}

// 後方互換のエイリアス
export const parseDialogueText = parseText;
export const parseDescriptionText = parseText;

/**
 * ASTを記法テキストにシリアライズ
 */
export function stringifyText(nodes: TextNode[]): string {
  const lines: string[] = [];
  let currentLine = "";

  const flushLine = () => {
    lines.push(currentLine);
    currentLine = "";
  };

  nodes.forEach((node) => {
    if (node.type === "lineBreak") {
      flushLine();
      return;
    }

    if (node.type === "list") {
      if (currentLine.length > 0) {
        flushLine();
      }
      node.items.forEach((item) => {
        const content = stringifyInline(item);
        lines.push(`- ${content}`);
      });
      return;
    }

    // inline node
    currentLine += stringifyInline([node]);
  });

  flushLine();

  // 末尾の空行は1つにまとめる
  while (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function stringifyInline(nodes: InlineTextNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.content;
      if (node.type === "emphasis") return `**${node.content}**`;
      if (node.type === "ruby") return `{${node.base}|${node.ruby}}`;
      return "";
    })
    .join("");
}
