import { describe, expect, test } from "bun:test";

import { airLevel, airRanLow, lowestAir } from "./oxygen.ts";

describe("airLevel", () => {
  test("is the reading while the bot has air", () => {
    expect(airLevel(20)).toBe(20);
    expect(airLevel(7)).toBe(7);
    expect(airLevel(0)).toBe(0);
  });

  test("is full before the server has reported any air", () => {
    expect(airLevel(undefined)).toBe(20);
  });

  test("is empty while the bot drowns and the reading dips below zero", () => {
    expect(airLevel(-1)).toBe(0);
  });
});

describe("airRanLow", () => {
  test("reports each new low once air is at the limit or below", () => {
    expect(airRanLow(11, 10, 10)).toBe(true);
    expect(airRanLow(10, 9, 10)).toBe(true);
    expect(airRanLow(1, 0, 10)).toBe(true);
  });

  test("stays quiet while air is above the limit", () => {
    expect(airRanLow(20, 19, 10)).toBe(false);
    expect(airRanLow(12, 11, 10)).toBe(false);
  });

  test("stays quiet when the same level is reported again", () => {
    expect(airRanLow(8, 8, 10)).toBe(false);
  });

  test("stays quiet while air comes back", () => {
    expect(airRanLow(5, 6, 10)).toBe(false);
  });
});

describe("lowestAir", () => {
  test("follows the air down", () => {
    expect(lowestAir(20, 15)).toBe(15);
    expect(lowestAir(9, 8)).toBe(8);
  });

  test("holds while the air comes back part of the way", () => {
    expect(lowestAir(7, 8)).toBe(7);
    expect(lowestAir(7, 19)).toBe(7);
  });

  test("starts over once the air is full", () => {
    expect(lowestAir(0, 20)).toBe(20);
  });
});

// The levels reported for a run of readings, the way the source walks through them.
function reported(readings: Array<number>, atMost: number): Array<number> {
  const levels: Array<number> = [];
  let lowest = 20;
  for (const reading of readings) {
    if (airRanLow(lowest, reading, atMost)) {
      levels.push(reading);
    }
    lowest = lowestAir(lowest, reading);
  }
  return levels;
}

describe("a run of readings", () => {
  test("reports a level once while the air flickers around it", () => {
    expect(reported([12, 10, 9, 8, 7, 8, 7, 8, 7, 6, 7, 6], 10)).toEqual([10, 9, 8, 7, 6]);
  });

  test("reports again after the air has been full", () => {
    expect(reported([9, 8, 14, 20, 12, 9], 10)).toEqual([9, 8, 9]);
  });

  test("does not report again after air that only came back part of the way", () => {
    expect(reported([9, 8, 19, 12, 9, 8, 7], 10)).toEqual([9, 8, 7]);
  });
});
