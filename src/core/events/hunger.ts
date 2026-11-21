import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { defineEventKind } from "./event.ts";

export const hungry = defineEventKind({
  kind: "body.hunger",
  description:
    "The bot's food fell further while at or below the configured level. At 6 the bot cannot sprint, and at 0 it starves.",
  payload: z.object({
    food: z.number().describe("Food left, from 0 to 20."),
  }),
  params: z.strictObject({
    atMost: z.number().optional().describe("Only when this much food or less is left."),
  }),
  filters: [{ param: "atMost", field: "food", op: "lte" }],
});

// Whether a new reading is worth reporting. Food that holds or comes back is not.
export function foodRanLow(previous: number, current: number, atMost: number): boolean {
  return current < previous && current <= atMost;
}

export const hunger: EventSourceDefinition = {
  name: "hunger",
  kinds: [hungry],
  start({ bot, emit, config }) {
    let food = bot.food;
    const onHealth = () => {
      if (foodRanLow(food, bot.food, config.events.foodAtMost)) {
        emit(hungry, { food: bot.food });
      }
      food = bot.food;
    };
    bot.on("health", onHealth);
    return () => {
      bot.off("health", onHealth);
    };
  },
};
