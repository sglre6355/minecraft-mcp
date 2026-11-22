import type { Bot } from "mineflayer";

import { z } from "zod";

import { countByName, countOf, itemNamed } from "../items.ts";
import { within } from "../wait.ts";
import { defineAction } from "./action.ts";
import { approach, blockAt, nearestBlock } from "./reach.ts";

// What the bot picks when a call names no position.
const storage = ["chest", "trapped_chest", "barrel"];

// Whether a block holds items that the bot can look through, add to and take from.
export function isContainer(name: string): boolean {
  return (
    storage.includes(name) ||
    name === "dispenser" ||
    name === "dropper" ||
    name === "hopper" ||
    name.endsWith("shulker_box")
  );
}

const kinds =
  "A container is a chest, trapped chest, barrel, dispenser, dropper, hopper or shulker box. Without a position, the bot takes the nearest chest or barrel.";

// How far the bot looks for a chest, in blocks.
const chestRange = 16;

// A player opens a container from as far as four and a half blocks.
const openReach = 4.5;

// The longest the bot waits for a container to open, in milliseconds. One with a block on its
// lid does not open.
const openMs = 3000;

const position = {
  x: z.int().optional(),
  y: z.int().optional(),
  z: z.int().optional(),
};
const whole = (input: { x?: number; y?: number; z?: number }) =>
  (input.x === undefined) === (input.y === undefined) &&
  (input.y === undefined) === (input.z === undefined);
const wholeMessage =
  "Give all of x, y and z to name a container, or none for the nearest chest or barrel.";

type Chest = Awaited<ReturnType<Bot["openContainer"]>>;

// Walks to a container, opens it, does the work and closes it again. The work gets the open
// container and the name of its block.
async function withChest<Result>(
  bot: Bot,
  signal: AbortSignal,
  at: { x?: number; y?: number; z?: number },
  work: (chest: Chest, name: string) => Promise<Result>,
): Promise<Result & { chest: { x: number; y: number; z: number } }> {
  const block =
    at.x !== undefined && at.y !== undefined && at.z !== undefined
      ? blockAt(bot, at.x, at.y, at.z)
      : nearestBlock(bot, storage, chestRange);
  if (block === null) {
    throw new Error(`No chest or barrel is within ${chestRange} blocks.`);
  }
  const { x, y, z: zCoordinate } = block.position;
  if (!isContainer(block.name)) {
    throw new Error(
      `The block at ${x}, ${y}, ${zCoordinate} is no container that this tool opens.`,
    );
  }
  await approach(bot, block.position, signal, openReach);
  const chest = await within(bot.openContainer(block), openMs);
  if (chest === undefined) {
    throw new Error(
      `The ${block.name} at ${x}, ${y}, ${zCoordinate} did not open. A block on its lid keeps a container shut.`,
    );
  }
  try {
    signal.throwIfAborted();
    const result = await work(chest, block.name);
    return { ...result, chest: { x, y, z: zCoordinate } };
  } finally {
    await chest.close();
  }
}

export const viewChest = defineAction({
  name: "view_chest",
  description: `Walk to a container, open it and list what is inside. ${kinds}`,
  input: z.object(position).refine(whole, wholeMessage),
  run: ({ bot, signal }, input) =>
    withChest(bot, signal, input, (chest) =>
      Promise.resolve({ items: countByName(chest.containerItems()) }),
    ),
});

const count = z.int().min(1).optional();

export const putInChest = defineAction({
  name: "put_in_chest",
  description: `Walk to a container and put items from the inventory into it. ${kinds}`,
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
  description: `Walk to a container and take items out of it. ${kinds}`,
  input: z
    .object({
      item: z.string().describe("The name of the item."),
      count: count.describe("How many. Defaults to all the container holds."),
      ...position,
    })
    .refine(whole, wholeMessage),
  run({ bot, signal }, input) {
    const { id } = itemNamed(bot, input.item);
    return withChest(bot, signal, input, async (chest, name) => {
      const inside =
        countByName(chest.containerItems()).find((stack) => stack.name === input.item)?.count ?? 0;
      if (inside < (input.count ?? 1)) {
        throw new Error(`The ${name} holds ${inside} ${input.item}.`);
      }
      const took = input.count ?? inside;
      await chest.withdraw(id, null, took);
      return { took, item: input.item };
    });
  },
});
