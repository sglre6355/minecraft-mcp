import { describe, expect, test } from "bun:test";

import type { Recipe, RecipeBook } from "./crafting.ts";

import { planCrafting } from "./crafting.ts";

function book(recipes: Array<[string, Array<Recipe>]>): RecipeBook {
  const known = new Map(recipes);
  return (item) => known.get(item) ?? [];
}

const wood = book([
  ["oak_planks", [{ makes: 4, needs: [{ name: "oak_log", count: 1 }], table: false }]],
  ["stick", [{ makes: 4, needs: [{ name: "oak_planks", count: 2 }], table: false }]],
  [
    "wooden_pickaxe",
    [
      {
        makes: 1,
        needs: [
          { name: "oak_planks", count: 3 },
          { name: "stick", count: 2 },
        ],
        table: true,
      },
    ],
  ],
]);

describe("planCrafting", () => {
  test("crafts what is missing on the way, in order", () => {
    const plan = planCrafting(wood, "wooden_pickaxe", 1, [{ name: "oak_log", count: 2 }]);

    expect(plan).toEqual({
      steps: [
        { item: "oak_planks", times: 1, makes: 4, table: false },
        { item: "oak_planks", times: 1, makes: 4, table: false },
        { item: "stick", times: 1, makes: 4, table: false },
        { item: "wooden_pickaxe", times: 1, makes: 1, table: true },
      ],
      missing: [],
    });
  });

  test("uses what is in stock before crafting more", () => {
    const plan = planCrafting(wood, "wooden_pickaxe", 1, [
      { name: "oak_planks", count: 3 },
      { name: "stick", count: 2 },
    ]);

    expect(plan.steps).toEqual([{ item: "wooden_pickaxe", times: 1, makes: 1, table: true }]);
  });

  test("names what has to be found first", () => {
    const plan = planCrafting(wood, "stick", 8, []);

    expect(plan).toEqual({
      steps: [
        { item: "oak_planks", times: 1, makes: 4, table: false },
        { item: "stick", times: 2, makes: 8, table: false },
      ],
      missing: [{ name: "oak_log", count: 1 }],
    });
  });

  test("crafts more of an item the stock already holds", () => {
    const plan = planCrafting(wood, "stick", 4, [
      { name: "stick", count: 64 },
      { name: "oak_planks", count: 2 },
    ]);

    expect(plan.steps).toEqual([{ item: "stick", times: 1, makes: 4, table: false }]);
  });

  test("picks the recipe the stock can pay for", () => {
    const planks = book([
      [
        "stick",
        [
          { makes: 4, needs: [{ name: "oak_planks", count: 2 }], table: false },
          { makes: 4, needs: [{ name: "birch_planks", count: 2 }], table: false },
        ],
      ],
    ]);

    const plan = planCrafting(planks, "stick", 4, [{ name: "birch_planks", count: 2 }]);

    expect(plan).toEqual({
      steps: [{ item: "stick", times: 1, makes: 4, table: false }],
      missing: [],
    });
  });

  test("treats an item as found, not crafted, when its recipes only undo each other", () => {
    const iron = book([
      [
        "iron_ingot",
        [
          { makes: 9, needs: [{ name: "iron_block", count: 1 }], table: false },
          { makes: 1, needs: [{ name: "iron_nugget", count: 9 }], table: true },
        ],
      ],
      ["iron_block", [{ makes: 1, needs: [{ name: "iron_ingot", count: 9 }], table: true }]],
      ["iron_nugget", [{ makes: 9, needs: [{ name: "iron_ingot", count: 1 }], table: false }]],
      ["bucket", [{ makes: 1, needs: [{ name: "iron_ingot", count: 3 }], table: true }]],
    ]);

    const plan = planCrafting(iron, "bucket", 1, []);

    expect(plan).toEqual({
      steps: [{ item: "bucket", times: 1, makes: 1, table: true }],
      missing: [{ name: "iron_ingot", count: 3 }],
    });
  });
});
