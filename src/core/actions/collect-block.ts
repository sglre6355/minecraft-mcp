import type { Bot } from "mineflayer";

import { plugin as collectBlockPlugin } from "mineflayer-collectblock";
import { z } from "zod";

import { blockNamed, countByName, gained } from "../items.ts";
import { stoppable, within } from "../wait.ts";
import { defineAction } from "./action.ts";
import { equipToolFor } from "./break-block.ts";
import { movementsFor } from "./walk.ts";

const falling = new Set(["sand", "red_sand", "gravel", "anvil"]);

// Whether breaking a block is free of the two usual accidents, given the names of the blocks
// that touch it. A liquid beside it flows in. Sand or gravel above it comes down.
export function safeToBreak(
  touching: ReadonlyArray<string | undefined>,
  above: string | undefined,
): boolean {
  const floods = touching.some((name) => name === "water" || name === "lava");
  const buries = above !== undefined && (falling.has(above) || above.endsWith("concrete_powder"));
  return !floods && !buries;
}

const sides = [
  [0, 1, 0],
  [0, -1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
] as const;

function namesAround(bot: Bot, position: Bot["entity"]["position"]) {
  return sides.map(([dx, dy, dz]) => bot.blockAt(position.offset(dx, dy, dz))?.name);
}

// The longest one block may take, with the walk to it and the pickup.
const perBlockMs = 60_000;

export const collectBlock = defineAction({
  name: "collect_block",
  description:
    "Gather blocks of one kind. For each, walks to the nearest one, breaks it with the best tool the bot carries and picks up what drops. On the way it breaks blocks that block its path.",
  input: z.object({
    block: z.string().describe("The name of the block, such as oak_log."),
    count: z.int().min(1).max(64).default(1).describe("How many blocks to gather."),
    range: z.int().min(1).max(64).default(32).describe("How far to search, in blocks."),
    canPlace: z
      .boolean()
      .default(false)
      .describe("Place blocks from the inventory to bridge gaps and to climb."),
    unsafe: z
      .boolean()
      .default(false)
      .describe("Also take blocks that touch water or lava, or that hold up sand or gravel."),
  }),
  progress: z.object({
    collected: z.int().describe("Blocks gathered so far."),
  }),
  async run({ bot, signal, progress }, input) {
    const kind = blockNamed(bot, input.block);
    // The plugin mines nothing unless its movements may dig.
    const movements = movementsFor(bot, { canDig: true, canPlace: input.canPlace });
    if (!bot.hasPlugin(collectBlockPlugin)) {
      bot.loadPlugin(collectBlockPlugin);
    }
    // The plugin loads the tool plugin it builds on a moment after it is loaded itself.
    while (!("tool" in bot)) {
      await Bun.sleep(1);
    }
    bot.collectBlock.movements = movements;

    const stop = () => {
      bot.stopDigging();
      void bot.collectBlock.cancelTask();
    };
    const tried = new Set<string>();
    const before = countByName(bot.inventory.items());
    let problem = `No ${input.block} is within ${input.range} blocks.`;
    let collected = 0;

    while (collected < input.count) {
      const standing = bot.findBlocks({ matching: kind.id, maxDistance: input.range, count: 64 });
      const position = standing.find((candidate) => !tried.has(candidate.toString()));
      const block = position === undefined ? null : bot.blockAt(position);
      if (block === null) {
        break;
      }
      tried.add(block.position.toString());
      const [above, ...others] = namesAround(bot, block.position);
      if (!input.unsafe && !safeToBreak([above, ...others], above)) {
        problem = `The ${input.block} in range touches a liquid or holds up sand or gravel. Pass unsafe to take it anyway.`;
      } else if (!(await equipToolFor(bot, block))) {
        throw new Error(`The bot carries no tool that can harvest ${input.block}.`);
      } else {
        const done = await stoppable(signal, stop, () =>
          within(
            bot.collectBlock.collect(block).then(
              () => true,
              (error: unknown) => {
                problem = error instanceof Error ? error.message : String(error);
                return false;
              },
            ),
            perBlockMs,
          ),
        );
        signal.throwIfAborted();
        if (done === undefined) {
          stop();
          problem = `Gathering ${input.block} took too long.`;
        }
        // The plugin gives up on a block without saying so, and the bot also breaks blocks of
        // the kind that stand in its way. What counts is which of them are gone.
        const gone = standing.filter((candidate) => {
          const now = bot.blockAt(candidate);
          return now !== null && now.type !== kind.id;
        }).length;
        if (gone === 0 && done === true) {
          problem = `The bot could not reach or break the ${input.block}.`;
        }
        collected += gone;
        if (gone > 0) {
          progress({ collected });
        }
      }
    }

    if (collected === 0) {
      throw new Error(problem);
    }
    return {
      collected,
      wanted: input.count,
      gained: gained(before, countByName(bot.inventory.items())),
    };
  },
});
