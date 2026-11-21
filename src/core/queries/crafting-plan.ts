import { z } from "zod";

import { planCrafting, recipeBook } from "../crafting.ts";
import { countByName, itemNamed } from "../items.ts";
import { defineQuery } from "./query.ts";

export const craftingPlan = defineQuery({
  name: "crafting_plan",
  description:
    "Work out how to craft an item from what the bot carries. Reports the crafting steps in order and the materials that must be found first. Smelting is not part of the plan.",
  input: z.object({
    item: z.string().describe("The name of the item to craft."),
    count: z.int().min(1).max(2304).default(1).describe("How many more to craft."),
  }),
  run({ bot }, { item, count }) {
    itemNamed(bot, item);
    const plan = planCrafting(recipeBook(bot), item, count, countByName(bot.inventory.items()));
    return Promise.resolve({ steps: plan.steps, missing: plan.missing });
  },
});
