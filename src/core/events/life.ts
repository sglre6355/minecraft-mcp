import type { Bot } from "mineflayer";

import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { defineEventKind } from "./event.ts";

const place = z.object({
  coordinates: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  dimension: z.string(),
});

export const died = defineEventKind({
  kind: "body.death",
  description:
    "The bot died. Its items dropped at the given coordinates, unless the server keeps the inventory.",
  payload: place,
});

export const respawned = defineEventKind({
  kind: "body.respawn",
  description: "The bot came back to life at the given coordinates.",
  payload: place,
});

function whereabouts(bot: Bot): z.infer<typeof place> {
  const { x, y, z: zCoordinate } = bot.entity.position;
  return { coordinates: { x, y, z: zCoordinate }, dimension: bot.game.dimension };
}

export const life: EventSourceDefinition = {
  name: "life",
  kinds: [died, respawned],
  start({ bot, emit }) {
    // Mineflayer also emits `spawn` after a change of dimension, so a death has to come first.
    let dead = false;
    const onDeath = () => {
      dead = true;
      emit(died, whereabouts(bot));
    };
    const onSpawn = () => {
      if (dead) {
        dead = false;
        emit(respawned, whereabouts(bot));
      }
    };
    bot.on("death", onDeath);
    bot.on("spawn", onSpawn);
    return () => {
      bot.off("death", onDeath);
      bot.off("spawn", onSpawn);
    };
  },
};
