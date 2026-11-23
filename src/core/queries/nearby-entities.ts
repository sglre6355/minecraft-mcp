import { z } from "zod";

import { listed, listedNote } from "../items.ts";
import { defineQuery } from "./query.ts";

// The most entities one answer lists.
const maxEntities = 50;

const round = (value: number) => Math.round(value * 10) / 10;

export const nearbyEntities = defineQuery({
  name: "nearby_entities",
  description: `List the players, mobs and dropped items around the bot, closest first. The entityId names one of them to other tools and stops being valid once it is gone. \`item\` is the stack that a dropped item is. ${listedNote}`,
  input: z.object({
    range: z.number().min(1).max(64).default(16).describe("How far to look, in blocks."),
  }),
  run({ bot }, { range }) {
    const found = Object.values(bot.entities)
      .flatMap((entity) => {
        const distance = entity.position.distanceTo(bot.entity.position);
        return entity === bot.entity || distance > range ? [] : [{ entity, distance }];
      })
      .toSorted((a, b) => a.distance - b.distance);

    return Promise.resolve({
      entities: found.slice(0, maxEntities).map(({ entity, distance }) => {
        const stack = entity.name === "item" ? entity.getDroppedItem() : null;
        return {
          entityId: entity.id,
          // "player", "hostile", "animal", "mob", "projectile", "object" or "other".
          type: entity.type,
          name: entity.name ?? null,
          username: entity.username ?? null,
          // The stack that a dropped item is.
          item: stack === null ? null : listed(stack),
          coordinates: {
            x: round(entity.position.x),
            y: round(entity.position.y),
            z: round(entity.position.z),
          },
          distance: round(distance),
        };
      }),
      truncated: found.length > maxEntities,
    });
  },
});
