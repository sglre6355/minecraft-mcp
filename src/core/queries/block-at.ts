import { z } from "zod";

import type { Position } from "./look-around.ts";

import { blockAt as loadedBlockAt } from "../actions/reach.ts";
import { defineQuery } from "./query.ts";

// A block's properties by name, such as `open`, `facing` or `age`.
export type BlockState = { [name: string]: string | number | boolean };

export type BlockReport = {
  position: Position;
  name: string;
  state: BlockState;
};

// Mineflayer gives a counted property, such as a crop's age, as text.
export function blockState(
  properties: BlockState,
  declared: Array<{ name: string; type: string }>,
) {
  const counted = new Set(declared.flatMap(({ name, type }) => (type === "int" ? [name] : [])));
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      counted.has(name) ? Number(value) : value,
    ]),
  );
}

export const blockAt = defineQuery({
  name: "block_at",
  description:
    "Report the kind of block at a position and its state, such as whether a door or trapdoor is open, which way stairs face or how far a crop has grown.",
  input: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }),
  run({ bot }, input): Promise<BlockReport> {
    const block = loadedBlockAt(bot, Math.floor(input.x), Math.floor(input.y), Math.floor(input.z));
    const { x, y, z: zCoordinate } = block.position;
    return Promise.resolve({
      position: { x, y, z: zCoordinate },
      name: block.name,
      state: blockState(block.getProperties(), bot.registry.blocksByName[block.name]?.states ?? []),
    });
  },
});
