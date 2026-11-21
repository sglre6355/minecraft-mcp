import { describe, expect, test } from "bun:test";

import { affordableRounds, roundsFor } from "./craft.ts";

describe("affordableRounds", () => {
  const pickaxe = [
    { name: "oak_planks", count: 3 },
    { name: "stick", count: 2 },
  ];

  test("is as many rounds as the scarcest material allows", () => {
    const stock = [
      { name: "oak_planks", count: 9 },
      { name: "stick", count: 5 },
    ];

    expect(affordableRounds(pickaxe, stock)).toBe(2);
  });

  test("is zero when a material is missing", () => {
    expect(affordableRounds(pickaxe, [{ name: "oak_planks", count: 9 }])).toBe(0);
  });
});

describe("roundsFor", () => {
  test("is one round for one item", () => {
    expect(roundsFor(1, 1)).toBe(1);
  });

  test("rounds up when a recipe makes several at once", () => {
    expect(roundsFor(1, 4)).toBe(1);
    expect(roundsFor(4, 4)).toBe(1);
    expect(roundsFor(5, 4)).toBe(2);
  });
});
