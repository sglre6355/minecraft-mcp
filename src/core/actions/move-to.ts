import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { defineAction } from "./action.ts";
import { walk } from "./walk.ts";

type Point = {
  x: number;
  y: number;
  z: number;
};

// Blocks between the block the bot is in and the block of a position, which is how the
// pathfinder judges arrival. A bot on a slab stands in the block under the one it has reached,
// so the block above the bot counts as well.
export function blocksLeft(bot: Point, position: Point): number {
  const dx = Math.floor(position.x) - Math.floor(bot.x);
  const dy = Math.floor(position.y) - Math.floor(bot.y);
  const dz = Math.floor(position.z) - Math.floor(bot.z);
  return Math.min(Math.hypot(dx, dy, dz), Math.hypot(dx, dy - 1, dz));
}

// The ways to move that a call did not allow.
export function waysLeftOff(input: {
  canDig: boolean;
  canPlace: boolean;
  allowParkour: boolean;
}): Array<string> {
  const names: Array<string> = [];
  if (!input.canDig) {
    names.push("canDig");
  }
  if (!input.canPlace) {
    names.push("canPlace");
  }
  if (!input.allowParkour) {
    names.push("allowParkour");
  }
  return names;
}

export const moveTo = defineAction({
  name: "move_to",
  description: "Walk to a position, finding a path around obstacles.",
  input: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    range: z.number().min(0).default(1).describe("Stop within this many blocks of the position."),
    canDig: z.boolean().default(false).describe("Break blocks that are in the way."),
    canPlace: z
      .boolean()
      .default(false)
      .describe("Place blocks from the inventory to bridge gaps and to climb."),
    maxDropDown: z.int().min(0).default(3).describe("The highest drop to take, in blocks."),
    allowParkour: z.boolean().default(true).describe("Jump across gaps of up to three blocks."),
  }),
  progress: z.object({
    distance: z.number().describe("Blocks left to the block of the position."),
  }),
  async run({ bot, signal, progress }, input) {
    const distance = () => blocksLeft(bot.entity.position, input);

    const reporting = setInterval(() => {
      progress({ distance: distance() });
    }, 1000);
    let reached: boolean;
    try {
      reached = await walk(
        bot,
        new goals.GoalNear(input.x, input.y, input.z, input.range),
        signal,
        input,
      );
    } finally {
      clearInterval(reporting);
    }

    const left = distance();
    if (!reached) {
      const off = waysLeftOff(input);
      const hint = off.length === 0 ? "" : ` This call did not allow ${off.join(", ")}.`;
      throw new Error(
        `No path leads to the position. The bot is ${left.toFixed(1)} blocks away.${hint}`,
      );
    }
    const { x, y, z: zCoordinate } = bot.entity.position;
    return { position: { x, y, z: zCoordinate }, distance: left };
  },
});
