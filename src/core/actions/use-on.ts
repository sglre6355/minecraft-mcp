import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { carried } from "../items.ts";
import { aborted } from "../wait.ts";
import { defineAction } from "./action.ts";
import { approach, blockAt, entityWithId } from "./reach.ts";
import { walk } from "./walk.ts";

export const useOn = defineAction({
  name: "use_on",
  description:
    "Use an item, as a right click does. Give a block position to use it on that block (open a door, fill a bucket, till soil), an entityId to use it on a mob or player (shear a sheep), or neither to use it in the air.",
  input: z
    .object({
      item: z
        .string()
        .optional()
        .describe("The name of the item to hold. Defaults to what the bot holds now."),
      x: z.int().optional(),
      y: z.int().optional(),
      z: z.int().optional(),
      entityId: z.int().optional().describe("An ID from nearby_entities."),
      holdSeconds: z
        .number()
        .min(0)
        .max(30)
        .default(0)
        .describe(
          "With no target, how long to keep using the item before letting go. A bow needs about one second to draw.",
        ),
    })
    .refine(
      ({ x, y, z: zCoordinate }) =>
        (x === undefined) === (y === undefined) &&
        (y === undefined) === (zCoordinate === undefined),
      "Give all of x, y and z, or none of them.",
    )
    .refine(
      ({ x, entityId }) => x === undefined || entityId === undefined,
      "Give a block position or an entityId, not both.",
    ),
  async run({ bot, signal }, { item, x, y, z: zCoordinate, entityId, holdSeconds }) {
    const stack = item === undefined ? undefined : carried(bot, item);
    const hold = async () => {
      if (stack !== undefined) {
        await bot.equip(stack, "hand");
      }
      return bot.heldItem?.name ?? null;
    };

    if (entityId !== undefined) {
      const entity = entityWithId(bot, entityId);
      if (!(await walk(bot, new goals.GoalFollow(entity, 2), signal))) {
        throw new Error(`No path leads to the ${entity.name ?? "entity"}.`);
      }
      const used = await hold();
      bot.useOn(entity);
      return { used, on: entity.name ?? null };
    }

    if (x !== undefined && y !== undefined && zCoordinate !== undefined) {
      const block = blockAt(bot, x, y, zCoordinate);
      await approach(bot, block.position, signal);
      const used = await hold();
      // From above, a line to the middle of a block can clip the edge of the block beside it.
      // A line to the middle of its top cannot.
      const fromAbove = bot.entity.position.y + bot.entity.height > block.position.y + 1;
      await bot.lookAt(block.position.offset(0.5, fromAbove ? 1 : 0.5, 0.5), true);
      // A bucket works on what the bot looks at, where other items work on the block itself.
      if (used?.endsWith("bucket") === true) {
        // The server has to learn where the bot looks before the bucket is used.
        await bot.waitForTicks(4);
        bot.activateItem();
      } else {
        await bot.activateBlock(block);
      }
      return { used, on: block.name };
    }

    const used = await hold();
    bot.activateItem();
    try {
      await Promise.race([Bun.sleep(holdSeconds * 1000), aborted(signal)]);
    } finally {
      bot.deactivateItem();
    }
    signal.throwIfAborted();
    return { used, on: null };
  },
});
