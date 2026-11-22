import { describe, expect, test } from "bun:test";

import { blocksLeft, waysLeftOff } from "./move-to.ts";

describe("blocksLeft", () => {
  test("is zero anywhere inside the block of the position", () => {
    expect(blocksLeft({ x: -1.5, y: 64, z: 0.5 }, { x: -2, y: 64, z: 0 })).toBe(0);
    expect(blocksLeft({ x: 3.9, y: 64, z: 3.1 }, { x: 3.2, y: 64.5, z: 3.7 })).toBe(0);
  });

  test("counts whole blocks", () => {
    expect(blocksLeft({ x: -0.5, y: 125.47, z: 0.5 }, { x: -2, y: 125, z: 0 })).toBe(1);
    expect(blocksLeft({ x: 0.5, y: 64, z: 0.5 }, { x: 3, y: 64, z: 4 })).toBe(5);
  });

  test("is zero for a bot that stands on a slab under the position", () => {
    expect(blocksLeft({ x: 2.5, y: 127.5, z: 0.5 }, { x: 2, y: 128, z: 0 })).toBe(0);
  });
});

describe("waysLeftOff", () => {
  test("names what the call did not allow", () => {
    expect(waysLeftOff({ canDig: false, canPlace: false, allowParkour: true })).toEqual([
      "canDig",
      "canPlace",
    ]);
    expect(waysLeftOff({ canDig: true, canPlace: false, allowParkour: false })).toEqual([
      "canPlace",
      "allowParkour",
    ]);
  });

  test("is empty when everything was allowed", () => {
    expect(waysLeftOff({ canDig: true, canPlace: true, allowParkour: true })).toEqual([]);
  });
});
