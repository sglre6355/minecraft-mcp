import type { Bot } from "mineflayer";

import type { Stack } from "./items.ts";

import { blockNamed, itemNamed } from "./items.ts";

export interface Recipe {
  // How many items one round of the recipe gives.
  makes: number;
  needs: ReadonlyArray<Stack>;
  table: boolean;
}

// The recipes that make an item. An item nothing makes has none.
export type RecipeBook = (item: string) => ReadonlyArray<Recipe>;

export type CraftingStep = {
  item: string;
  // Rounds of the recipe.
  times: number;
  // Items those rounds give.
  makes: number;
  table: boolean;
};

export interface CraftingPlan {
  // In the order to craft them.
  steps: Array<CraftingStep>;
  // What must be found first, because it is not in stock and nothing in stock makes it.
  missing: Array<Stack>;
}

// Works out how to craft `count` more of an item from what is in stock.
export function planCrafting(
  book: RecipeBook,
  item: string,
  count: number,
  stock: ReadonlyArray<Stack>,
): CraftingPlan {
  const left = new Map(stock.map((stack) => [stack.name, stack.count]));
  const steps: Array<CraftingStep> = [];
  const missing = new Map<string, number>();

  // A recipe is of no use when it needs an item that is already being made further up,
  // or one that is itself made from this item, as an ingot is from its block.
  const usable = (name: string, making: ReadonlyArray<string>) =>
    book(name).filter((recipe) =>
      recipe.needs.every(
        (need) =>
          !making.includes(need.name) &&
          !book(need.name).some((reverse) => reverse.needs.some((back) => back.name === name)),
      ),
    );

  const make = (name: string, wanted: number, making: ReadonlyArray<string>) => {
    const recipes = usable(name, making);
    const recipe =
      recipes.find((candidate) =>
        candidate.needs.every((need) => (left.get(need.name) ?? 0) >= need.count),
      ) ?? recipes[0];
    if (recipe === undefined) {
      missing.set(name, (missing.get(name) ?? 0) + wanted);
      return;
    }
    const times = Math.ceil(wanted / recipe.makes);
    for (const need of recipe.needs) {
      const have = left.get(need.name) ?? 0;
      const total = need.count * times;
      left.set(need.name, Math.max(0, have - total));
      if (total > have) {
        make(need.name, total - have, [...making, name]);
      }
    }
    steps.push({ item: name, times, makes: times * recipe.makes, table: recipe.table });
    left.set(name, (left.get(name) ?? 0) + times * recipe.makes - wanted);
  };

  make(item, count, []);
  return { steps, missing: [...missing].map(([name, amount]) => ({ name, count: amount })) };
}

// The recipes of the bot's Minecraft version, in the shape the planner reads.
export function recipeBook(bot: Bot): RecipeBook {
  const known = new Map<string, ReadonlyArray<Recipe>>();
  return (item) => {
    const cached = known.get(item);
    if (cached !== undefined) {
      return cached;
    }
    const recipes = bot.recipesAll(itemNamed(bot, item).id, null, true).map((recipe) => ({
      makes: recipe.result.count,
      needs: recipe.delta.flatMap((change) => {
        const name = bot.registry.items[change.id]?.name;
        return change.count < 0 && name !== undefined ? [{ name, count: -change.count }] : [];
      }),
      table: recipe.requiresTable,
    }));
    known.set(item, recipes);
    return recipes;
  };
}

// The bot walks to a crafting table this close.
export const craftingTableRange = 16;

export function nearestCraftingTable(bot: Bot) {
  return bot.findBlock({
    matching: blockNamed(bot, "crafting_table").id,
    maxDistance: craftingTableRange,
  });
}
