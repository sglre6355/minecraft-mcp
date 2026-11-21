import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { defineEventKind } from "./event.ts";

export const lowAir = defineEventKind({
  kind: "body.oxygen",
  description:
    "The bot's air fell further while at or below the configured level. At 0 the bot starts to drown.",
  payload: z.object({
    oxygen: z.number().describe("Air left, from 0 to 20."),
  }),
  params: z.strictObject({
    atMost: z.number().optional().describe("Only when this much air or less is left."),
  }),
  filters: [{ param: "atMost", field: "oxygen", op: "lte" }],
});

// Whether a new reading is worth reporting. Air that holds or comes back is not.
export function airRanLow(previous: number, current: number, atMost: number): boolean {
  return current < previous && current <= atMost;
}

const fullAir = 20;

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
    let level = airLevel(bot.oxygenLevel);

    // The server repeats the same level many times a second.
    const onBreath = () => {
      const current = airLevel(bot.oxygenLevel);
      if (airRanLow(level, current, config.events.oxygenAtMost)) {
        emit(lowAir, { oxygen: current });
      }
      level = current;
    };
    bot.on("breath", onBreath);
    return () => {
      bot.off("breath", onBreath);
    };
  },
};
