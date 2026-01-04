import type { TextNode, InlineTextNode } from "@/types/text";

/**
 * InlineTextNodeの配列をプレーンなテキストに変換する（再帰用）
 */
function inlineNodesToText(nodes: InlineTextNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.content;
      }
      if (node.type === "ruby") {
        return `{${node.base}|${node.ruby}}`;
      }
      if (node.type === "emphasis") {
        const content = inlineNodesToText(node.content);
        return `**${content}**`;
      }
      return "";
    })
    .join("");
}

/**
 * TextNodeの配列をプレーンなテキストに変換する
 * エディタで編集可能な形式に戻す
 *
 * @param nodes - TextNodeの配列
 * @returns プレーンテキスト文字列
 */
export function astToText(nodes: TextNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.content;
      }
      if (node.type === "ruby") {
        return `{${node.base}|${node.ruby}}`;
      }
      if (node.type === "emphasis") {
        const content = inlineNodesToText(node.content);
        return `**${content}**`;
      }
      if (node.type === "lineBreak") {
        return "\n";
      }
      if (node.type === "list") {
        return node.items
          .map((item) => {
            const content = inlineNodesToText(item);
            return `- ${content}`;
          })
          .join("\n");
      }
      return "";
    })
    .join("");
}
