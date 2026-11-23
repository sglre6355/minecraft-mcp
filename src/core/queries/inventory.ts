import { z } from "zod";

import { layout, listed, listedNote, slotsNote } from "../items.ts";
import { defineQuery } from "./query.ts";

// Where the player inventory keeps what the bot wears.
const slots = { head: 5, torso: 6, legs: 7, feet: 8, offHand: 45 };

// The inventory as the game shows it: three rows, and the hotbar as the row under them.
const rows = 4;
const columns = 9;

export const inventory = defineQuery({
  name: "inventory",
  description: `List what the bot carries, holds and wears. The inventory has four rows of nine slots, and the bottom row is the hotbar. ${slotsNote} ${listedNote}`,
  input: z.object({}),
  run({ bot }) {
    const wearing = (slot: number) => {
      const stack = bot.inventory.slots[slot];
      return stack === null || stack === undefined ? null : listed(stack);
    };
    const carried = bot.inventory.slots.slice(
      bot.inventory.inventoryStart,
      bot.inventory.inventoryStart + rows * columns,
    );
    return Promise.resolve({
      rows,
      columns,
      free: carried.filter((stack) => stack === null).length,
      slots: layout(carried, columns),
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
