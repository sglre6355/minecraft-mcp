import { describe, expect, test } from "bun:test";

import { foothold, standsStill } from "./walk.ts";

const start = { at: { x: 0.5, y: 64, z: 0.5 }, since: 1000 };

describe("foothold", () => {
  test("stays where it is while the bot does", () => {
    expect(foothold(start, { x: 0.5, y: 64, z: 0.5 }, 5000, false)).toBe(start);
  });

  test("stays where it is while the bot moves less than a block", () => {
    expect(foothold(start, { x: 1.2, y: 64.4, z: 0.9 }, 5000, false)).toBe(start);
  });

  test("moves once the bot has come a block away", () => {
    const position = { x: 1.5, y: 64, z: 0.5 };

    expect(foothold(start, position, 5000, false)).toEqual({ at: position, since: 5000 });
  });

  test("counts a climb as moving", () => {
    const position = { x: 0.5, y: 65, z: 0.5 };

    expect(foothold(start, position, 5000, false)).toEqual({ at: position, since: 5000 });
  });

  test("moves while the bot is busy in one place", () => {
    const position = { x: 0.5, y: 64, z: 0.5 };

    expect(foothold(start, position, 5000, true)).toEqual({ at: position, since: 5000 });
  });
});

describe("standsStill", () => {
  test("fails while the foothold is young", () => {
    expect(standsStill(start, 10_999)).toBe(false);
  });

  test("holds once the foothold is ten seconds old", () => {
    expect(standsStill(start, 11_000)).toBe(true);
  });
});
