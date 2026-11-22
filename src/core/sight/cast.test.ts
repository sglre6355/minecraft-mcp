import { describe, expect, test } from "bun:test";

import type { Cell, Shape } from "./cast.ts";

import { cast } from "./cast.ts";

const full: Array<Shape> = [[0, 0, 0, 1, 1, 1]];

// A world made of the cells given, by "x,y,z". Everything else is air.
function world(cells: { [position: string]: Cell }) {
  return (x: number, y: number, z: number) => cells[`${x},${y},${z}`] ?? "air";
}

function loadedUpTo4(x: number): "air" | "unloaded" {
  return x >= 4 ? "unloaded" : "air";
}

const stone: Cell = { name: "stone", shapes: full, sight: "ends" };
const glass: Cell = { name: "glass", shapes: full, sight: "passes" };
const water: Cell = { name: "water", shapes: [[0, 0, 0, 1, 0.875, 1]], sight: "passes" };
const leaves: Cell = { name: "oak_leaves", shapes: full, sight: "veils" };

const eye = { x: 0.5, y: 1.5, z: 0.5 };
const east = { x: 1, y: 0, z: 0 };
const down = { x: 0, y: -1, z: 0 };

describe("cast", () => {
  test("sees the side of a block that faces the eye", () => {
    const { hits } = cast(eye, east, 16, world({ "3,1,0": stone }));

    expect(hits).toEqual([
      {
        x: 3,
        y: 1,
        z: 0,
        name: "stone",
        distance: 2.5,
        face: { side: "west", box: [3, 1, 0, 4, 2, 1] },
      },
    ]);
  });

  test("sees the top of the block under the eye", () => {
    const { hits } = cast(eye, down, 16, world({ "0,-1,0": stone }));

    expect(hits).toEqual([
      {
        x: 0,
        y: -1,
        z: 0,
        name: "stone",
        distance: 1.5,
        face: { side: "up", box: [0, -1, 0, 1, 0, 1] },
      },
    ]);
  });

  test("names each of the six sides by the way it faces", () => {
    const around = world({
      "3,1,0": stone,
      "-3,1,0": stone,
      "0,4,0": stone,
      "0,-2,0": stone,
      "0,1,3": stone,
      "0,1,-3": stone,
    });
    const side = (x: number, y: number, z: number) =>
      cast(eye, { x, y, z }, 16, around).hits[0]?.face?.side;

    expect(side(1, 0, 0)).toBe("west");
    expect(side(-1, 0, 0)).toBe("east");
    expect(side(0, 1, 0)).toBe("down");
    expect(side(0, -1, 0)).toBe("up");
    expect(side(0, 0, 1)).toBe("north");
    expect(side(0, 0, -1)).toBe("south");
  });

  test("gives the box that was hit, which for a slab is half a cell high", () => {
    const slab: Cell = { name: "stone_slab", shapes: [[0, 0, 0, 1, 0.5, 1]], sight: "ends" };
    const { hits } = cast(eye, down, 16, world({ "0,-1,0": slab }));

    expect(hits[0]).toMatchObject({
      face: { side: "up", box: [0, -1, 0, 1, -0.5, 1] },
      distance: 2,
    });
  });

  test("gives one box for a block that is made of several", () => {
    const wall: Cell = {
      name: "cobblestone_wall",
      shapes: [
        [0.25, 0, 0.25, 0.75, 1.5, 0.75],
        [0.3125, 0, 0, 0.6875, 1.5, 0.25],
      ],
      sight: "ends",
    };
    const post = cast({ x: 0.5, y: 1.5, z: 0.5 }, east, 16, world({ "3,1,0": wall })).hits[0];
    const arm = cast({ x: 0.5, y: 1.5, z: 0.1 }, east, 16, world({ "3,1,0": wall })).hits[0];

    const face = { side: "west", box: [3.25, 1, 0, 3.75, 2.5, 0.75] };

    expect(post).toMatchObject({ face, distance: 2.75 });
    expect(arm).toMatchObject({ face });
    expect(arm?.distance).toBeCloseTo(2.8125, 9);
  });

  test("passes beside a shape that does not fill its cell", () => {
    const post: Cell = {
      name: "oak_fence",
      shapes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]],
      sight: "ends",
    };
    const beside = { x: 0.5, y: 1.5, z: 0.1 };
    const { hits } = cast(beside, east, 16, world({ "2,1,0": post, "4,1,0": stone }));

    expect(hits.map((hit) => hit.name)).toEqual(["stone"]);
  });

  test("stops at the first block that ends sight", () => {
    const { hits } = cast(eye, east, 16, world({ "3,1,0": stone, "5,1,0": stone }));

    expect(hits).toHaveLength(1);
  });

  test("sees nothing beyond its range", () => {
    const { hits } = cast(eye, east, 2, world({ "3,1,0": stone }));

    expect(hits).toEqual([]);
  });

  test("goes on through a block that sight passes", () => {
    const { hits } = cast(eye, east, 16, world({ "2,1,0": glass, "5,1,0": stone }));

    expect(hits.map((hit) => [hit.name, hit.distance])).toEqual([
      ["glass", 1.5],
      ["stone", 4.5],
    ]);
  });

  test("sees a body of water once, where the ray enters it", () => {
    const pool = world({ "2,1,0": glass, "3,1,0": glass, "4,1,0": glass, "6,1,0": stone });
    const { hits } = cast(eye, east, 16, pool);

    expect(hits.map((hit) => [hit.name, hit.x])).toEqual([
      ["glass", 2],
      ["stone", 6],
    ]);
  });

  test("sees the second body after a gap of air", () => {
    const panes = world({ "2,1,0": glass, "4,1,0": glass });
    const { hits } = cast(eye, east, 16, panes);

    expect(hits.map((hit) => hit.x)).toEqual([2, 4]);
  });

  test("ends at the second block of leaves", () => {
    const tree = world({ "2,1,0": leaves, "3,1,0": leaves, "4,1,0": leaves, "5,1,0": stone });
    const { hits } = cast(eye, east, 16, tree);

    expect(hits.map((hit) => [hit.name, hit.x])).toEqual([
      ["oak_leaves", 2],
      ["oak_leaves", 3],
    ]);
  });

  test("sees no side of leaves that lie behind other leaves", () => {
    const tree = world({ "2,1,0": leaves, "3,1,0": leaves });
    const { hits } = cast(eye, east, 16, tree);

    expect(hits[0]?.face?.side).toBe("west");
    expect(hits[1]).not.toHaveProperty("face");
  });

  test("sees a block without a body, but no side of it", () => {
    const torch: Cell = { name: "torch", shapes: full, sight: "passes", bodiless: true };
    const { hits } = cast(eye, east, 16, world({ "2,1,0": torch, "4,1,0": stone }));

    expect(hits.map((hit) => hit.name)).toEqual(["torch", "stone"]);
    expect(hits[0]).toEqual({ x: 2, y: 1, z: 0, name: "torch", distance: 1.5 });
    expect(hits[1]?.face?.side).toBe("west");
  });

  test("sees no side of the water the eye is in, and sees out of it", () => {
    const pool = world({ "0,1,0": water, "1,1,0": water, "3,1,0": stone, "0,-1,0": stone });
    const under = { x: 0.5, y: 1.4, z: 0.5 };

    expect(cast(under, east, 16, pool).hits.map((hit) => hit.name)).toEqual(["stone"]);
    expect(cast(under, down, 16, pool).hits.map((hit) => hit.name)).toEqual(["stone"]);
  });

  test("stays in the water through a block that stands in water", () => {
    const grass: Cell = { name: "seagrass", shapes: full, sight: "passes", within: "water" };
    const pool = world({ "2,1,0": water, "3,1,0": grass, "4,1,0": water, "6,1,0": stone });
    const { hits } = cast({ x: 0.5, y: 1.4, z: 0.5 }, east, 16, pool);

    expect(hits.map((hit) => [hit.name, hit.x])).toEqual([
      ["water", 2],
      ["seagrass", 3],
      ["stone", 6],
    ]);
  });

  test("stays in the water past a low block that stands in water", () => {
    const hatch: Cell = {
      name: "iron_trapdoor",
      shapes: [[0, 0, 0, 1, 0.1875, 1]],
      sight: "ends",
      within: "water",
    };
    const pool = world({ "0,1,0": hatch, "1,1,0": water, "3,1,0": stone });
    const { hits } = cast({ x: 0.5, y: 1.5, z: 0.5 }, east, 16, pool);

    expect(hits.map((hit) => hit.name)).toEqual(["stone"]);
  });

  test("stops where the world is not loaded and says so", () => {
    expect(cast(eye, east, 16, loadedUpTo4)).toEqual({ hits: [], unloaded: true });
    expect(cast(eye, east, 2, loadedUpTo4)).toEqual({ hits: [], unloaded: false });
  });
});
