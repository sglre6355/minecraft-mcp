import type { Bot } from "mineflayer";

import { z } from "zod";

import { stoppable } from "../wait.ts";
import { defineAction } from "./action.ts";
import { approach, blockAt } from "./reach.ts";

type Block = ReturnType<typeof blockAt>;

// Puts the best tool for the block in the bot's hand.
// Returns whether breaking the block will drop something.
export async function equipToolFor(bot: Bot, block: Block): Promise<boolean> {
  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool !== null) {
    await bot.equip(tool, "hand");
  }
  return block.harvestTools === undefined || (tool !== null && block.canHarvest(tool.type));
}

const liquids = new Set(["water", "lava", "bubble_column"]);

// Whether a player can break the block. A swing goes through a liquid, and the game lets
// nobody break blocks such as bedrock.
export function breakable(block: { name: string; diggable: boolean }): boolean {
  return block.diggable && !liquids.has(block.name);
}

export const breakBlock = defineAction({
  name: "break_block",
  description:
    "Break the block at a position, with the best tool the bot carries. Walks within reach first. Use collect_block to gather blocks of a kind.",
  input: z.object({ x: z.int(), y: z.int(), z: z.int() }),
  async run({ bot, signal }, { x, y, z: zCoordinate }) {
    const block = blockAt(bot, x, y, zCoordinate);
    if (!breakable(block)) {
      throw new Error(
        `There is ${block.name} at ${x}, ${y}, ${zCoordinate}, which cannot be broken.`,
      );
    }
    await approach(bot, block.position, signal);
    const drops = await equipToolFor(bot, block);
    await stoppable(
      signal,
      () => {
        bot.stopDigging();
      },
      () => bot.dig(block),
    );
    return { broke: block.name, drops };
  },
});
