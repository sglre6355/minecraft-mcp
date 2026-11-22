import { describe, expect, test } from "bun:test";

import { foothold, routeOf, standsStill } from "./walk.ts";

function step(x: number, y: number, z: number, more: { parkour?: boolean } = {}) {
  return { x, y, z, parkour: more.parkour ?? false, toBreak: [], toPlace: [] };
}

describe("routeOf", () => {
  const start = { x: 0, y: 64, z: 0 };

  test("ends at the last step of a path that reaches the goal", () => {
    const path = [step(1, 64, 0), step(2, 64, 0), step(3, 65, 0)];

    expect(routeOf("success", path, start)).toEqual({
      answer: "reaches",
      end: { x: 3, y: 65, z: 0 },
      steps: 3,
      jumps: 0,
      breaks: 0,
      places: 0,
    });
  });

  test("ends where the bot stands when the path has no steps", () => {
    expect(routeOf("noPath", [], start)).toMatchObject({
      answer: "unreachable",
      end: start,
      steps: 0,
    });
  });

  test("keeps the part of a path that a search found before it ran out of time", () => {
    expect(routeOf("timeout", [step(1, 64, 0)], start)).toMatchObject({
      answer: "undecided",
      end: { x: 1, y: 64, z: 0 },
      steps: 1,
    });
  });

  test("counts the jumps over gaps and the blocks to break and to place", () => {
    const bridge = { ...step(4, 64, 0), toPlace: [step(4, 63, 0)] };
    const tunnel = { ...step(5, 64, 0), toBreak: [step(5, 64, 0), step(5, 65, 0)] };
    const path = [step(3, 64, 0, { parkour: true }), bridge, tunnel];

    expect(routeOf("success", path, start)).toMatchObject({ jumps: 1, breaks: 2, places: 1 });
  });
});

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
