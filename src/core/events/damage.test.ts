import { describe, expect, test } from "bun:test";

import { damageTaken } from "./damage.ts";

describe("damageTaken", () => {
  test("is the health that was lost", () => {
    expect(damageTaken(20, 17)).toBe(3);
    expect(damageTaken(4.5, 0)).toBe(4.5);
  });

  test("is nothing when health stayed the same", () => {
    expect(damageTaken(20, 20)).toBeUndefined();
  });

  test("is nothing when health came back", () => {
    expect(damageTaken(17, 18)).toBeUndefined();
    expect(damageTaken(0, 20)).toBeUndefined();
  });
});
