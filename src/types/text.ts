/**
 * リッチテキスト関連の型定義
 */

// テキストノードの基本型
type TextNode = TextSegment | RubyNode | EmphasisNode;

// プレーンなテキスト
interface TextSegment {
  type: "text";
  content: string;
}

// ルビ（例：{漢字|かんじ}）
interface RubyNode {
  type: "ruby";
  base: string; // 対象テキスト
  ruby: string; // ルビテキスト
}

// 強調（例：**重要**）
interface EmphasisNode {
  type: "emphasis";
  content: string;
}

export type { TextNode, TextSegment, RubyNode, EmphasisNode };
