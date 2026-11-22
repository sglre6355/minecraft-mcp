import { describe, expect, test } from "bun:test";

import type { Shape } from "../sight/cast.ts";

import { cellOf, coneOver } from "./look.ts";

const full: Array<Shape> = [[0, 0, 0, 1, 1, 1]];

describe("coneOver", () => {
  const eye = { x: 0, y: 0, z: 0 };

  test("goes all around when the eye is in the ball", () => {
    expect(coneOver(eye, { x: 2, y: 1, z: 0 }, 8)).toMatchObject({ halfAngle: 180 });
  });

  test("points at a ball some way off and is just wide enough for it", () => {
    const cone = coneOver(eye, { x: 20, y: 0, z: 0 }, 10);

    expect(cone.axis).toEqual({ x: 20, y: 0, z: 0 });
    expect(cone.halfAngle).toBeCloseTo(30);
    expect(cone.away).toBe(20);
  });
});

describe("cellOf", () => {
  test("is air for the kinds of air", () => {
    expect(cellOf({ name: "air", shapes: [] })).toBe("air");
    expect(cellOf({ name: "cave_air", shapes: [] })).toBe("air");
    expect(cellOf({ name: "void_air", shapes: [] })).toBe("air");
  });

  test("ends sight at an ordinary block, with the block's own shape", () => {
    const slab: Array<Shape> = [[0, 0, 0, 1, 0.5, 1]];

    expect(cellOf({ name: "stone", shapes: full })).toEqual({
      name: "stone",
      shapes: full,
      sight: "ends",
    });
    expect(cellOf({ name: "stone_slab", shapes: slab })).toEqual({
      name: "stone_slab",
      shapes: slab,
      sight: "ends",
    });
  });

  test("lets sight through glass and ice", () => {
    expect(cellOf({ name: "glass", shapes: full })).toMatchObject({ sight: "passes" });
    expect(cellOf({ name: "red_stained_glass_pane", shapes: full })).toMatchObject({
      sight: "passes",
    });
    expect(cellOf({ name: "ice", shapes: full })).toMatchObject({ sight: "passes" });
  });

  test("ends sight at ice that is not clear", () => {
    expect(cellOf({ name: "packed_ice", shapes: full })).toMatchObject({ sight: "ends" });
  });

  test("lets sight through leaves for one block", () => {
    expect(cellOf({ name: "oak_leaves", shapes: full })).toMatchObject({ sight: "veils" });
  });

  test("gives water its surface a little under the top of the cell", () => {
    expect(cellOf({ name: "water", shapes: [] })).toEqual({
      name: "water",
      shapes: [[0, 0, 0, 1, 0.875, 1]],
      sight: "passes",
    });
  });

  test("fills the cell with water that has more water on it", () => {
    expect(cellOf({ name: "water", shapes: [] }, "water")).toMatchObject({ shapes: full });
    expect(cellOf({ name: "water", shapes: [] }, "air")).toMatchObject({
      shapes: [[0, 0, 0, 1, 0.875, 1]],
    });
  });

  test("marks a block that stands in water", () => {
    expect(cellOf({ name: "seagrass", shapes: [] })).toMatchObject({ within: "water" });
    expect(cellOf({ name: "kelp_plant", shapes: [] })).toMatchObject({ within: "water" });
    expect(cellOf({ name: "oak_slab", shapes: full, isWaterlogged: true })).toMatchObject({
      sight: "ends",
      within: "water",
    });
    expect(cellOf({ name: "oak_slab", shapes: full, isWaterlogged: false })).not.toHaveProperty(
      "within",
    );
  });

  test("ends sight at lava", () => {
    expect(cellOf({ name: "lava", shapes: [] })).toMatchObject({ sight: "ends" });
    expect(cellOf({ name: "lava", shapes: [] }, "lava")).toMatchObject({ shapes: full });
  });

  test("shows a block without a body wherever its cell is, and lets sight pass it", () => {
    expect(cellOf({ name: "oak_sign", shapes: [] })).toEqual({
      name: "oak_sign",
      shapes: full,
      sight: "passes",
      bodiless: true,
    });
    expect(cellOf({ name: "torch", shapes: [] })).toMatchObject({
      sight: "passes",
      bodiless: true,
    });
  });

  test("is air for blocks that nobody can see", () => {
    expect(cellOf({ name: "light", shapes: [] })).toBe("air");
    expect(cellOf({ name: "barrier", shapes: full })).toBe("air");
    expect(cellOf({ name: "structure_void", shapes: [] })).toBe("air");
  });
});
