import { describe, expect, test } from "bun:test";

import { digest } from "./look-around.ts";

describe("digest", () => {
  test("counts each kind and keeps its nearest block", () => {
    const kinds = digest(
      [
        { name: "stone", x: 5, y: 0, z: 0 },
        { name: "stone", x: 1, y: 0, z: 0 },
        { name: "oak_log", x: 3, y: 0, z: 0 },
      ],
      { x: 0.5, y: 0.5, z: 0.5 },
    );

    expect(kinds).toEqual([
      { name: "stone", count: 2, nearest: { x: 1, y: 0, z: 0 }, distance: 1 },
      { name: "oak_log", count: 1, nearest: { x: 3, y: 0, z: 0 }, distance: 3 },
    ]);
  });

  test("measures from the origin to the middle of the block", () => {
    const [kind] = digest([{ name: "dirt", x: 0, y: -1, z: 0 }], { x: 0.5, y: 0, z: 0.5 });

    expect(kind?.distance).toBe(0.5);
  });

  test("is empty when nothing is around", () => {
    expect(digest([], { x: 0, y: 0, z: 0 })).toEqual([]);
  });
});
