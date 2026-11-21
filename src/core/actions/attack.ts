import { plugin as pvpPlugin } from "mineflayer-pvp";
import { z } from "zod";

import { stoppable } from "../wait.ts";
import { defineAction } from "./action.ts";
import { entityWithId } from "./reach.ts";
import { movementsFor } from "./walk.ts";

const checkMs = 250;

export const attack = defineAction({
  name: "attack",
  description:
    "Fight a mob or a player with the item the bot holds, following it until it is gone. Equip a weapon first. Stop it with cancel_action.",
  input: z.object({ entityId: z.int().describe("An ID from nearby_entities.") }),
  async run({ bot, signal }, { entityId }) {
    const target = entityWithId(bot, entityId);
    const movements = movementsFor(bot);
    if (!bot.hasPlugin(pvpPlugin)) {
      bot.loadPlugin(pvpPlugin);
    }
    bot.pvp.movements = movements;
    // The pathfinder walks again only once the target has moved further than this.
    // At the plugin's default of 2, a target knocked back a little stays out of reach for good.
    bot.pvp.followRange = 1;

    // A player comes back to life as the same entity, so the fight ends at the first death.
    let defeated = false;
    const onDead = (entity: typeof target) => {
      if (entity === target) {
        defeated = true;
        bot.pvp.forceStop();
      }
    };
    bot.on("entityDead", onDead);
    try {
      await stoppable(
        signal,
        () => {
          bot.pvp.forceStop();
        },
        async () => {
          await bot.pvp.attack(target);
          // The plugin lets go of its target once the target is dead or out of sight.
          while (bot.pvp.target === target && !signal.aborted) {
            await Bun.sleep(checkMs);
          }
        },
      );
    } finally {
      bot.off("entityDead", onDead);
    }
    signal.throwIfAborted();
    if (!defeated) {
      throw new Error(`The ${target.name ?? "target"} got away.`);
    }
    return { defeated, name: target.name ?? null };
  },
});
