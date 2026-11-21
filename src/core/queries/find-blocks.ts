import { z } from "zod";

import { blockNamed } from "../items.ts";
import { defineQuery } from "./query.ts";

export const findBlocks = defineQuery({
  name: "find_blocks",
  description: "Find the nearest blocks of one kind and report where they are, closest first.",
  input: z.object({
    block: z.string().describe("The name of the block, such as oak_log."),
    // A wider search holds up the core for too long.
    range: z.int().min(1).max(64).default(32).describe("How far to search, in blocks."),
    count: z.int().min(1).max(50).default(10).describe("The most positions to report."),
  }),
  run({ bot }, { block, range, count }) {
    const positions = bot.findBlocks({
      matching: blockNamed(bot, block).id,
      maxDistance: range,
      count,
    });
    return Promise.resolve({
      positions: positions.map((position) => ({
        x: position.x,
        y: position.y,
        z: position.z,
        distance:
          Math.round(position.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) * 10) / 10,
      })),
    });
  },
});
