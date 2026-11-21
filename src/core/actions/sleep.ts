import { z } from "zod";

import { stoppable } from "../wait.ts";
import { defineAction } from "./action.ts";
import { approach } from "./reach.ts";

// How far the bot looks for a bed, in blocks.
const bedRange = 32;

export const sleep = defineAction({
  name: "sleep",
  description:
    "Walk to the nearest bed and sleep until morning. Fails by day and while monsters are near. Cancel it to get up early.",
  input: z.object({}),
  async run({ bot, signal }) {
    const bed = bot.findBlock({ matching: (block) => bot.isABed(block), maxDistance: bedRange });
    if (bed === null) {
      throw new Error(`No bed is within ${bedRange} blocks.`);
    }
    await approach(bot, bed.position, signal);
    await bot.sleep(bed);

    const woke = Promise.withResolvers<void>();
    bot.once("wake", woke.resolve);
    try {
      await stoppable(
        signal,
        () => {
          // Rejects when the bot is up already.
          bot.wake().catch(() => {});
        },
        () => woke.promise,
      );
    } finally {
      bot.off("wake", woke.resolve);
    }
    return { slept: true };
  },
});
