import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { carried, countOf, itemNamed } from "../items.ts";
import { stoppable } from "../wait.ts";
import { defineAction } from "./action.ts";
import { playerInSight } from "./reach.ts";
import { walk } from "./walk.ts";

export const equip = defineAction({
  name: "equip",
  description: "Hold an item from the inventory, or put it on.",
  input: z.object({
    item: z.string().describe("The name of the item."),
    destination: z
      .enum(["hand", "off-hand", "head", "torso", "legs", "feet"])
      .default("hand")
      .describe("Where the item goes."),
  }),
  async run({ bot }, { item, destination }) {
    await bot.equip(carried(bot, item), destination);
    return { equipped: item, destination };
  },
});

export const consume = defineAction({
  name: "consume",
  description: "Eat or drink an item from the inventory.",
  input: z.object({ item: z.string().describe("The name of the food or drink.") }),
  async run({ bot, signal }, { item }) {
    await bot.equip(carried(bot, item), "hand");
    await stoppable(
      signal,
      () => {
        bot.deactivateItem();
      },
      () => bot.consume(),
    );
    return { consumed: item, food: bot.food, health: bot.health };
  },
});

// The count to move, which defaults to all the bot carries.
function amount(have: number, item: string, count: number | undefined): number {
  if (have === 0) {
    throw new Error(`The bot carries no ${item}.`);
  }
  if (count !== undefined && count > have) {
    throw new Error(`The bot carries only ${have} ${item}.`);
  }
  return count ?? have;
}

const count = z.int().min(1).optional().describe("How many. Defaults to all the bot carries.");

export const discard = defineAction({
  name: "discard",
  description: "Drop items from the inventory on the ground in front of the bot.",
  input: z.object({ item: z.string().describe("The name of the item."), count }),
  async run({ bot }, input) {
    const { id } = itemNamed(bot, input.item);
    const dropped = amount(countOf(bot, input.item), input.item, input.count);
    await bot.toss(id, null, dropped);
    return { discarded: dropped, item: input.item };
  },
});

export const give = defineAction({
  name: "give",
  description: "Walk to a player and toss them items from the inventory.",
  input: z.object({
    username: z.string().describe("The player who gets the items."),
    item: z.string().describe("The name of the item."),
    count,
  }),
  async run({ bot, signal }, input) {
    const { id } = itemNamed(bot, input.item);
    const given = amount(countOf(bot, input.item), input.item, input.count);
    const player = playerInSight(bot, input.username);
    if (!(await walk(bot, new goals.GoalFollow(player, 2), signal))) {
      throw new Error(`No path leads to ${input.username}.`);
    }
    await bot.lookAt(player.position.offset(0, player.height, 0));
    await bot.toss(id, null, given);
    return { gave: given, item: input.item, to: input.username };
  },
});
