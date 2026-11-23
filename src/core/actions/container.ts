import type { Bot } from "mineflayer";

import { z } from "zod";

import { columnsOf, itemNamed, layout, listedNote, slotsNote } from "../items.ts";
import { held, plan, shortfall } from "../moves.ts";
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

const place = z.object({ row: z.int().min(0), column: z.int().min(0) });

const items = z
  .array(
    z.object({
      name: z.string().describe("The item, as `name` in a list of slots."),
      label: z
        .string()
        .optional()
        .describe("The `label` of the stack. Leave it out for a stack that was given no name."),
      details: z
        .object({
          lore: z.array(z.string()).optional(),
          enchantments: z.array(z.object({ name: z.string(), level: z.number() })).optional(),
          data: z.record(z.string(), z.json()).optional(),
        })
        .optional()
        .describe("The `details` of the stack. Leave them out for a stack that has none."),
      count: z.int().min(1).optional().describe("How many. Defaults to all that match."),
      sources: z
        .array(place)
        .min(1)
        .optional()
        .describe("The slots to take from, in this order. Defaults to any slot with the stack."),
      destinations: z
        .array(place)
        .min(1)
        .optional()
        .describe("The slots to fill, in this order. Defaults to where a shift-click puts it."),
    }),
  )
  .min(1);

const movesNote =
  "Each entry of `items` names a stack the way a list of slots shows it. Without `destinations` a stack goes where a shift-click puts it: onto stacks of the same kind first, then into empty slots. The action fails when not everything moved, and its message says how much did.";

// How long the server gets to correct what the bot believes about the slots, in milliseconds.
const settleMs = 250;

// The inventory as an open container shows it under its own slots.
const carriedSlots = 36;
const carriedColumns = 9;

// Carries out the items of a call between the container and the inventory, slot by slot.
// Returns what moved and how many slots of the destination are free afterwards.
async function move(
  bot: Bot,
  container: Container,
  wanted: z.infer<typeof items>,
  direction: "in" | "out",
  block: string,
) {
  const own = container.inventoryStart;
  const sides = {
    container: { first: 0, slots: container.slots.slice(0, own), name: block },
    inventory: {
      first: own,
      slots: container.slots.slice(own, own + carriedSlots),
      name: "inventory",
    },
  };
  const [source, destination] =
    direction === "in" ? [sides.inventory, sides.container] : [sides.container, sides.inventory];
  const columns = (side: typeof source) =>
    side === sides.container ? columnsOf(own) : carriedColumns;

  const within = (side: typeof source, places: Array<z.infer<typeof place>>) => {
    const rows = side.slots.length / columns(side);
    const outside = places.find(({ row, column }) => row >= rows || column >= columns(side));
    if (outside !== undefined) {
      throw new Error(
        `The ${side.name} has no slot at row ${outside.row}, column ${outside.column}. It has ${rows} rows of ${columns(side)}, counted from 0.`,
      );
    }
  };
  within(
    source,
    wanted.flatMap((entry) => entry.sources ?? []),
  );
  within(
    destination,
    wanted.flatMap((entry) => entry.destinations ?? []),
  );

  const { moves, outcomes } = plan(
    wanted,
    source.slots.map(held),
    destination.slots.map(held),
    columns(source),
    columns(destination),
    (name) => itemNamed(bot, name).displayName,
    // A shift-click fills a container from its first slot and the inventory from its last.
    direction === "in" ? "forward" : "backward",
  );

  for (const { from, to, count } of moves) {
    const taken = source.first + from;
    const filled = destination.first + to;
    const whole = container.slots[taken]?.count === count;
    await bot.clickWindow(taken, 0, 0);
    if (whole) {
      await bot.clickWindow(filled, 0, 0);
    } else {
      // A right click puts one item down. What is left on the cursor goes back.
      for (let placed = 0; placed < count; placed += 1) {
        await bot.clickWindow(filled, 1, 0);
      }
      await bot.clickWindow(taken, 0, 0);
    }
  }
  await Bun.sleep(settleMs);

  if (outcomes.some(({ why }) => why !== "none")) {
    throw new Error(shortfall(outcomes, source.name, destination.name));
  }
  const after = container.slots.slice(
    destination.first,
    destination.first + destination.slots.length,
  );
  return {
    moved: outcomes.map(({ name, label, moved, details }) => ({
      name,
      label,
      count: moved,
      details,
    })),
    free: after.filter((stack) => stack === null).length,
  };
}

export const putInContainer = defineAction({
  name: "put_in_container",
  description: `Walk to a container and move stacks from the inventory into it. \`sources\` are slots of the inventory, and \`destinations\` are slots of the container. \`free\` counts the slots of the container that are empty afterwards. ${movesNote} ${kinds}`,
  input: z.object({ coordinates, items }),
  run: ({ bot, signal }, input) =>
    withContainer(bot, signal, input.coordinates, (container, name) =>
      move(bot, container, input.items, "in", name),
    ),
});

export const takeFromContainer = defineAction({
  name: "take_from_container",
  description: `Walk to a container and move stacks from it into the inventory. \`sources\` are slots of the container, and \`destinations\` are slots of the inventory. \`free\` counts the slots of the inventory that are empty afterwards. ${movesNote} ${kinds}`,
  input: z.object({ coordinates, items }),
  run: ({ bot, signal }, input) =>
    withContainer(bot, signal, input.coordinates, (container, name) =>
      move(bot, container, input.items, "out", name),
    ),
});
