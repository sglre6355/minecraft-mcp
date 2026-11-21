import { z } from "zod";

import { countByName } from "../items.ts";
import { defineQuery } from "./query.ts";

// Where the player inventory keeps what the bot wears.
const slots = { head: 5, torso: 6, legs: 7, feet: 8, offHand: 45 };

export const inventory = defineQuery({
  name: "inventory",
  description: "List what the bot carries, holds and wears.",
  input: z.object({}),
  run({ bot }) {
    const wearing = (slot: number) => bot.inventory.slots[slot]?.name ?? null;
    return Promise.resolve({
      items: countByName(bot.inventory.items()),
      emptySlots: bot.inventory.emptySlotCount(),
      held: bot.heldItem?.name ?? null,
      offHand: wearing(slots.offHand),
      armor: {
        head: wearing(slots.head),
        torso: wearing(slots.torso),
        legs: wearing(slots.legs),
        feet: wearing(slots.feet),
      },
    });
  },
});
