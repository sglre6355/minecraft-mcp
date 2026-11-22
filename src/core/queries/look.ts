import { z } from "zod";

import type { Cell, CellAt, Ray, Shape } from "../sight/cast.ts";

import { cast } from "../sight/cast.ts";
import { directions, zoom } from "../sight/rays.ts";
import { describe, gather } from "../sight/view.ts";
import { defineQuery } from "./query.ts";

// Air, and the blocks that are as invisible as air.
const unseen = new Set(["air", "cave_air", "void_air", "light", "barrier", "structure_void"]);

const fullCell: Array<Shape> = [[0, 0, 0, 1, 1, 1]];

// The surface of water and lava lies a little under the top of its cell.
const liquidSurface: Array<Shape> = [[0, 0, 0, 1, 0.875, 1]];

// Solid blocks that one can see through.
function isClear(name: string): boolean {
  return name.includes("glass") || name === "ice" || name === "frosted_ice";
}

// These blocks hold water without being waterlogged.
const waterPlants = new Set(["seagrass", "tall_seagrass", "kelp", "kelp_plant", "bubble_column"]);

type Block = {
  name: string;
  shapes: Array<Shape>;
  isWaterlogged?: boolean;
};

// How sight meets a block. `above` names the block on top of it, which matters for a liquid.
export function cellOf(block: Block, above?: string): Cell | "air" {
  if (unseen.has(block.name)) {
    return "air";
  }
  const cell = shapeAndSight(block, above);
  if (block.isWaterlogged === true || waterPlants.has(block.name)) {
    return { ...cell, within: "water" };
  }
  return cell;
}

function shapeAndSight({ name, shapes }: Block, above?: string): Cell {
  if (name === "water" || name === "lava") {
    return {
      name,
      shapes: above === name ? fullCell : liquidSurface,
      sight: name === "water" ? "passes" : "ends",
    };
  }
  if (name.endsWith("_leaves")) {
    return { name, shapes, sight: "veils" };
  }
  // A block without a shape, such as a sign, a torch or a flower, stands in nobody's way.
  if (shapes.length === 0) {
    return { name, shapes: fullCell, sight: "passes", bodiless: true };
  }
  return { name, shapes, sight: isClear(name) ? "passes" : "ends" };
}

// A standing player's eyes are this far above the feet.
const eyeHeight = 1.62;

const rayCount = 8000;

// How far sight reaches, in blocks.
const range = 96;

// The half angle of a look toward a position, in degrees.
const narrow = 25;

// Where the near and the middle band end in a look all around.
const nearLimit = 6;
const middleLimit = 24;

// The longest the rays keep the core's thread before other work gets a turn, in milliseconds.
const sliceMs = 8;

export const look = defineQuery({
  name: "look",
  description:
    "Report what the bot sees. A block is in view when a straight line from the bot's eyes reaches it, in any direction around the bot. Sight passes glass and water, and one block of leaves. The farther away something is, the less is said about it. `near` holds the surfaces within a few blocks. A surface is sides of blocks that face the same way and lie in one plane: `faces` is the way they face (`up` for a surface seen from above, `down` for one seen from below, or a compass direction for an upright one), one coordinate is the plane, and the other two are the stretch it covers from edge to edge. A block at position 4 fills 4 to 5. `middle` holds lumps of blocks that touch, each with the distance to its nearest block, its edges, its largest surfaces and its main kinds. `far` holds lumps with only their edges and two main kinds. `rare` names single blocks of kinds that are few in view, with the position to pass to other tools. `omitted` counts smaller entries that were left out. `unloaded` is the share of the view that ends where the world is not loaded. With `toward`, the bot looks only in a cone around that position, and detail reaches about four times farther. North is -z and east is +x.",
  input: z.object({
    toward: z
      .object({ x: z.number(), y: z.number(), z: z.number() })
      .optional()
      .describe("Look only toward this position."),
  }),
  async run({ bot }, { toward }) {
    const eye = bot.entity.position.offset(0, eyeHeight, 0);

    // Rays cross the same cells many times over. A cell's key is its offset from the eye, which
    // stays under 128 on every axis.
    const origin = eye.floored();
    const cells = new Map<number, Cell | "air" | "unloaded">();
    const cellAt: CellAt = (x, y, z) => {
      const key = ((x - origin.x + 128) * 256 + (y - origin.y + 128)) * 256 + (z - origin.z + 128);
      const known = cells.get(key);
      if (known !== undefined) {
        return known;
      }
      const block = bot.blockAt(eye.clone().set(x, y, z));
      const isLiquid = block?.name === "water" || block?.name === "lava";
      const above = isLiquid ? bot.blockAt(eye.clone().set(x, y + 1, z))?.name : undefined;
      const cell = block === null ? "unloaded" : cellOf(block, above);
      cells.set(key, cell);
      return cell;
    };

    const axis =
      toward === undefined
        ? { x: 0, y: 1, z: 0 }
        : { x: toward.x - eye.x, y: toward.y - eye.y, z: toward.z - eye.z };
    const halfAngle = toward === undefined ? 180 : narrow;

    const rays: Array<Ray> = [];
    let sliceStart = performance.now();
    for (const direction of directions(rayCount, axis, halfAngle)) {
      rays.push(cast(eye, direction, range, cellAt));
      if (performance.now() - sliceStart > sliceMs) {
        await Bun.sleep(1);
        sliceStart = performance.now();
      }
    }

    const { seen, unloaded } = gather(rays);
    const closer = zoom(halfAngle);
    return describe(eye, seen, unloaded, {
      near: nearLimit * closer,
      middle: middleLimit * closer,
    });
  },
});
