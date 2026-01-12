import { describe, expect, it } from "vitest";

import {
  generateCursorCorners,
  generateGridLines,
  STAR_POINTS,
} from "./boardRenderUtils";

describe("generateGridLines", () => {
  const BOARD_SIZE = 15;
  const CELL_SIZE = 30;
  const PADDING = 30;
  const STROKE_WIDTH = 1;

  it("generates correct number of lines (15 horizontal + 15 vertical)", () => {
    const lines = generateGridLines(
      BOARD_SIZE,
      CELL_SIZE,
      PADDING,
      STROKE_WIDTH,
    );
    expect(lines).toHaveLength(30);
  });

  it("generates horizontal lines with correct coordinates", () => {
    const lines = generateGridLines(
      BOARD_SIZE,
      CELL_SIZE,
      PADDING,
      STROKE_WIDTH,
    );
    const [firstHorizontal] = lines;

    // First horizontal line: y = PADDING (30)
    expect(firstHorizontal.points).toEqual([
      30, // start x = PADDING
      30, // start y = PADDING + 0 * CELL_SIZE
      30 + 14 * 30, // end x = PADDING + (15-1) * CELL_SIZE = 450
      30, // end y
    ]);
  });

  it("generates vertical lines with correct coordinates", () => {
    const lines = generateGridLines(
      BOARD_SIZE,
      CELL_SIZE,
      PADDING,
      STROKE_WIDTH,
    );
    const [, firstVertical] = lines;

    // First vertical line: x = PADDING (30)
    expect(firstVertical.points).toEqual([
      30, // start x = PADDING + 0 * CELL_SIZE
      30, // start y = PADDING
      30, // end x
      30 + 14 * 30, // end y = PADDING + (15-1) * CELL_SIZE = 450
    ]);
  });

  it("sets correct stroke properties", () => {
    const lines = generateGridLines(
      BOARD_SIZE,
      CELL_SIZE,
      PADDING,
      STROKE_WIDTH,
    );

    lines.forEach((line) => {
      expect(line.stroke).toBe("#000");
      expect(line.strokeWidth).toBe(STROKE_WIDTH);
    });
  });
});

describe("STAR_POINTS", () => {
  it("has 5 star points", () => {
    expect(STAR_POINTS).toHaveLength(5);
  });

  it("includes corners and center", () => {
    const positions = STAR_POINTS.map((p) => `${p.row},${p.col}`);

    expect(positions).toContain("3,3"); // top-left
    expect(positions).toContain("3,11"); // top-right
    expect(positions).toContain("7,7"); // center (天元)
    expect(positions).toContain("11,3"); // bottom-left
    expect(positions).toContain("11,11"); // bottom-right
  });
});

describe("generateCursorCorners", () => {
  const positionToPixels = (
    row: number,
    col: number,
  ): { x: number; y: number } => ({
    x: 30 + col * 30,
    y: 30 + row * 30,
  });
  const CELL_SIZE = 30;

  it("returns empty array when cursorPosition is undefined", () => {
    const corners = generateCursorCorners(
      undefined,
      positionToPixels,
      CELL_SIZE,
    );
    expect(corners).toEqual([]);
  });

  it("generates 8 lines for cursor corners (4 corners × 2 lines each)", () => {
    const corners = generateCursorCorners(
      { row: 7, col: 7 },
      positionToPixels,
      CELL_SIZE,
    );
    expect(corners).toHaveLength(8);
  });

  it("sets correct stroke color and width", () => {
    const corners = generateCursorCorners(
      { row: 7, col: 7 },
      positionToPixels,
      CELL_SIZE,
    );

    corners.forEach((corner) => {
      expect(corner.stroke).toBe("#37abdf");
      expect(corner.strokeWidth).toBe(3);
    });
  });

  it("positions corners around the center pixel", () => {
    const corners = generateCursorCorners(
      { row: 7, col: 7 },
      positionToPixels,
      CELL_SIZE,
    );

    // Center position: (240, 240)
    // All corner lines should be around this position
    corners.forEach((corner) => {
      const [x1, y1, x2, y2] = corner.points;
      // All coordinates should be within range of center ± half cell + padding + corner length
      expect(x1).toBeGreaterThan(200);
      expect(x1).toBeLessThan(280);
      expect(y1).toBeGreaterThan(200);
      expect(y1).toBeLessThan(280);
      expect(x2).toBeGreaterThan(200);
      expect(x2).toBeLessThan(280);
      expect(y2).toBeGreaterThan(200);
      expect(y2).toBeLessThan(280);
    });
  });
});
