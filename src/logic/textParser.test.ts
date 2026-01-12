import { describe, expect, it } from "vitest";

import {
  parseInlineTextFromString,
  parseText,
  stringifyText,
} from "./textParser";

describe("parseInlineTextFromString", () => {
  it("parses plain text", () => {
    const result = parseInlineTextFromString("hello world");

    expect(result).toEqual([{ type: "text", content: "hello world" }]);
  });

  it("parses ruby notation", () => {
    const result = parseInlineTextFromString("{連珠|れんじゅ}");

    expect(result).toEqual([{ type: "ruby", base: "連珠", ruby: "れんじゅ" }]);
  });

  it("parses emphasis", () => {
    const result = parseInlineTextFromString("**強調**");

    expect(result).toEqual([
      { type: "emphasis", content: [{ type: "text", content: "強調" }] },
    ]);
  });

  it("parses mixed content", () => {
    const result = parseInlineTextFromString(
      "これは{連珠|れんじゅ}という**ゲーム**です",
    );

    expect(result).toEqual([
      { type: "text", content: "これは" },
      { type: "ruby", base: "連珠", ruby: "れんじゅ" },
      { type: "text", content: "という" },
      { type: "emphasis", content: [{ type: "text", content: "ゲーム" }] },
      { type: "text", content: "です" },
    ]);
  });

  it("handles nested emphasis with ruby", () => {
    const result = parseInlineTextFromString("**{連珠|れんじゅ}**");

    expect(result).toEqual([
      {
        type: "emphasis",
        content: [{ type: "ruby", base: "連珠", ruby: "れんじゅ" }],
      },
    ]);
  });

  it("handles unclosed emphasis as text", () => {
    const result = parseInlineTextFromString("**unclosed");

    expect(result).toEqual([{ type: "text", content: "**unclosed" }]);
  });

  it("handles unclosed ruby as text", () => {
    const result = parseInlineTextFromString("{unclosed");

    expect(result).toEqual([{ type: "text", content: "{unclosed" }]);
  });
});

describe("parseText", () => {
  it("parses single line", () => {
    const result = parseText("hello");

    expect(result).toEqual([{ type: "text", content: "hello" }]);
  });

  it("parses multiple lines with line breaks", () => {
    const result = parseText("line1\nline2");

    expect(result).toEqual([
      { type: "text", content: "line1" },
      { type: "lineBreak" },
      { type: "text", content: "line2" },
    ]);
  });

  it("parses list items", () => {
    const result = parseText("- item1\n- item2");

    expect(result).toEqual([
      {
        type: "list",
        items: [
          [{ type: "text", content: "item1" }],
          [{ type: "text", content: "item2" }],
        ],
      },
    ]);
  });

  it("parses list with rich text", () => {
    const result = parseText("- **強調**アイテム\n- {連珠|れんじゅ}");

    expect(result).toEqual([
      {
        type: "list",
        items: [
          [
            { type: "emphasis", content: [{ type: "text", content: "強調" }] },
            { type: "text", content: "アイテム" },
          ],
          [{ type: "ruby", base: "連珠", ruby: "れんじゅ" }],
        ],
      },
    ]);
  });

  it("parses empty lines as line breaks", () => {
    const result = parseText("para1\n\npara2");

    expect(result).toEqual([
      { type: "text", content: "para1" },
      { type: "lineBreak" },
      { type: "lineBreak" },
      { type: "text", content: "para2" },
    ]);
  });

  it("handles Windows line endings (CRLF)", () => {
    const result = parseText("line1\r\nline2");

    expect(result).toEqual([
      { type: "text", content: "line1" },
      { type: "lineBreak" },
      { type: "text", content: "line2" },
    ]);
  });

  it("adds lineBreak after list when followed by text", () => {
    const result = parseText("- item\ntext after");

    expect(result).toEqual([
      { type: "list", items: [[{ type: "text", content: "item" }]] },
      { type: "lineBreak" },
      { type: "text", content: "text after" },
    ]);
  });
});

describe("stringifyText", () => {
  it("stringifies plain text", () => {
    const nodes = [{ type: "text" as const, content: "hello" }];

    expect(stringifyText(nodes)).toBe("hello");
  });

  it("stringifies emphasis", () => {
    const nodes = [
      {
        type: "emphasis" as const,
        content: [{ type: "text" as const, content: "強調" }],
      },
    ];

    expect(stringifyText(nodes)).toBe("**強調**");
  });

  it("stringifies ruby", () => {
    const nodes = [{ type: "ruby" as const, base: "連珠", ruby: "れんじゅ" }];

    expect(stringifyText(nodes)).toBe("{連珠|れんじゅ}");
  });

  it("stringifies line breaks", () => {
    const nodes = [
      { type: "text" as const, content: "line1" },
      { type: "lineBreak" as const },
      { type: "text" as const, content: "line2" },
    ];

    expect(stringifyText(nodes)).toBe("line1\nline2");
  });

  it("stringifies lists", () => {
    const nodes = [
      {
        type: "list" as const,
        items: [
          [{ type: "text" as const, content: "item1" }],
          [{ type: "text" as const, content: "item2" }],
        ],
      },
    ];

    expect(stringifyText(nodes)).toBe("- item1\n- item2");
  });
});

describe("round-trip", () => {
  const testCases = [
    "hello world",
    "**強調**テキスト",
    "{連珠|れんじゅ}ゲーム",
    "line1\nline2",
    "- item1\n- item2",
    "**{連珠|れんじゅ}**は面白い",
  ];

  testCases.forEach((input) => {
    it(`round-trips: "${input.replace(/\n/g, "\\n")}"`, () => {
      const parsed = parseText(input);
      const stringified = stringifyText(parsed);
      const reparsed = parseText(stringified);

      expect(reparsed).toEqual(parsed);
    });
  });
});
