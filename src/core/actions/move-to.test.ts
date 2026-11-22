import { describe, expect, test } from "bun:test";

import { between, blocksLeft, failure, noAnswer, waysLeftOff } from "./move-to.ts";

describe("between", () => {
  test("counts from block to block", () => {
    expect(between({ x: 0.9, y: 64.2, z: 0.1 }, { x: 3, y: 64, z: 4 })).toBe(5);
    expect(between({ x: 3, y: 65, z: 4 }, { x: 3, y: 66, z: 4 })).toBe(1);
  });
});

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

describe("failure", () => {
  const position = { x: 3, y: 66, z: 4 };
  const spot = { block: "air", under: "stone" };

  test("says where the path ends and what is at the position", () => {
    const route = { answer: "unreachable", end: { x: 2, y: 64, z: 4 }, steps: 3 } as const;

    expect(failure(route, 6, position, spot, ["canDig", "canPlace"])).toBe(
      "No path leads to the position. The bot is 6.0 blocks away. The path that the search found ends at 2, 64, 4, which is 2.2 blocks from the position. The position holds air, and under it is stone. This call did not allow canDig, canPlace.",
    );
  });

  test("says so when the path has no steps", () => {
    const route = { answer: "unreachable", end: { x: 2, y: 64, z: 4 }, steps: 0 } as const;

    expect(failure(route, 2.2, position, spot, [])).toBe(
      "No path leads to the position. The bot is 2.2 blocks away. The path that the search found ends where the bot stands. The position holds air, and under it is stone.",
    );
  });

  test("names the block the position is inside of", () => {
    const route = { answer: "unreachable", end: { x: 2, y: 64, z: 4 }, steps: 0 } as const;

    expect(failure(route, 1, position, { block: "stone", under: "stone" }, [])).toContain(
      "The position holds stone, and under it is stone.",
    );
  });

  test("claims no dead end when the search ran out of time", () => {
    const route = { answer: "undecided", end: { x: 2, y: 64, z: 4 }, steps: 0 } as const;

    expect(failure(route, 3, position, spot, [])).toBe(
      "The search for a path ran out of time without an answer. The bot is 3.0 blocks away. The position holds air, and under it is stone.",
    );
  });

  test("says so when the search then found a path", () => {
    const route = { answer: "reaches", end: position, steps: 4 } as const;

    expect(failure(route, 3, position, spot, [])).toBe(
      "The walk found no path, and a search right after it found one. The bot is 3.0 blocks away. Something in the way may have changed. Call move_to again.",
    );
  });
});

describe("noAnswer", () => {
  test("tells a search that ran out of time from one that found no path", () => {
    expect(noAnswer(10, { block: "air", under: "air" }, ["canDig"])).toBe(
      "The search for a path ran out of time without an answer. The bot is 10.0 blocks away. The position holds air, and under it is air. This call did not allow canDig.",
    );
  });

  test("says so when the position is not loaded", () => {
    expect(noAnswer(300, { block: "unloaded", under: "unloaded" }, [])).toBe(
      "The search for a path ran out of time without an answer. The bot is 300.0 blocks away. The position is in a part of the world that is not loaded.",
    );
  });
});
