import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { carried } from "../items.ts";
import { defineAction } from "./action.ts";
import { falls } from "./collect-block.ts";
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

// A block that falls leaves its spot within this many ticks.
const leaveTicks = 4;

// The longest a fall is followed, in ticks.
const fallTicks = 100;

// The most blocks a world has from top to bottom.
const worldHeight = 384;

// What a falling block passes through.
const open = new Set(["air", "cave_air", "void_air", "water", "lava"]);

// How far down a block that fell came to rest, in blocks. `below` names the blocks under the
// spot it fell from, from the top. Missing when the block did not land, as when it broke on a
// torch or fell out of the world.
export function landing(name: string, below: ReadonlyArray<string>): number | undefined {
  const first = below.findIndex((under) => !open.has(under));
  return below[first] === name ? first + 1 : undefined;
}

export const placeBlock = defineAction({
  name: "place_block",
  description:
    "Place a block from the inventory at a position. The position must be free and must touch a solid block. Walks within reach first. Sand, gravel and the like fall when nothing holds them up. The action waits for the fall and reports where the block came to rest.",
  input: z.object({
    block: z.string().describe("The name of the item to place, such as cobblestone or torch."),
    coordinates: z.object({ x: z.int(), y: z.int(), z: z.int() }),
  }),
  async run({ bot, signal }, { block, coordinates: { x, y, z: zCoordinate } }) {
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
    const placed = blockAt(bot, x, y, zCoordinate).name;
    if (!falls(placed)) {
      return { placed, coordinates: { x, y, z: zCoordinate } };
    }

    await bot.waitForTicks(leaveTicks);
    if (bot.blockAt(target.position)?.name === placed) {
      return { placed, coordinates: { x, y, z: zCoordinate } };
    }
    const inFlight = () =>
      Object.values(bot.entities).some(
        (entity) =>
          entity.name === "falling_block" &&
          Math.floor(entity.position.x) === x &&
          Math.floor(entity.position.z) === zCoordinate,
      );
    for (let tick = 0; tick < fallTicks && inFlight(); tick += 1) {
      await bot.waitForTicks(1);
    }
    signal.throwIfAborted();

    const below: Array<string> = [];
    for (let down = 1; down <= worldHeight; down += 1) {
      const under = bot.blockAt(target.position.offset(0, -down, 0));
      if (under === null) {
        break;
      }
      below.push(under.name);
    }
    const fell = landing(placed, below);
    if (fell === undefined) {
      throw new Error(
        `The ${placed} fell from ${x}, ${y}, ${zCoordinate} and did not come to rest. It fell out of the world or broke on what it hit.`,
      );
    }
    return { placed, coordinates: { x, y: y - fell, z: zCoordinate } };
  },
});
