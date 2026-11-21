import type { PartiallyComputedPath } from "mineflayer-pathfinder";

import { goals, Movements, pathfinder } from "mineflayer-pathfinder";
import { z } from "zod";

import { defineAction } from "./action.ts";

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

    if (!bot.hasPlugin(pathfinder)) {
      bot.loadPlugin(pathfinder);
    }
    const movements = new Movements(bot);
    movements.canDig = input.canDig;
    if (!input.canPlace) {
      movements.scafoldingBlocks = [];
      movements.allow1by1towers = false;
    }
    movements.maxDropDown = input.maxDropDown;
    movements.allowParkour = input.allowParkour;
    bot.pathfinder.setMovements(movements);

    const stop = () => {
      bot.pathfinder.setGoal(null);
    };
    signal.addEventListener("abort", stop, { once: true });
    const reporting = setInterval(() => {
      progress({ distance: distance() });
    }, 1000);
    // `goto` also resolves when the search ends with nowhere to go.
    let stuck = false;
    const watch = (result: PartiallyComputedPath) => {
      stuck = result.path.length === 0 && result.status !== "success";
    };
    bot.on("path_update", watch);
    try {
      signal.throwIfAborted();
      await bot.pathfinder.goto(new goals.GoalNear(input.x, input.y, input.z, input.range));
    } finally {
      clearInterval(reporting);
      signal.removeEventListener("abort", stop);
      bot.off("path_update", watch);
      // A goal left in place would pull the bot back whenever something moves it.
      stop();
    }

    const left = distance();
    if (stuck) {
      throw new Error(`No path leads to the position. The bot is ${left.toFixed(1)} blocks away.`);
    }
    const { x, y, z: zCoordinate } = bot.entity.position;
    return { position: { x, y, z: zCoordinate }, distance: left };
  },
});
