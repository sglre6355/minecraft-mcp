import { describe, expect, test } from "bun:test";

import { falls, safeToBreak } from "./collect-block.ts";

describe("falls", () => {
  test("holds for sand, gravel and concrete powder", () => {
    expect(falls("sand")).toBe(true);
    expect(falls("gravel")).toBe(true);
    expect(falls("white_concrete_powder")).toBe(true);
  });

  test("fails for blocks that stay in the air", () => {
    expect(falls("stone")).toBe(false);
    expect(falls("white_concrete")).toBe(false);
  });
});

describe("safeToBreak", () => {
  test("allows a block with nothing risky around it", () => {
    expect(safeToBreak(["air", "dirt", "stone", "stone", "air", undefined], "air")).toBe(true);
  });

  test("refuses a block that touches water or lava", () => {
    expect(safeToBreak(["air", "dirt", "water", "stone", "stone", "stone"], "air")).toBe(false);
    expect(safeToBreak(["stone", "lava", "stone", "stone", "stone", "stone"], "stone")).toBe(false);
  });

  test("refuses a block that holds up something that falls", () => {
    expect(safeToBreak(["gravel", "stone"], "gravel")).toBe(false);
    expect(safeToBreak(["red_sand", "stone"], "red_sand")).toBe(false);
    expect(safeToBreak(["white_concrete_powder"], "white_concrete_powder")).toBe(false);
  });

  test("allows a block with sand beside it", () => {
    expect(safeToBreak(["air", "stone", "sand", "stone", "stone", "stone"], "air")).toBe(true);
  });
});
