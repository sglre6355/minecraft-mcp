import type { Bot } from "mineflayer";

import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import type { Route } from "./walk.ts";

import { defineAction } from "./action.ts";
import { vectorAt } from "./reach.ts";
import { findRoute, isUndecided, walk } from "./walk.ts";

type Point = {
  x: number;
  y: number;
  z: number;
};

// Blocks from the block of one position to the block of another.
export function between(a: Point, b: Point): number {
  const dx = Math.floor(b.x) - Math.floor(a.x);
  const dy = Math.floor(b.y) - Math.floor(a.y);
  const dz = Math.floor(b.z) - Math.floor(a.z);
  return Math.hypot(dx, dy, dz);
}

// Blocks between the block the bot is in and the block of a position, which is how the
// pathfinder judges arrival. A bot on a slab stands in the block under the one it has reached,
// so the block above the bot counts as well.
export function blocksLeft(bot: Point, position: Point): number {
  return Math.min(between(bot, position), between({ ...bot, y: bot.y + 1 }, position));
}

// The ways to move that a call did not allow.
export function waysLeftOff(input: {
  canDig: boolean;
  canPlace: boolean;
  allowParkour: boolean;
}): Array<string> {
  const names: Array<string> = [];
  if (!input.canDig) {
    names.push("canDig");
  }
  if (!input.canPlace) {
    names.push("canPlace");
  }
  if (!input.allowParkour) {
    names.push("allowParkour");
  }
  return names;
}

// The names of the block at a position and of the one under it. `unloaded` stands for a
// block in a part of the world that is not loaded.
export type Spot = {
  block: string;
  under: string;
};

export function spotAt(bot: Bot, position: Point): Spot {
  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  const z = Math.floor(position.z);
  return {
    block: bot.blockAt(vectorAt(bot, x, y, z))?.name ?? "unloaded",
    under: bot.blockAt(vectorAt(bot, x, y - 1, z))?.name ?? "unloaded",
  };
}

function away(left: number): string {
  return `The bot is ${left.toFixed(1)} blocks away.`;
}

function holds(spot: Spot): string {
  return spot.block === "unloaded"
    ? "The position is in a part of the world that is not loaded."
    : `The position holds ${spot.block}, and under it is ${spot.under}.`;
}

function hint(off: Array<string>): string {
  return off.length === 0 ? "" : ` This call did not allow ${off.join(", ")}.`;
}

// What to tell the agent when the search ran out of time.
export function noAnswer(left: number, spot: Spot, off: Array<string>): string {
  return `The search for a path ran out of time without an answer. ${away(left)} ${holds(spot)}${hint(off)}`;
}

// What to tell the agent after a walk that found no path, given what a search right after it
// came to.
export function failure(
  route: Pick<Route, "answer" | "end" | "steps">,
  left: number,
  position: Point,
  spot: Spot,
  off: Array<string>,
): string {
  if (route.answer === "undecided") {
    return noAnswer(left, spot, off);
  }
  if (route.answer === "reaches") {
    return `The walk found no path, and a search right after it found one. ${away(left)} Something in the way may have changed. Call move_to again.`;
  }
  const { x, y, z } = route.end;
  const short = between(route.end, position).toFixed(1);
  const found =
    route.steps === 0
      ? "The path that the search found ends where the bot stands."
      : `The path that the search found ends at ${x}, ${y}, ${z}, which is ${short} blocks from the position.`;
  return `No path leads to the position. ${away(left)} ${found} ${holds(spot)}${hint(off)}`;
}

export const destination = z.object({
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
  allowParkour: z.boolean().default(true).describe("Jump across gaps of up to three blocks."),
});

export const moveTo = defineAction({
  name: "move_to",
  description:
    "Walk to a position, finding a path around obstacles. The position names the block the bot's feet end up in, which is the block above the floor it stands on.",
  input: destination,
  progress: z.object({
    distance: z.number().describe("Blocks left to the block of the position."),
  }),
  async run({ bot, signal, progress }, input) {
    const distance = () => blocksLeft(bot.entity.position, input);
    const goal = new goals.GoalNear(input.x, input.y, input.z, input.range);

    const reporting = setInterval(() => {
      progress({ distance: distance() });
    }, 1000);
    let outcome: "reached" | "no path" | "no answer";
    try {
      outcome = (await walk(bot, goal, signal, input)) ? "reached" : "no path";
    } catch (error) {
      if (!isUndecided(error)) {
        throw error;
      }
      outcome = "no answer";
    } finally {
      clearInterval(reporting);
    }

    const left = distance();
    if (outcome === "no answer") {
      throw new Error(noAnswer(left, spotAt(bot, input), waysLeftOff(input)));
    }
    if (outcome === "no path") {
      const route = await findRoute(bot, goal, input);
      signal.throwIfAborted();
      throw new Error(failure(route, left, input, spotAt(bot, input), waysLeftOff(input)));
    }
    const { x, y, z: zCoordinate } = bot.entity.position;
    return { position: { x, y, z: zCoordinate }, distance: left };
  },
});
