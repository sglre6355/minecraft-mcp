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

// What a search for a path came to.
export type Route = {
  // `unreachable` when the search went through every place the bot can get to. `undecided`
  // when it ran out of time before that.
  answer: "reaches" | "unreachable" | "undecided";
  // The block the path ends in, which is the block the bot stands in for a path without steps.
  end: Point;
  steps: number;
  // Steps that jump over a gap.
  jumps: number;
  // Blocks the path breaks and places.
  breaks: number;
  places: number;
};

const answers = { success: "reaches", noPath: "unreachable", timeout: "undecided" } as const;

type Step = Point & {
  parkour: boolean;
  toBreak: ReadonlyArray<unknown>;
  toPlace: ReadonlyArray<unknown>;
};

export function routeOf(
  status: keyof typeof answers,
  path: ReadonlyArray<Step>,
  start: Point,
): Route {
  const last = path.at(-1) ?? start;
  return {
    answer: answers[status],
    end: { x: last.x, y: last.y, z: last.z },
    steps: path.length,
    jumps: path.filter((step) => step.parkour).length,
    breaks: path.reduce((sum, step) => sum + step.toBreak.length, 0),
    places: path.reduce((sum, step) => sum + step.toPlace.length, 0),
  };
}

// The longest a search keeps the core's thread before other work gets a turn, in milliseconds.
const sliceMs = 8;

// Searches for the path a walk to the goal would take from where the bot stands. The bot
// does not move, and a walk that is under way goes on.
export async function findRoute(
  bot: Bot,
  goal: goals.Goal,
  options: WalkOptions = {},
): Promise<Route> {
  const movements = movementsFor(bot, options);
  const { x, y, z } = bot.entity.position.floored();
  let route = routeOf("timeout", [], { x, y, z });
  const search = bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, {
    optimizePath: false,
    tickTimeout: sliceMs,
  });
  // The search hands back what it has after every slice.
  for (const { result } of search) {
    route = routeOf(result.status, result.path, { x, y, z });
    await Bun.sleep(1);
  }
  return route;
}

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

// The name of the error a walk fails with when the search for a path runs out of time before
// it finds one or rules one out.
const undecided = "Undecided";

export function isUndecided(error: unknown): boolean {
  return error instanceof Error && error.name === undecided;
}

// Walks the bot to the goal, finding a path around obstacles.
// Returns false when no path leads there. Throws when the signal aborts, when the bot stays
// in one place for too long, and when the search for a path runs out of time.
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

  // The pathfinder's own `goto` takes a search that is still going on for one that found
  // no path, whenever the bot stands at the nearest place found so far.
  const ending = Promise.withResolvers<"arrived" | "unreachable" | "undecided" | "stopped">();
  // The steps still ahead. The pathfinder takes each one off as the bot makes it.
  let ahead: PartiallyComputedPath["path"] = [];
  const onPath = (result: PartiallyComputedPath) => {
    ahead = result.path;
    if (result.status === "noPath") {
      ending.resolve("unreachable");
    } else if (result.status === "timeout") {
      ending.resolve("undecided");
    } else if (result.status === "success" && result.path.length === 0) {
      // The bot stands where the goal wants it.
      ending.resolve("arrived");
    }
  };
  const onReached = () => {
    ending.resolve("arrived");
  };
  const onGoal = (next: goals.Goal | null) => {
    if (next !== goal) {
      ending.resolve("stopped");
    }
  };
  bot.on("path_update", onPath);
  bot.on("goal_reached", onReached);
  bot.on("goal_updated", onGoal);

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

  let ended: Awaited<typeof ending.promise>;
  try {
    signal.throwIfAborted();
    bot.pathfinder.setGoal(goal);
    ended = await ending.promise;
  } finally {
    clearInterval(watching);
    signal.removeEventListener("abort", stop);
    bot.off("path_update", onPath);
    bot.off("goal_reached", onReached);
    bot.off("goal_updated", onGoal);
    // A goal left in place would pull the bot back whenever something moves it.
    stop();
  }

  if (ended === "stopped") {
    signal.throwIfAborted();
    throw new Error(standstill ?? "The walk was stopped before it reached the goal.");
  }
  if (ended === "undecided") {
    const failure = new Error("The search for a path ran out of time without an answer.");
    failure.name = undecided;
    throw failure;
  }
  return ended === "arrived";
}
