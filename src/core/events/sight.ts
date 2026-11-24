import type { Bot } from "mineflayer";

import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { sightOf } from "../queries/look.ts";
import { reaches } from "../sight/cast.ts";
import { defineEventKind } from "./event.ts";

// The distances at which an entity is reported, from the farthest to the nearest.
export const bands = [24, 12, 6] as const;

type Band = (typeof bands)[number];

// An entity this far away is forgotten, so that it is reported again when it comes back. The
// gap after the farthest band keeps an entity that moves along that edge from being reported
// again and again.
const forgetBeyond = 28;

// How often the bot looks for entities, in milliseconds.
const lookEveryMs = 250;

// Mineflayer's types for dropped items, experience orbs, boats, paintings and the like.
const unreported = new Set(["other", "orb", "object", "global"]);

export const entityInSight = defineEventKind({
  kind: "sight.entity",
  description:
    "A player, mob or projectile came into the bot's view within 24 blocks. Each entity is reported when it comes into view. It is reported again each time it crosses a nearer limit of 12 or 6 blocks. View counts in every direction. The bot does not need to face the entity. The bot must have a clear line of sight from its eyes to the entity's feet, middle or head. Glass and water do not block the view. Two blocks of leaves do. An entity is forgotten when it moves farther than 28 blocks away or the bot loses track of it. It can be reported again when it returns. Dropped items, experience orbs, boats, paintings and similar objects are never reported.",
  payload: z.object({
    entityId: z
      .number()
      .describe(
        "Identifies the entity for tools such as attack. Stops being valid once the entity is gone.",
      ),
    type: z
      .string()
      .describe("Kind of entity, such as player, hostile, animal, water_creature or projectile."),
    name: z.string().nullable().describe("Entity name, such as zombie or arrow."),
    username: z.string().nullable().describe("Player name. Null for other entities."),
    coordinates: z
      .object({ x: z.number(), y: z.number(), z: z.number() })
      .describe("Where the entity stands."),
    distance: z.number().describe("Distance from the bot, in blocks."),
  }),
  params: z.strictObject({
    types: z.array(z.string()).optional().describe("Only entities of these types."),
    names: z.array(z.string()).optional().describe("Only entities with these names."),
    within: z.number().optional().describe("Only entities at most this many blocks from the bot."),
  }),
  filters: [
    { param: "types", field: "type", op: "in" },
    { param: "names", field: "name", op: "in" },
    { param: "within", field: "distance", op: "lte" },
  ],
});

// The nearest band that a distance lies within, or nothing beyond the farthest band.
export function bandOf(distance: number): Band | undefined {
  return bands.findLast((band) => distance <= band);
}

// The band to report for an entity at a distance, or nothing when it is no news. `reported` is
// the nearest band reported for the entity so far.
export function newBand(reported: Band | undefined, distance: number): Band | undefined {
  const band = bandOf(distance);
  return band !== undefined && (reported === undefined || band < reported) ? band : undefined;
}

export function forgets(distance: number): boolean {
  return distance > forgetBeyond;
}

type Entity = Bot["entity"];

const round = (value: number) => Math.round(value * 10) / 10;

// Whether the bot can see some part of an entity: its feet, its middle or its head.
function inSight(sight: ReturnType<typeof sightOf>, entity: Entity): boolean {
  const { x, y, z } = entity.position;
  return [0.15, 0.5, 0.9].some((share) =>
    reaches(sight.eye, { x, y: y + entity.height * share, z }, sight.cellAt),
  );
}

export const sight: EventSourceDefinition = {
  name: "sight",
  kinds: [entityInSight],
  start({ bot, emit }) {
    const reported = new Map<number, Band>();

    const look = () => {
      let sight: ReturnType<typeof sightOf> | undefined;
      for (const entity of Object.values(bot.entities)) {
        if (entity === bot.entity || unreported.has(entity.type)) {
          continue;
        }
        const distance = entity.position.distanceTo(bot.entity.position);
        if (forgets(distance)) {
          reported.delete(entity.id);
          continue;
        }
        const band = newBand(reported.get(entity.id), distance);
        if (band === undefined) {
          continue;
        }
        sight ??= sightOf(bot);
        if (!inSight(sight, entity)) {
          continue;
        }
        reported.set(entity.id, band);
        emit(entityInSight, {
          entityId: entity.id,
          type: entity.type,
          name: entity.name ?? null,
          username: entity.username ?? null,
          coordinates: {
            x: round(entity.position.x),
            y: round(entity.position.y),
            z: round(entity.position.z),
          },
          distance: round(distance),
        });
      }
    };
    const onGone = (entity: Entity) => {
      reported.delete(entity.id);
    };
    const timer = setInterval(look, lookEveryMs);
    bot.on("entityGone", onGone);
    return () => {
      clearInterval(timer);
      bot.off("entityGone", onGone);
    };
  },
};
