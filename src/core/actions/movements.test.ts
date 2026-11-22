import { describe, expect, test } from "bun:test";

import { climbsOut, coversMiddle } from "./movements.ts";

describe("coversMiddle", () => {
  test("holds for a full block", () => {
    expect(coversMiddle([[0, 0, 0, 1, 1, 1]])).toBe(true);
  });

  test("holds for a slab and for a closed trapdoor", () => {
    expect(coversMiddle([[0, 0, 0, 1, 0.5, 1]])).toBe(true);
    expect(coversMiddle([[0, 0.8125, 0, 1, 1, 1]])).toBe(true);
  });

  test("fails for an open trapdoor, which stands at one edge", () => {
    expect(coversMiddle([[0, 0, 0.8125, 1, 1, 1]])).toBe(false);
    expect(coversMiddle([[0.8125, 0, 0, 1, 1, 1]])).toBe(false);
  });

  test("fails for an open gate, which has no box", () => {
    expect(coversMiddle([])).toBe(false);
  });

  test("holds when any one box covers the middle", () => {
    expect(
      coversMiddle([
        [0, 0, 0, 0.25, 1, 1],
        [0.25, 0, 0.25, 0.75, 1, 0.75],
      ]),
    ).toBe(true);
  });
});

describe("climbsOut", () => {
  test("reaches a rim level with the water", () => {
    expect(climbsOut(62, 63)).toBe(true);
  });

  test("reaches a slab on the rim", () => {
    expect(climbsOut(62, 63.5)).toBe(true);
  });

  test("does not reach a full block on the rim", () => {
    expect(climbsOut(62, 64)).toBe(false);
  });
});
