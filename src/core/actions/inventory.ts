import type { Bot } from "mineflayer";

import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { carried, carriedAs, lacking, stackInput } from "../items.ts";
import { stoppable } from "../wait.ts";
import { defineAction } from "./action.ts";
import { playerInSight } from "./reach.ts";
import { walk } from "./walk.ts";

const stackNote =
  "`item` alone means a stack with no name and no details of its own. Give `label` and `details` as the inventory shows them to pick another one.";

export const equip = defineAction({
  name: "equip",
  description: `Hold an item from the inventory, or put it on. ${stackNote}`,
  input: z.object({
    item: z.string().describe("The name of the item."),
    ...stackInput,
    destination: z
      .enum(["hand", "off-hand", "head", "torso", "legs", "feet"])
      .default("hand")
      .describe("Where the item goes."),
  }),
  async run({ bot }, { item, label, details, destination }) {
    await bot.equip(carried(bot, item, label, details), destination);
    return { equipped: item, destination };
  },
});

export const consume = defineAction({
  name: "consume",
  description: `Eat or drink an item from the inventory. ${stackNote}`,
  input: z.object({ item: z.string().describe("The name of the food or drink."), ...stackInput }),
  async run({ bot, signal }, { item, label, details }) {
    await bot.equip(carried(bot, item, label, details), "hand");
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

type Carried = ReturnType<typeof carriedAs>;

// How many items to take out of the stacks, which defaults to all of them.
function amount(bot: Bot, stacks: Carried, input: z.infer<typeof thrown>): number {
  const have = stacks.reduce((sum, stack) => sum + stack.count, 0);
  if (have === 0) {
    throw new Error(lacking(bot, input.item, input.label, input.details));
  }
  if (input.count !== undefined && input.count > have) {
    throw new Error(`The bot carries only ${have} of that.`);
  }
  return input.count ?? have;
}

// How long the server gets to correct what the bot believes about its slots, in milliseconds.
const settleMs = 250;

// Throws a number of items out of some stacks, one stack after the other.
async function toss(bot: Bot, stacks: Carried, count: number) {
  let left = count;
  for (const stack of stacks) {
    if (left === 0) {
      return;
    }
    if (stack.count <= left) {
      left -= stack.count;
      await bot.tossStack(stack);
      continue;
    }
    // Part of a stack: pick it up, drop the items one by one, and put the rest back.
    await bot.clickWindow(stack.slot, 0, 0);
    for (let dropped = 0; dropped < left; dropped += 1) {
      await bot.clickWindow(-999, 1, 0);
    }
    await bot.clickWindow(stack.slot, 0, 0);
    left = 0;
  }
  await Bun.sleep(settleMs);
}

const thrown = z.object({
  item: z.string().describe("The name of the item."),
  ...stackInput,
  count: z.int().min(1).optional().describe("How many. Defaults to all the bot carries."),
});

export const discard = defineAction({
  name: "discard",
  description: `Drop items from the inventory on the ground in front of the bot. ${stackNote}`,
  input: thrown,
  async run({ bot }, input) {
    const stacks = carriedAs(bot, input.item, input.label, input.details);
    const dropped = amount(bot, stacks, input);
    await toss(bot, stacks, dropped);
    return { discarded: dropped, item: input.item };
  },
});

export const give = defineAction({
  name: "give",
  description: `Walk to a player and toss them items from the inventory. ${stackNote}`,
  input: thrown.extend({ username: z.string().describe("The player who gets the items.") }),
  async run({ bot, signal }, input) {
    const stacks = carriedAs(bot, input.item, input.label, input.details);
    const given = amount(bot, stacks, input);
    const player = playerInSight(bot, input.username);
    if (!(await walk(bot, new goals.GoalFollow(player, 2), signal))) {
      throw new Error(`No path leads to ${input.username}.`);
    }
    await bot.lookAt(player.position.offset(0, player.height, 0));
    await toss(bot, stacks, given);
    return { gave: given, item: input.item, to: input.username };
  },
});
