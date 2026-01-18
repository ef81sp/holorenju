import { describe, expect, it } from "vitest";

import {
  internalRowToDisplay,
  displayRowToInternal,
  internalColToDisplay,
  displayColToInternal,
  clampPosition,
  clampDisplayRow,
  COLUMN_OPTIONS,
} from "./coordinateUtils";

describe("internalRowToDisplay", () => {
  it("converts internal row 0 to display row 15", () => {
    expect(internalRowToDisplay(0)).toBe(15);
  });

  it("converts internal row 7 to display row 8", () => {
    expect(internalRowToDisplay(7)).toBe(8);
  });

  it("converts internal row 14 to display row 1", () => {
    expect(internalRowToDisplay(14)).toBe(1);
  });
});

describe("displayRowToInternal", () => {
  it("converts display row 15 to internal row 0", () => {
    expect(displayRowToInternal(15)).toBe(0);
  });

  it("converts display row 8 to internal row 7", () => {
    expect(displayRowToInternal(8)).toBe(7);
  });

  it("converts display row 1 to internal row 14", () => {
    expect(displayRowToInternal(1)).toBe(14);
  });
});

describe("internalColToDisplay", () => {
  it("converts internal col 0 to display col A", () => {
    expect(internalColToDisplay(0)).toBe("A");
  });

  it("converts internal col 7 to display col H", () => {
    expect(internalColToDisplay(7)).toBe("H");
  });

  it("converts internal col 14 to display col O", () => {
    expect(internalColToDisplay(14)).toBe("O");
  });

  it("returns A for out of range values", () => {
    expect(internalColToDisplay(15)).toBe("A");
    expect(internalColToDisplay(-1)).toBe("A");
  });
});

describe("displayColToInternal", () => {
  it("converts display col A to internal col 0", () => {
    expect(displayColToInternal("A")).toBe(0);
  });

  it("converts display col H to internal col 7", () => {
    expect(displayColToInternal("H")).toBe(7);
  });

  it("converts display col O to internal col 14", () => {
    expect(displayColToInternal("O")).toBe(14);
  });

  it("handles lowercase input", () => {
    expect(displayColToInternal("a")).toBe(0);
    expect(displayColToInternal("h")).toBe(7);
    expect(displayColToInternal("o")).toBe(14);
  });

  it("returns 0 for invalid input", () => {
    expect(displayColToInternal("Z")).toBe(0);
    expect(displayColToInternal("")).toBe(0);
  });
});

describe("clampPosition", () => {
  it("clamps value within 0-14 range", () => {
    expect(clampPosition(-1)).toBe(0);
    expect(clampPosition(0)).toBe(0);
    expect(clampPosition(7)).toBe(7);
    expect(clampPosition(14)).toBe(14);
    expect(clampPosition(15)).toBe(14);
  });
});

describe("clampDisplayRow", () => {
  it("clamps value within 1-15 range", () => {
    expect(clampDisplayRow(0)).toBe(1);
    expect(clampDisplayRow(1)).toBe(1);
    expect(clampDisplayRow(8)).toBe(8);
    expect(clampDisplayRow(15)).toBe(15);
    expect(clampDisplayRow(16)).toBe(15);
  });
});

describe("COLUMN_OPTIONS", () => {
  it("contains all 15 column labels A-O", () => {
    expect(COLUMN_OPTIONS).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
    ]);
  });
});
