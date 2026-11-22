import type { Bot } from "mineflayer";
import type { goals, PartiallyComputedPath } from "mineflayer-pathfinder";

import { pathfinder } from "mineflayer-pathfinder";

import { Movements } from "./movements.ts";

export interface WalkOptions {
  // Break blocks that are in the way.
  canDig?: boolean;
  // Place blocks from the inventory to bridge gaps and to climb.
  canPlace?: boolean;
  // The highest drop to take, in blocks.
  maxDropDown?: number;
  // Jump across gaps.
  allowParkour?: boolean;
}

// How the bot may move, as the pathfinder reads it. Loads the pathfinder on first use.
export function movementsFor(bot: Bot, options: WalkOptions = {}): Movements {
  if (!bot.hasPlugin(pathfinder)) {
    bot.loadPlugin(pathfinder);
  }
  const movements = new Movements(bot);
  movements.canDig = options.canDig ?? false;
  if (options.canPlace !== true) {
    movements.scafoldingBlocks = [];
    movements.allow1by1towers = false;
  }
  movements.maxDropDown = options.maxDropDown ?? 3;
  movements.allowParkour = options.allowParkour ?? true;
  return movements;
}

// Walks the bot to the goal, finding a path around obstacles.
// Returns false when no path leads there. Throws when the signal aborts.
export async function walk(
  bot: Bot,
  goal: goals.Goal,
  signal: AbortSignal,
  options: WalkOptions = {},
): Promise<boolean> {
  const movements = movementsFor(bot, options);
  bot.pathfinder.setMovements(movements);

  const stop = () => {
    bot.pathfinder.setGoal(null);
  };
  signal.addEventListener("abort", stop, { once: true });
  // `goto` also resolves when the search ends with nowhere to go.
  let stuck = false;
  const watch = (result: PartiallyComputedPath) => {
    stuck = result.path.length === 0 && result.status !== "success";
  };
  bot.on("path_update", watch);
  try {
    signal.throwIfAborted();
    await bot.pathfinder.goto(goal);
  } finally {
    signal.removeEventListener("abort", stop);
    bot.off("path_update", watch);
    // A goal left in place would pull the bot back whenever something moves it.
    stop();
  }
  return !stuck;
}
