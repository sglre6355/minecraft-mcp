import { describe, expect, test } from "bun:test";

import { airLevel, airRanLow } from "./oxygen.ts";

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
  test("reports each further drop once air is at the limit or below", () => {
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
