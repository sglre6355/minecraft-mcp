import type { Bot } from "mineflayer";

import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { defineEventKind } from "./event.ts";

export const damaged = defineEventKind({
  kind: "body.damage",
  description: "The bot lost health.",
  payload: z.object({
    amount: z.number().describe("Health lost. A full bar is 20."),
    health: z.number().describe("Health left."),
    cause: z
      .string()
      .nullable()
      .describe("The kind of entity that dealt the damage, when the server tells."),
  }),
  params: z.strictObject({
    minAmount: z.number().optional().describe("Only damage of at least this much."),
  }),
  filters: [{ param: "minAmount", field: "amount", op: "gte" }],
});

type Entity = Bot["entity"];

// The health lost between two readings, or nothing when health held or came back.
export function damageTaken(previous: number, current: number): number | undefined {
  return current < previous ? previous - current : undefined;
}

export const damage: EventSourceDefinition = {
  name: "damage",
  kinds: [damaged],
  start({ bot, emit }) {
    let health = bot.health;
    let cause: string | null = null;

    // Servers before 1.19.4 do not say who dealt the damage. The attacker is then absent.
    const onHurt = (entity: Entity, attacker: Entity | undefined) => {
      if (entity === bot.entity) {
        cause = attacker?.name ?? null;
      }
    };
    const onHealth = () => {
      const amount = damageTaken(health, bot.health);
      health = bot.health;
      if (amount !== undefined) {
        emit(damaged, { amount, health, cause });
      }
      cause = null;
    };
    bot.on("entityHurt", onHurt);
    bot.on("health", onHealth);
    return () => {
      bot.off("entityHurt", onHurt);
      bot.off("health", onHealth);
    };
  },
};
