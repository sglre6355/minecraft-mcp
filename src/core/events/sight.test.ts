import { describe, expect, test } from "bun:test";

import { bandOf, forgets, newBand } from "./sight.ts";

describe("bandOf", () => {
  test("gives the nearest band a distance lies within", () => {
    expect(bandOf(3)).toBe(6);
    expect(bandOf(6)).toBe(6);
    expect(bandOf(6.1)).toBe(12);
    expect(bandOf(20)).toBe(24);
  });

  test("gives nothing beyond the farthest band", () => {
    expect(bandOf(24.1)).toBeUndefined();
  });
});

describe("newBand", () => {
  test("reports an entity seen for the first time in the band it is in", () => {
    expect(newBand(undefined, 20)).toBe(24);
    expect(newBand(undefined, 10)).toBe(12);
  });

  test("reports an entity again once it is in a nearer band", () => {
    expect(newBand(24, 11)).toBe(12);
    expect(newBand(12, 5)).toBe(6);
  });

  test("does not report an entity again in a band reported before or farther out", () => {
    expect(newBand(12, 11)).toBeUndefined();
    expect(newBand(12, 20)).toBeUndefined();
    expect(newBand(6, 5)).toBeUndefined();
  });

  test("does not report an entity beyond the farthest band", () => {
    expect(newBand(undefined, 26)).toBeUndefined();
  });
});

describe("forgets", () => {
  test("keeps an entity that moves along the edge of the farthest band", () => {
    expect(forgets(25)).toBe(false);
    expect(forgets(28)).toBe(false);
  });

  test("forgets an entity well beyond the farthest band", () => {
    expect(forgets(28.1)).toBe(true);
  });
});
