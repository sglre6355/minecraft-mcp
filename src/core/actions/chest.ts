import type { Bot } from "mineflayer";

import { z } from "zod";

import { countByName, countOf, itemNamed } from "../items.ts";
import { defineAction } from "./action.ts";
import { approach, blockAt, nearestBlock } from "./reach.ts";

const containers = ["chest", "trapped_chest", "barrel"];

// How far the bot looks for a chest, in blocks.
const chestRange = 16;

const position = {
  x: z.int().optional(),
  y: z.int().optional(),
  z: z.int().optional(),
};
const whole = (input: { x?: number; y?: number; z?: number }) =>
  (input.x === undefined) === (input.y === undefined) &&
  (input.y === undefined) === (input.z === undefined);
const wholeMessage = "Give all of x, y and z to name a chest, or none for the nearest one.";

type Chest = Awaited<ReturnType<Bot["openContainer"]>>;

// Walks to a chest, opens it, does the work and closes it again.
async function withChest<Result>(
  bot: Bot,
  signal: AbortSignal,
  at: { x?: number; y?: number; z?: number },
  work: (chest: Chest) => Promise<Result>,
): Promise<Result & { chest: { x: number; y: number; z: number } }> {
  const block =
    at.x !== undefined && at.y !== undefined && at.z !== undefined
      ? blockAt(bot, at.x, at.y, at.z)
      : nearestBlock(bot, containers, chestRange);
  if (block === null) {
    throw new Error(`No chest or barrel is within ${chestRange} blocks.`);
  }
  if (!containers.includes(block.name)) {
    throw new Error(`There is ${block.name} at that position, not a chest or barrel.`);
  }
  await approach(bot, block.position, signal);
  const chest = await bot.openContainer(block);
  try {
    signal.throwIfAborted();
    const result = await work(chest);
    const { x, y, z: zCoordinate } = block.position;
    return { ...result, chest: { x, y, z: zCoordinate } };
  } finally {
    await chest.close();
  }
}

export const viewChest = defineAction({
  name: "view_chest",
  description: "Walk to a chest or barrel, open it and list what is inside.",
  input: z.object(position).refine(whole, wholeMessage),
  run: ({ bot, signal }, input) =>
    withChest(bot, signal, input, (chest) =>
      Promise.resolve({ items: countByName(chest.containerItems()) }),
    ),
});

const count = z.int().min(1).optional();

export const putInChest = defineAction({
  name: "put_in_chest",
  description: "Walk to a chest or barrel and put items from the inventory into it.",
  input: z
    .object({
      item: z.string().describe("The name of the item."),
      count: count.describe("How many. Defaults to all the bot carries."),
      ...position,
    })
    .refine(whole, wholeMessage),
  run({ bot, signal }, input) {
    const { id } = itemNamed(bot, input.item);
    const have = countOf(bot, input.item);
    if (have < (input.count ?? 1)) {
      throw new Error(`The bot carries ${have} ${input.item}.`);
    }
    const put = input.count ?? have;
    return withChest(bot, signal, input, async (chest) => {
      await chest.deposit(id, null, put);
      return { put, item: input.item };
    });
  },
});

export const takeFromChest = defineAction({
  name: "take_from_chest",
  description: "Walk to a chest or barrel and take items out of it.",
  input: z
    .object({
      item: z.string().describe("The name of the item."),
      count: count.describe("How many. Defaults to all the chest holds."),
      ...position,
    })
    .refine(whole, wholeMessage),
  run({ bot, signal }, input) {
    const { id } = itemNamed(bot, input.item);
    return withChest(bot, signal, input, async (chest) => {
      const inside =
        countByName(chest.containerItems()).find((stack) => stack.name === input.item)?.count ?? 0;
      if (inside < (input.count ?? 1)) {
        throw new Error(`The chest holds ${inside} ${input.item}.`);
      }
      const took = input.count ?? inside;
      await chest.withdraw(id, null, took);
      return { took, item: input.item };
    });
  },
});
