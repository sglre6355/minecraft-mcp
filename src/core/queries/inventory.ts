import { z } from "zod";

import { list, listed, listedNote } from "../items.ts";
import { defineQuery } from "./query.ts";

// Where the player inventory keeps what the bot wears.
const slots = { head: 5, torso: 6, legs: 7, feet: 8, offHand: 45 };

export const inventory = defineQuery({
  name: "inventory",
  description: `List what the bot carries, holds and wears. ${listedNote}`,
  input: z.object({}),
  run({ bot }) {
    const wearing = (slot: number) => {
      const stack = bot.inventory.slots[slot];
      return stack === null || stack === undefined ? null : listed(stack);
    };
    return Promise.resolve({
      items: list(bot.inventory.items().map(listed)),
      emptySlots: bot.inventory.emptySlotCount(),
      held: bot.heldItem === null ? null : listed(bot.heldItem),
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
