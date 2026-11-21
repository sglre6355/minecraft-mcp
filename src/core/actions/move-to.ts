import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { defineAction } from "./action.ts";
import { walk } from "./walk.ts";

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
    allowParkour: z.boolean().default(false).describe("Jump across gaps."),
  }),
  progress: z.object({
    distance: z.number().describe("Blocks left to the position."),
  }),
  async run({ bot, signal, progress }, input) {
    const distance = () => {
      const { x, y, z: zCoordinate } = bot.entity.position;
      return Math.hypot(input.x - x, input.y - y, input.z - zCoordinate);
    };

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
      throw new Error(`No path leads to the position. The bot is ${left.toFixed(1)} blocks away.`);
    }
    const { x, y, z: zCoordinate } = bot.entity.position;
    return { position: { x, y, z: zCoordinate }, distance: left };
  },
});
