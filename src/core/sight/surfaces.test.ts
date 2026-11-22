import { describe, expect, test } from "bun:test";

import type { Shape, Side } from "./cast.ts";
import type { Seen } from "./surfaces.ts";

import { surfaces } from "./surfaces.ts";

// A full block of which the given sides are in view.
function block(name: string, x: number, y: number, z: number, sides: Array<Side>): Seen {
  const box: Shape = [x, y, z, x + 1, y + 1, z + 1];
  return { name, x, y, z, distance: 1, faces: sides.map((side) => ({ side, box })) };
}

const everything = { touching: true, most: 100 };

describe("surfaces", () => {
  test("joins the tops of a floor into one surface with exact edges", () => {
    const floor = [0, 1, 2].flatMap((x) => [0, 1].map((z) => block("stone", x, 4, z, ["up"])));

    expect(surfaces(floor, everything)).toEqual({
      listed: [{ faces: "up", y: 5, x: [0, 3], z: [0, 2], blocks: 6, kinds: ["stone"] }],
      omitted: 0,
    });
  });

  test("describes an upright surface by the level direction and the height", () => {
    const wall = [0, 1, 2].flatMap((y) => [5, 6].map((z) => block("stone", 9, y, z, ["west"])));

    expect(surfaces(wall, everything).listed).toEqual([
      { faces: "west", x: 9, z: [5, 7], y: [0, 3], blocks: 6, kinds: ["stone"] },
    ]);
  });

  test("puts a side that faces north or south on a z plane", () => {
    const wall = [block("stone", 2, 0, 7, ["south"]), block("stone", 3, 0, 7, ["south"])];

    expect(surfaces(wall, everything).listed).toEqual([
      { faces: "south", z: 8, x: [2, 4], y: [0, 1], blocks: 2, kinds: ["stone"] },
    ]);
  });

  test("keeps sides that face different ways apart", () => {
    const corner = [block("stone", 0, 0, 0, ["up", "west"])];

    expect(surfaces(corner, everything).listed.map((surface) => surface.faces)).toEqual(
      expect.arrayContaining(["up", "west"]),
    );
  });

  test("keeps tops at different heights apart", () => {
    const slab: Seen = {
      name: "stone_slab",
      x: 1,
      y: 4,
      z: 0,
      distance: 1,
      faces: [{ side: "up", box: [1, 4, 0, 2, 4.5, 1] }],
    };
    const found = surfaces([block("stone", 0, 4, 0, ["up"]), slab], everything).listed;

    expect(found).toHaveLength(2);
    expect(found).toContainEqual({
      faces: "up",
      y: 4.5,
      x: [1, 2],
      z: [0, 1],
      blocks: 1,
      kinds: ["stone_slab"],
    });
  });

  test("splits a plane into the parts that touch", () => {
    const tops = [block("stone", 0, 4, 0, ["up"]), block("stone", 5, 4, 0, ["up"])];

    expect(surfaces(tops, everything).listed).toHaveLength(2);
    expect(surfaces(tops, { touching: false, most: 100 }).listed).toEqual([
      { faces: "up", y: 5, x: [0, 6], z: [0, 1], blocks: 2, kinds: ["stone"] },
    ]);
  });

  test("counts blocks that touch only at a corner as one part", () => {
    const tops = [block("stone", 0, 4, 0, ["up"]), block("stone", 1, 4, 1, ["up"])];

    expect(surfaces(tops, everything).listed).toHaveLength(1);
  });

  test("names the two most common kinds of a surface", () => {
    const floor = [
      block("dirt", 0, 4, 0, ["up"]),
      block("stone", 1, 4, 0, ["up"]),
      block("stone", 2, 4, 0, ["up"]),
      block("sand", 3, 4, 0, ["up"]),
      block("sand", 4, 4, 0, ["up"]),
      block("sand", 5, 4, 0, ["up"]),
    ];

    expect(surfaces(floor, everything).listed[0]?.kinds).toEqual(["sand", "stone"]);
  });

  test("lists the largest surfaces and counts the rest", () => {
    const tops = [
      block("stone", 0, 4, 0, ["up"]),
      block("stone", 10, 4, 0, ["up"]),
      block("stone", 11, 4, 0, ["up"]),
      block("stone", 20, 4, 0, ["up"]),
      block("stone", 21, 4, 0, ["up"]),
      block("stone", 22, 4, 0, ["up"]),
    ];
    const found = surfaces(tops, { touching: true, most: 2 });

    expect(found.listed.map((surface) => surface.blocks)).toEqual([3, 2]);
    expect(found.omitted).toBe(1);
  });
});
