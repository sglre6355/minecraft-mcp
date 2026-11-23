import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

import { aborted } from "../wait.ts";
import { defineAction } from "./action.ts";
import { playerInSight } from "./reach.ts";
import { movementsFor, walk } from "./walk.ts";

const username = z.string().describe("The player's name.");
const range = z.number().min(1).default(3).describe("How close to get, in blocks.");

export const goToPlayer = defineAction({
  name: "go_to_player",
  description: "Walk to a player the bot can see.",
  input: z.object({ username, range }),
  async run({ bot, signal }, input) {
    const player = playerInSight(bot, input.username);
    if (!(await walk(bot, new goals.GoalFollow(player, input.range), signal))) {
      throw new Error(`No path leads to ${input.username}.`);
    }
    return { distance: bot.entity.position.distanceTo(player.position) };
  },
});

export const followPlayer = defineAction({
  name: "follow_player",
  description:
    "Keep following a player the bot can see. This action never completes. Cancel it to stop.",
  input: z.object({ username, range }),
  progress: z.object({
    distance: z.number().describe("Blocks to the player."),
  }),
  async run({ bot, signal, progress }, input) {
    const player = playerInSight(bot, input.username);
    const movements = movementsFor(bot);
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.setGoal(new goals.GoalFollow(player, input.range), true);

    const lost = Promise.withResolvers<never>();
    const watching = setInterval(() => {
      if (player.isValid) {
        progress({ distance: bot.entity.position.distanceTo(player.position) });
      } else {
        lost.reject(new Error(`${input.username} went out of sight.`));
      }
    }, 1000);
    try {
      await Promise.race([lost.promise, aborted(signal)]);
    } finally {
      clearInterval(watching);
      bot.pathfinder.setGoal(null);
    }
    signal.throwIfAborted();
    return null;
  },
});
