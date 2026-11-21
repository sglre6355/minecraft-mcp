import type { Bot } from "mineflayer";

import { z } from "zod";

import type { Stack } from "../items.ts";

import { countOf, itemNamed } from "../items.ts";
import { aborted } from "../wait.ts";
import { defineAction } from "./action.ts";
import { approach, nearestBlock } from "./reach.ts";

const furnaces = ["furnace", "blast_furnace", "smoker"];

// How far the bot looks for a furnace, in blocks.
const furnaceRange = 16;

type Furnace = Awaited<ReturnType<Bot["openFurnace"]>>;

// Where a furnace window keeps its three stacks.
const slots = { input: 0, fuel: 1, output: 2 };

// Walks to the nearest furnace, opens it, does the work and closes it again.
async function withFurnace<Result>(
  bot: Bot,
  signal: AbortSignal,
  work: (furnace: Furnace) => Promise<Result>,
): Promise<Result> {
  const block = nearestBlock(bot, furnaces, furnaceRange);
  if (block === null) {
    throw new Error(`No furnace is within ${furnaceRange} blocks.`);
  }
  await approach(bot, block.position, signal);
  const furnace = await bot.openFurnace(block);
  try {
    signal.throwIfAborted();
    return await work(furnace);
  } finally {
    await furnace.close();
  }
}

// How many items one piece of each fuel smelts. Other fuels count as one, which is the least any gives.
const smeltsPerFuel = new Map([
  ["coal", 8],
  ["charcoal", 8],
  ["coal_block", 80],
  ["blaze_rod", 12],
  ["lava_bucket", 100],
]);

// The fuels tried when the call names none.
const usualFuels = ["coal", "charcoal"];

// The fuel pieces that smelt `count` items, or as many as the bot carries.
export function fuelNeeded(fuel: string, count: number, have: number): number {
  return Math.min(have, Math.ceil(count / (smeltsPerFuel.get(fuel) ?? 1)));
}

// One item takes ten seconds in a furnace. Nothing coming out for this long means it never will.
const stallMs = 20_000;
const checkMs = 500;

export const smelt = defineAction({
  name: "smelt",
  description:
    "Smelt or cook items in the nearest furnace, and take the result. Each item takes about ten seconds. If it stops early, what is left stays in the furnace for clear_furnace.",
  input: z.object({
    item: z.string().describe("The name of the item to put in, such as raw_iron."),
    count: z.int().min(1).max(64).default(1),
    fuel: z
      .string()
      .optional()
      .describe("The name of the fuel to add. Defaults to coal or charcoal."),
  }),
  progress: z.object({
    smelted: z.int().describe("Items that have come out so far."),
  }),
  run({ bot, signal, progress }, input) {
    const { id } = itemNamed(bot, input.item);
    if (countOf(bot, input.item) < input.count) {
      throw new Error(`The bot carries ${countOf(bot, input.item)} ${input.item}.`);
    }
    const fuel = input.fuel ?? usualFuels.find((name) => countOf(bot, name) > 0);

    return withFurnace(bot, signal, async (furnace) => {
      const inside = furnace.slots[slots.input];
      if (inside !== null && inside !== undefined && inside.name !== input.item) {
        throw new Error(`The furnace is busy with ${inside.name}. Empty it with clear_furnace.`);
      }
      const output = () => furnace.slots[slots.output]?.count ?? 0;
      const before = output();

      if ((furnace.slots[slots.fuel] ?? null) === null && furnace.fuel <= 0) {
        if (fuel === undefined) {
          throw new Error(
            "The furnace has no fuel and the bot carries no coal or charcoal. Name a fuel.",
          );
        }
        const pieces = fuelNeeded(fuel, input.count, countOf(bot, fuel));
        if (pieces === 0) {
          throw new Error(`The bot carries no ${fuel}.`);
        }
        await furnace.putFuel(itemNamed(bot, fuel).id, null, pieces);
      }
      await furnace.putInput(id, null, input.count);

      let smelted = 0;
      let lastChange = Date.now();
      const stopped = aborted(signal);
      while (smelted < input.count) {
        const tick = await Promise.race([stopped, Bun.sleep(checkMs)]);
        if (tick === "aborted") {
          signal.throwIfAborted();
        }
        const now = output() - before;
        if (now > smelted) {
          smelted = now;
          lastChange = Date.now();
          progress({ smelted });
        } else if (Date.now() - lastChange > stallMs) {
          throw new Error(
            `Only ${smelted} of ${input.count} came out. The fuel ran out, or ${input.item} cannot be smelted here.`,
          );
        }
      }
      const result = await furnace.takeOutput();
      return { smelted, made: result.name };
    });
  },
});

export const clearFurnace = defineAction({
  name: "clear_furnace",
  description: "Take everything out of the nearest furnace: the input, the fuel and the result.",
  input: z.object({}),
  run: ({ bot, signal }) =>
    withFurnace(bot, signal, async (furnace) => {
      const took: Array<Stack> = [];
      const takes = [
        { slot: slots.input, take: () => furnace.takeInput() },
        { slot: slots.fuel, take: () => furnace.takeFuel() },
        { slot: slots.output, take: () => furnace.takeOutput() },
      ];
      for (const { slot, take } of takes) {
        const stack = furnace.slots[slot] ?? null;
        if (stack !== null) {
          took.push({ name: stack.name, count: stack.count });
          await take();
        }
      }
      return { took };
    }),
});
