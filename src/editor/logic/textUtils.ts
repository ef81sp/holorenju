import type { TextNode } from "@/types/text";

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
        return `**${node.content}**`;
      }
      if (node.type === "lineBreak") {
        return "\n";
      }
      if (node.type === "list") {
        return node.items
          .map((item) => {
            const content = item
              .map((n) => {
                if (n.type === "text") {
                  return n.content;
                }
                if (n.type === "ruby") {
                  return `{${n.base}|${n.ruby}}`;
                }
                if (n.type === "emphasis") {
                  return `**${n.content}**`;
                }
                return "";
              })
              .join("");
            return `- ${content}`;
          })
          .join("\n");
      }
      return "";
    })
    .join("");
}
