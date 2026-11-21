import { z } from "zod";

import { defineQuery } from "./query.ts";

export type Position = {
  x: number;
  y: number;
  z: number;
};

export type Sample = Position & {
  name: string;
};

export type BlockKind = {
  name: string;
  count: number;
  // The block of this kind closest to the origin.
  nearest: Position;
  distance: number;
};

// Sums up blocks by kind, closest kind first.
export function digest(samples: Iterable<Sample>, origin: Position): Array<BlockKind> {
  const kinds = new Map<string, BlockKind>();
  for (const { name, x, y, z } of samples) {
    const distance = Math.hypot(x + 0.5 - origin.x, y + 0.5 - origin.y, z + 0.5 - origin.z);
    const kind = kinds.get(name);
    if (kind === undefined) {
      kinds.set(name, { name, count: 1, nearest: { x, y, z }, distance });
    } else {
      kind.count += 1;
      if (distance < kind.distance) {
        kind.nearest = { x, y, z };
        kind.distance = distance;
      }
    }
  }
  return [...kinds.values()].toSorted((a, b) => a.distance - b.distance);
}

const air = new Set(["air", "cave_air", "void_air"]);

// The most kinds of block one answer lists.
const maxKinds = 60;

export const lookAround = defineQuery({
  name: "look_around",
  description:
    "Describe the blocks around the bot. Each kind of block comes with how many there are and where the nearest one is. Use find_blocks for the positions of one kind.",
  input: z.object({
    radius: z.int().min(1).max(16).default(8).describe("How far to look, in blocks."),
  }),
  run({ bot }, { radius }) {
    const feet = bot.entity.position.floored();
    const nameAt = (dy: number) => bot.blockAt(feet.offset(0, dy, 0))?.name ?? null;

    const samples: Array<Sample> = [];
    for (let x = feet.x - radius; x <= feet.x + radius; x += 1) {
      for (let y = feet.y - radius; y <= feet.y + radius; y += 1) {
        for (let z = feet.z - radius; z <= feet.z + radius; z += 1) {
          const block = bot.blockAt(feet.offset(x - feet.x, y - feet.y, z - feet.z));
          if (block !== null && !air.has(block.name)) {
            samples.push({ name: block.name, x, y, z });
          }
        }
      }
    }
    const kinds = digest(samples, bot.entity.position);

    return Promise.resolve({
      position: { x: feet.x, y: feet.y, z: feet.z },
      below: nameAt(-1),
      atFeet: nameAt(0),
      atHead: nameAt(1),
      blocks: kinds.slice(0, maxKinds).map((kind) => ({
        ...kind,
        distance: Math.round(kind.distance * 10) / 10,
      })),
      truncated: kinds.length > maxKinds,
    });
  },
});
