import { describe, expect, test } from "bun:test";

import { fuelNeeded } from "./furnace.ts";

describe("fuelNeeded", () => {
  test("counts eight items for each piece of coal", () => {
    expect(fuelNeeded("coal", 1, 10)).toBe(1);
    expect(fuelNeeded("coal", 8, 10)).toBe(1);
    expect(fuelNeeded("coal", 9, 10)).toBe(2);
  });

  test("counts one item for each piece of a fuel it does not know", () => {
    expect(fuelNeeded("oak_planks", 3, 10)).toBe(3);
  });

  test("is no more than the bot carries", () => {
    expect(fuelNeeded("oak_planks", 5, 2)).toBe(2);
    expect(fuelNeeded("coal", 1, 0)).toBe(0);
  });
});
