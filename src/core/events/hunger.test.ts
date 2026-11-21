import { describe, expect, test } from "bun:test";

import { foodRanLow } from "./hunger.ts";

describe("foodRanLow", () => {
  test("reports each further drop once food is at the limit or below", () => {
    expect(foodRanLow(7, 6, 6)).toBe(true);
    expect(foodRanLow(6, 5, 6)).toBe(true);
    expect(foodRanLow(1, 0, 6)).toBe(true);
  });

  test("stays quiet while food is above the limit", () => {
    expect(foodRanLow(20, 19, 6)).toBe(false);
  });

  test("stays quiet when food did not change", () => {
    expect(foodRanLow(4, 4, 6)).toBe(false);
  });

  test("stays quiet after eating", () => {
    expect(foodRanLow(3, 9, 6)).toBe(false);
    expect(foodRanLow(3, 5, 6)).toBe(false);
  });
});
