import { describe, expect, test } from "bun:test";

import { boxAround, columns } from "./cells.ts";

// What a ray crossed, by "x,y,z". Everything else is out of view.
function crossed(cells: { [position: string]: string }) {
  return (x: number, y: number, z: number) => cells[`${x},${y},${z}`];
}

describe("boxAround", () => {
  test("is nine blocks wide and deep and nine high, with more of it above the middle", () => {
    expect(boxAround({ x: 10.5, y: 64, z: 20.5 })).toEqual({
      x: [6, 14],
      y: [61, 69],
      z: [16, 24],
    });
  });

  test("takes the block that a position lies in", () => {
    expect(boxAround({ x: -0.5, y: -60.2, z: 0 })).toEqual({
      x: [-5, 3],
      y: [-64, -56],
      z: [-4, 4],
    });
  });
});

describe("columns", () => {
  const box = { x: [0, 1], y: [0, 3], z: [0, 0] } as const;

  test("names what the cells of a column hold, from the lowest up", () => {
    const known = crossed({ "0,0,0": "stone", "0,1,0": "torch", "0,2,0": "air", "0,3,0": "air" });

    expect(columns(box, known)).toEqual([
      {
        x: 0,
        z: 0,
        cells: [
          [0, 0, "stone"],
          [1, 1, "torch"],
          [2, 3, "air"],
        ],
      },
    ]);
  });

  test("marks the cells that no ray crossed", () => {
    const known = crossed({ "1,2,0": "gravel", "1,3,0": "air" });

    expect(columns(box, known)).toEqual([
      {
        x: 1,
        z: 0,
        cells: [
          [0, 1, "unseen"],
          [2, 2, "gravel"],
          [3, 3, "air"],
        ],
      },
    ]);
  });

  test("leaves out a column without a cell in view", () => {
    expect(columns(box, crossed({}))).toEqual([]);
  });

  test("goes through the columns by x and then by z", () => {
    const wide = { x: [0, 1], y: [0, 0], z: [0, 1] } as const;
    const known = crossed({ "0,0,0": "air", "0,0,1": "air", "1,0,0": "air", "1,0,1": "air" });

    expect(columns(wide, known).map(({ x, z }) => [x, z])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });
});
