import { z } from "zod";

import { nearestCraftingTable } from "../crafting.ts";
import { defineQuery } from "./query.ts";

export const craftable = defineQuery({
  name: "craftable",
  description:
    "List the items the bot can craft right now from what it carries. Recipes that need a crafting table count only when one is nearby.",
  input: z.object({}),
  run({ bot }) {
    const table = nearestCraftingTable(bot);
    const items = bot.registry.itemsArray.flatMap((item) =>
      bot.recipesFor(item.id, null, 1, table).length > 0 ? [item.name] : [],
    );
    return Promise.resolve({ items, craftingTableNearby: table !== null });
  },
});
