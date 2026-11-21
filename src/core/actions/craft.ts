import { z } from "zod";

import { craftingTableRange, nearestCraftingTable, recipeBook } from "../crafting.ts";
import type { Stack } from "../items.ts";

import { countByName, countOf, itemNamed } from "../items.ts";
import { defineAction } from "./action.ts";
import { approach } from "./reach.ts";

// The rounds of a recipe that give at least `count` items.
export function roundsFor(count: number, makes: number): number {
  return Math.ceil(count / makes);
}

// The rounds of a recipe the stock pays for.
export function affordableRounds(needs: ReadonlyArray<Stack>, stock: ReadonlyArray<Stack>): number {
  const have = new Map(stock.map((stack) => [stack.name, stack.count]));
  return Math.min(...needs.map((need) => Math.floor((have.get(need.name) ?? 0) / need.count)));
}

export const craft = defineAction({
  name: "craft",
  description:
    "Craft an item from what the bot carries. Walks to a crafting table nearby when the recipe needs one. Use crafting_plan to see what an item takes.",
  input: z.object({
    item: z.string().describe("The name of the item to craft."),
    count: z
      .int()
      .min(1)
      .max(64)
      .default(1)
      .describe(
        "How many to make at least. A recipe that makes several at once may give more, and the materials may allow fewer.",
      ),
  }),
  async run({ bot, signal }, { item, count }) {
    const { id } = itemNamed(bot, item);
    const table = nearestCraftingTable(bot);
    const [recipe] = bot.recipesFor(id, null, 1, table);
    if (recipe === undefined) {
      if (table === null && bot.recipesFor(id, null, 1, true).length > 0) {
        throw new Error(
          `Crafting ${item} needs a crafting table, and none is within ${craftingTableRange} blocks.`,
        );
      }
      const [known] = recipeBook(bot)(item);
      if (known === undefined) {
        throw new Error(`Nothing crafts into ${item}.`);
      }
      const needs = known.needs.map((need) => `${need.count} ${need.name}`).join(", ");
      throw new Error(`The bot lacks what ${item} takes. One recipe needs ${needs}.`);
    }

    if (table !== null && recipe.requiresTable) {
      await approach(bot, table.position, signal);
    }
    const needs = recipe.delta.flatMap((change) => {
      const name = bot.registry.items[change.id]?.name;
      return change.count < 0 && name !== undefined ? [{ name, count: -change.count }] : [];
    });
    const rounds = Math.min(
      roundsFor(count, recipe.result.count),
      affordableRounds(needs, countByName(bot.inventory.items())),
    );
    const before = countOf(bot, item);
    await bot.craft(recipe, rounds, table ?? undefined);
    return { crafted: countOf(bot, item) - before, wanted: count, carrying: countOf(bot, item) };
  },
});
