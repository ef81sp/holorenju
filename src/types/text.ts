/**
 * リッチテキスト関連の型定義
 */

// インラインノード（行内要素）
type InlineTextNode = TextSegment | RubyNode | EmphasisNode;

// 行・ブロックも含めた統一テキストノード
type TextNode = InlineTextNode | LineBreakNode | BulletListNode;

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

// 改行
interface LineBreakNode {
  type: "lineBreak";
}

// 箇条書き（単階層）
interface BulletListNode {
  type: "list";
  items: InlineTextNode[][];
}

export type {
  InlineTextNode,
  TextNode,
  TextSegment,
  RubyNode,
  EmphasisNode,
  LineBreakNode,
  BulletListNode,
};
