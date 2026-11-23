import { describe, expect, test } from "bun:test";

import type { Hit, Shape, Side } from "./cast.ts";
import type { Seen } from "./surfaces.ts";

import { describe as describeView, gather, lumps, spotted } from "./view.ts";

function hit(x: number, y: number, z: number, distance: number, side: Side = "up"): Hit {
  const face = { side, box: [x, y, z, x + 1, y + 1, z + 1] } satisfies Hit["face"];
  return { x, y, z, name: "stone", distance, face };
}

// A full block whose top is in view.
function seen(name: string, x: number, y: number, z: number, distance: number): Seen {
  const box: Shape = [x, y, z, x + 1, y + 1, z + 1];
  return { name, x, y, z, distance, faces: [{ side: "up", box }] };
}

describe("gather", () => {
  test("makes one block of the hits that several rays score on it", () => {
    const { seen: blocks } = gather([
      { hits: [hit(1, 2, 3, 5)], unloaded: false },
      { hits: [hit(1, 2, 3, 4)], unloaded: false },
      { hits: [hit(1, 2, 3, 6, "west")], unloaded: false },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ x: 1, y: 2, z: 3, name: "stone", distance: 4 });
    expect(blocks[0]?.faces.map((face) => face.side)).toEqual(["up", "west"]);
  });

  test("keeps a block that showed no side", () => {
    const { seen: blocks } = gather([
      { hits: [{ x: 1, y: 2, z: 3, name: "torch", distance: 2 }], unloaded: false },
    ]);

    expect(blocks).toEqual([{ x: 1, y: 2, z: 3, name: "torch", distance: 2, faces: [] }]);
  });

  test("keeps every block that one ray reaches", () => {
    const { seen: blocks } = gather([
      { hits: [hit(1, 0, 0, 1), hit(3, 0, 0, 3)], unloaded: false },
    ]);

    expect(blocks).toHaveLength(2);
  });

  test("gives the share of rays that ran into the edge of the loaded world", () => {
    const { unloaded } = gather([
      { hits: [], unloaded: true },
      { hits: [], unloaded: false },
      { hits: [], unloaded: false },
      { hits: [], unloaded: false },
    ]);

    expect(unloaded).toBe(0.25);
  });
});

describe("lumps", () => {
  test("puts blocks that touch into one lump, corners included", () => {
    const blocks = [seen("stone", 0, 0, 0, 1), seen("dirt", 1, 1, 1, 1), seen("stone", 5, 0, 0, 1)];

    const found = lumps(blocks, 1);

    expect(found.map((lump) => lump.length).toSorted((a, b) => a - b)).toEqual([1, 2]);
  });

  test("bridges gaps with larger cells", () => {
    const blocks = [
      seen("stone", 0, 0, 0, 1),
      seen("stone", 3, 0, 0, 1),
      seen("stone", 30, 0, 0, 1),
    ];

    expect(lumps(blocks, 1)).toHaveLength(3);
    expect(lumps(blocks, 6)).toHaveLength(2);
  });
});

describe("spotted", () => {
  const blocks = [
    seen("oak_sign", 9, 0, 0, 9.04),
    seen("stone", 1, 0, 0, 1),
    seen("oak_sign", 3, 0, 0, 3.16),
    seen("oak_sign", 6, 1, 2, 6.5),
  ];

  test("lists the blocks of one kind, nearest first, with how far away they are", () => {
    expect(spotted(blocks, "oak_sign", 10)).toEqual({
      positions: [
        { x: 3, y: 0, z: 0, distance: 3.2 },
        { x: 6, y: 1, z: 2, distance: 6.5 },
        { x: 9, y: 0, z: 0, distance: 9 },
      ],
      omitted: 0,
    });
  });

  test("keeps the nearest ones and counts the rest", () => {
    const found = spotted(blocks, "oak_sign", 2);

    expect(found.positions.map((block) => block.x)).toEqual([3, 6]);
    expect(found.omitted).toBe(1);
  });

  test("is empty when no block of the kind is in view", () => {
    expect(spotted(blocks, "chest", 10)).toEqual({ positions: [], omitted: 0 });
  });
});

const eye = { x: 0.5, y: 1.62, z: 0.5, in: "air" };
const limits = { near: 6, middle: 24 };

describe("describe", () => {
  test("sorts blocks into three bands by distance", () => {
    const view = describeView(
      eye,
      [seen("stone", 0, -1, 0, 1.6), seen("stone", 10, 0, 0, 10), seen("stone", 40, 0, 0, 40)],
      0,
      limits,
    );

    expect(view.near.within).toBe(6);
    expect(view.near.surfaces.listed).toHaveLength(1);
    expect(view.middle.within).toBe(24);
    expect(view.middle.lumps).toHaveLength(1);
    expect(view.far.lumps).toHaveLength(1);
  });

  test("lists what is rare in view block by block, and counts the rest by kind", () => {
    const floor = [0, 1, 2, 3, 4].map((x) => seen("stone", x, -1, 0, 2));
    const view = describeView(eye, [...floor, seen("chest", 2, 0, 1, 2)], 0, limits);

    expect(view.near.kinds).toEqual([{ name: "stone", count: 5 }]);
    expect(view.near.rare).toEqual([{ name: "chest", coordinates: { x: 2, y: 0, z: 1 } }]);
  });

  test("counts a kind as rare by how much of it is in the whole view", () => {
    const near = [0, 1, 2].map((x) => seen("stone", x, -1, 0, 2));
    const far = [10, 11].map((x) => seen("stone", x, -1, 0, 10));
    const view = describeView(eye, [...near, ...far], 0, limits);

    expect(view.near.rare).toEqual([]);
    expect(view.near.kinds).toEqual([{ name: "stone", count: 3 }]);
  });

  test("gives a lump its distance, its edges, its surfaces and its main kinds", () => {
    const tower = [0, 1, 2, 3, 4, 5].map((y) => seen("stone", 10, y, 0, 10 + y));
    const view = describeView(eye, tower, 0, limits);

    expect(view.middle.lumps).toEqual([
      {
        distance: 10,
        x: [10, 11],
        y: [0, 6],
        z: [0, 1],
        blocks: 6,
        surfaces: { listed: expect.any(Array), omitted: expect.any(Number) },
        kinds: [{ name: "stone", count: 6 }],
        rare: [],
      },
    ]);
  });

  test("puts the nearest lump first", () => {
    const view = describeView(
      eye,
      [seen("stone", 20, 0, 0, 20), seen("stone", 10, 0, 0, 10)],
      0,
      limits,
    );

    expect(view.middle.lumps.map((lump) => lump.distance)).toEqual([10, 20]);
  });

  test("lists the largest lumps of the middle band and counts the rest", () => {
    const big = Array.from({ length: 12 }, (_, index) => [
      seen("stone", 10, index * 4, 0, 10 + index),
      seen("stone", 10, index * 4 + 1, 0, 10 + index),
    ]).flat();
    const small = [seen("dirt", 8, 0, 8, 9), seen("dirt", 8, 0, 14, 12)];
    const view = describeView(eye, [...big, ...small], 0, limits);

    expect(view.middle.lumps).toHaveLength(12);
    expect(view.middle.lumps.every((lump) => lump.blocks === 2)).toBe(true);
    expect(view.middle.omitted).toBe(2);
  });

  test("gives a far lump only its edges and its two main kinds", () => {
    const hill = [
      seen("grass_block", 40, 0, 0, 40),
      seen("grass_block", 41, 0, 0, 41),
      seen("dirt", 41, -1, 0, 41),
      seen("stone", 42, -2, 0, 42),
      seen("grass_block", 42, 0, 0, 42),
      seen("dirt", 42, -1, 0, 42),
    ];
    const view = describeView(eye, hill, 0, limits);

    expect(view.far.lumps).toEqual([
      { distance: 40, x: [40, 43], y: [-2, 1], z: [0, 1], kinds: ["grass_block", "dirt"] },
    ]);
  });

  test("lists the largest far lumps and counts the rest", () => {
    const specks = Array.from({ length: 20 }, (_, index) =>
      seen("stone", 40 + index * 20, 0, 0, 40),
    );
    const view = describeView(eye, specks, 0, limits);

    expect(view.far.lumps).toHaveLength(16);
    expect(view.far.omitted).toBe(4);
  });

  test("passes on the eye, what it is in and the share of unloaded rays", () => {
    const view = describeView({ ...eye, in: "water" }, [], 0.25, limits);

    expect(view.eye).toEqual({ x: 0.5, y: 1.6, z: 0.5, in: "water" });
    expect(view.unloaded).toBe(0.25);
  });
});
