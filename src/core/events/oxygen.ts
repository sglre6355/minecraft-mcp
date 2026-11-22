import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { defineEventKind } from "./event.ts";

export const lowAir = defineEventKind({
  kind: "body.oxygen",
  description:
    "The bot's air reached a new low at or below the configured level. A level is reported once until the air has been full again. At 0 the bot starts to drown.",
  payload: z.object({
    oxygen: z.number().describe("Air left, from 0 to 20."),
  }),
  params: z.strictObject({
    atMost: z.number().optional().describe("Only when this much air or less is left."),
  }),
  filters: [{ param: "atMost", field: "oxygen", op: "lte" }],
});

export const fullAir = 20;

// Whether a new reading is worth reporting. `lowest` is the least air since it was last full.
// At the water surface the level flickers up and down, and a level seen before is not news.
export function airRanLow(lowest: number, current: number, atMost: number): boolean {
  return current < lowest && current <= atMost;
}

// The least air since it was last full, after a new reading.
export function lowestAir(lowest: number, current: number): number {
  return current === fullAir ? fullAir : Math.min(lowest, current);
}

// Turns Mineflayer's `oxygenLevel` into air left, from 0 to 20.
// The field is unset until the server reports a change in air. While the bot drowns it
// swings between 0 and -1, once for every hit.
export function airLevel(reading: number | undefined): number {
  return Math.max(0, reading ?? fullAir);
}

export const oxygen: EventSourceDefinition = {
  name: "oxygen",
  kinds: [lowAir],
  start({ bot, emit, config }) {
    let lowest = airLevel(bot.oxygenLevel);

    // The server repeats the same level many times a second.
    const onBreath = () => {
      const current = airLevel(bot.oxygenLevel);
      if (airRanLow(lowest, current, config.events.oxygenAtMost)) {
        emit(lowAir, { oxygen: current });
      }
      lowest = lowestAir(lowest, current);
    };
    // The bot comes back to life with full air, and the server sends no level for it.
    const onDeath = () => {
      lowest = fullAir;
    };
    bot.on("breath", onBreath);
    bot.on("death", onDeath);
    return () => {
      bot.off("breath", onBreath);
      bot.off("death", onDeath);
    };
  },
};
