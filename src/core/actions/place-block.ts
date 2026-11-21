import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { carried } from "../items.ts";
import { defineAction } from "./action.ts";
import { blockAt } from "./reach.ts";
import { walk } from "./walk.ts";

// Where a neighbor that the new block can rest against may be. Below comes first.
const sides = [
  [0, -1, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
] as const;

export const placeBlock = defineAction({
  name: "place_block",
  description:
    "Place a block from the inventory at a position. The position must be free and must touch a solid block. Walks within reach first.",
  input: z.object({
    block: z.string().describe("The name of the item to place, such as cobblestone or torch."),
    x: z.int(),
    y: z.int(),
    z: z.int(),
  }),
  async run({ bot, signal }, { block, x, y, z: zCoordinate }) {
    const item = carried(bot, block);
    const target = blockAt(bot, x, y, zCoordinate);
    if (target.boundingBox !== "empty") {
      throw new Error(`There is ${target.name} at ${x}, ${y}, ${zCoordinate} already.`);
    }
    const against = sides
      .map(([dx, dy, dz]) => bot.blockAt(target.position.offset(dx, dy, dz)))
      .find((neighbor) => neighbor?.boundingBox === "block");
    if (against === undefined || against === null) {
      throw new Error(
        `Nothing solid touches ${x}, ${y}, ${zCoordinate}, so a block has nothing to rest against.`,
      );
    }

    // Within reach of the spot, and neither standing in it nor right beside it.
    const goal = new goals.GoalCompositeAll([
      new goals.GoalNear(x, y, zCoordinate, 4),
      new goals.GoalInvert(new goals.GoalNear(x, y, zCoordinate, 1)),
    ]);
    if (!(await walk(bot, goal, signal))) {
      throw new Error(`No path leads to within reach of ${x}, ${y}, ${zCoordinate}.`);
    }
    await bot.equip(item, "hand");
    await bot.placeBlock(against, target.position.minus(against.position));
    return { placed: bot.blockAt(target.position)?.name ?? null };
  },
});
