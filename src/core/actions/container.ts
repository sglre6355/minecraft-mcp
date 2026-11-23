import type { Bot } from "mineflayer";

import { z } from "zod";

import {
  columnsOf,
  countByName,
  countOf,
  itemNamed,
  layout,
  listedNote,
  slotsNote,
} from "../items.ts";
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
  "A container is a chest, trapped chest, barrel, dispenser, dropper, hopper or shulker box. Without coordinates, the bot takes the nearest chest or barrel.";

// How far the bot looks for a chest, in blocks.
const chestRange = 16;

// A player opens a container from as far as four and a half blocks.
const openReach = 4.5;

// The longest the bot waits for a container to open, in milliseconds. One with a block on its
// lid does not open.
const openMs = 3000;

const coordinates = z.object({ x: z.int(), y: z.int(), z: z.int() }).optional();

type Container = Awaited<ReturnType<Bot["openContainer"]>>;

// Walks to a container, opens it, does the work and closes it again. The work gets the open
// container and the name of its block.
async function withContainer<Result>(
  bot: Bot,
  signal: AbortSignal,
  at: { x: number; y: number; z: number } | undefined,
  work: (container: Container, name: string) => Promise<Result>,
): Promise<Result & { coordinates: { x: number; y: number; z: number } }> {
  const block =
    at === undefined ? nearestBlock(bot, storage, chestRange) : blockAt(bot, at.x, at.y, at.z);
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
  const container = await within(bot.openContainer(block), openMs);
  if (container === undefined) {
    throw new Error(
      `The ${block.name} at ${x}, ${y}, ${zCoordinate} did not open. A block on its lid keeps a container shut.`,
    );
  }
  try {
    signal.throwIfAborted();
    const result = await work(container, block.name);
    return { coordinates: { x, y, z: zCoordinate }, ...result };
  } finally {
    await container.close();
  }
}

export const viewContainer = defineAction({
  name: "view_container",
  description: `Walk to a container, open it and show what lies in which slot. \`container\` names the block. A chest has three rows of nine slots, and two chests side by side form one container of six rows. ${kinds} ${slotsNote} ${listedNote}`,
  input: z.object({ coordinates }),
  run: ({ bot, signal }, input) =>
    withContainer(bot, signal, input.coordinates, (container, name) => {
      const held = container.slots.slice(0, container.inventoryStart);
      const columns = columnsOf(held.length);
      return Promise.resolve({
        container: name,
        rows: held.length / columns,
        columns,
        free: held.filter((stack) => stack === null).length,
        slots: layout(held, columns),
      });
    }),
});

const count = z.int().min(1).optional();

export const putInContainer = defineAction({
  name: "put_in_container",
  description: `Walk to a container and put items from the inventory into it. ${kinds}`,
  input: z.object({
    item: z.string().describe("The name of the item."),
    count: count.describe("How many. Defaults to all the bot carries."),
    coordinates,
  }),
  run({ bot, signal }, input) {
    const { id } = itemNamed(bot, input.item);
    const have = countOf(bot, input.item);
    if (have < (input.count ?? 1)) {
      throw new Error(`The bot carries ${have} ${input.item}.`);
    }
    const put = input.count ?? have;
    return withContainer(bot, signal, input.coordinates, async (container) => {
      await container.deposit(id, null, put);
      return { put, item: input.item };
    });
  },
});

export const takeFromContainer = defineAction({
  name: "take_from_container",
  description: `Walk to a container and take items out of it. ${kinds}`,
  input: z.object({
    item: z.string().describe("The name of the item."),
    count: count.describe("How many. Defaults to all the container holds."),
    coordinates,
  }),
  run({ bot, signal }, input) {
    const { id } = itemNamed(bot, input.item);
    return withContainer(bot, signal, input.coordinates, async (container, name) => {
      const inside =
        countByName(container.containerItems()).find((stack) => stack.name === input.item)?.count ??
        0;
      if (inside < (input.count ?? 1)) {
        throw new Error(`The ${name} holds ${inside} ${input.item}.`);
      }
      const took = input.count ?? inside;
      await container.withdraw(id, null, took);
      return { took, item: input.item };
    });
  },
});
