import { goals } from "mineflayer-pathfinder";

import type { Spot } from "../actions/move-to.ts";
import type { Route } from "../actions/walk.ts";

import { between, destination, spotAt } from "../actions/move-to.ts";
import { findRoute } from "../actions/walk.ts";
import { defineQuery } from "./query.ts";

export type PathReport = Route & {
  // Blocks from the end of the path to the position.
  left: number;
  target: Spot;
};

export const pathTo = defineQuery({
  name: "path_to",
  description:
    "Search for the path that move_to would take with the same input, without moving the bot. `answer` is `reaches`, or `unreachable` when the search went through every place the bot can get to, or `undecided` when the search ran out of time. `end` is the block the path ends in, and `left` is how many blocks lie between it and the position. `steps` counts the steps of the path, `jumps` the steps that jump over a gap, and `breaks` and `places` the blocks the path breaks and places. `target` names the block at the position and the one under it, with `unseen` for one the bot cannot see and `unloaded` for one in a part of the world that is not loaded. The path is a plan. The bot can still fail a step of it, such as a long jump.",
  input: destination,
  async run({ bot }, input): Promise<PathReport> {
    const to = input.coordinates;
    const goal = new goals.GoalNear(to.x, to.y, to.z, input.range);
    const route = await findRoute(bot, goal, input);
    return {
      ...route,
      left: Math.round(between(route.end, to) * 10) / 10,
      target: spotAt(bot, to),
    };
  },
});
