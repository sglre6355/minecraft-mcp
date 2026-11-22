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

type Point = {
  x: number;
  y: number;
  z: number;
};

// Where the bot was when it last got somewhere, and when.
export type Foothold = {
  at: Point;
  since: number;
};

// The longest the bot may stay at one foothold on a walk, in milliseconds.
const standstillMs = 10_000;

// The foothold after a look at the bot. It moves once the bot has come a block away from it,
// and while the bot is busy in one place, as it is when it breaks a block.
export function foothold(last: Foothold, position: Point, now: number, busy: boolean): Foothold {
  const { x, y, z } = last.at;
  const away = Math.hypot(position.x - x, position.y - y, position.z - z);
  return away >= 1 || busy ? { at: position, since: now } : last;
}

export function standsStill(last: Foothold, now: number): boolean {
  return now - last.since >= standstillMs;
}

// Walks the bot to the goal, finding a path around obstacles.
// Returns false when no path leads there. Throws when the signal aborts, and when the bot
// stays in one place for too long.
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
  // When the search ends short of the goal, `goto` rejects if a path leads part of the way
  // and resolves if none leads anywhere.
  let stuck = false;
  // The steps still ahead. The pathfinder takes each one off as the bot makes it.
  let ahead: PartiallyComputedPath["path"] = [];
  const watch = (result: PartiallyComputedPath) => {
    stuck = result.path.length === 0 && result.status !== "success";
    ahead = result.path;
  };
  bot.on("path_update", watch);

  // The pathfinder plans steps that the bot then does not make, and plans them again for ever.
  let standstill: string | undefined;
  let last: Foothold = { at: bot.entity.position.clone(), since: performance.now() };
  const watching = setInterval(() => {
    const now = performance.now();
    last = foothold(last, bot.entity.position.clone(), now, bot.targetDigBlock !== null);
    if (!standsStill(last, now)) {
      return;
    }
    const at = bot.entity.position.floored();
    const next = ahead[0];
    const step =
      next === undefined
        ? ""
        : ` The next step of its path leads to ${Math.floor(next.x)}, ${Math.floor(next.y)}, ${Math.floor(next.z)}.`;
    standstill = `The bot stopped at ${at.x}, ${at.y}, ${at.z} and stayed there for ${standstillMs / 1000} seconds.${step}`;
    stop();
  }, 500);

  try {
    signal.throwIfAborted();
    await bot.pathfinder.goto(goal);
  } catch (error) {
    if (standstill !== undefined && !signal.aborted) {
      throw new Error(standstill, { cause: error });
    }
    if (!(error instanceof Error && error.name === "NoPath")) {
      throw error;
    }
    stuck = true;
  } finally {
    clearInterval(watching);
    signal.removeEventListener("abort", stop);
    bot.off("path_update", watch);
    // A goal left in place would pull the bot back whenever something moves it.
    stop();
  }
  return !stuck;
}
