import type { Bot } from "mineflayer";

import { z } from "zod";

import type { Cell, CellAt, Ray, Shape } from "../sight/cast.ts";
import type { CellView } from "../sight/cells.ts";
import type { Vector } from "../sight/rays.ts";
import type { FindView, View } from "../sight/view.ts";

import { blockNamed } from "../items.ts";
import { cast, inView, surrounding } from "../sight/cast.ts";
import { boxAround, columns } from "../sight/cells.ts";
import { coneOver, directions, zoom } from "../sight/rays.ts";
import { describe, gather, rounded, spotted } from "../sight/view.ts";
import { defineQuery } from "./query.ts";

// Air, and the blocks that are as invisible as air.
const unseen = new Set(["air", "cave_air", "void_air", "light", "barrier", "structure_void"]);

const fullCell: Array<Shape> = [[0, 0, 0, 1, 1, 1]];

// The surface of water and lava lies a little under the top of its cell.
const liquidSurface: Array<Shape> = [[0, 0, 0, 1, 0.875, 1]];

// Blocks that one can see through: clear ones, and ones made of bars or rails with gaps.
function isClear(name: string): boolean {
  return (
    name.includes("glass") ||
    name === "ice" ||
    name === "frosted_ice" ||
    name === "iron_bars" ||
    name.endsWith("_fence") ||
    name.endsWith("_fence_gate")
  );
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

// The most blocks that a search for one kind lists.
const mostFound = 50;

// The longest the rays keep the core's thread before other work gets a turn, in milliseconds.
const sliceMs = 8;

// The bot's eyes, and how sight meets the cells of its world. Rays cross the same cells many
// times over, so each cell is worked out once.
export function sightOf(bot: Bot) {
  const eye = bot.entity.position.offset(0, eyeHeight, 0);
  // A cell's key is its offset from the eye, which stays under 128 on every axis.
  const origin = eye.floored();
  const cells = new Map<number, Cell | "air" | "unloaded">();
  const keyOf = (x: number, y: number, z: number) =>
    ((x - origin.x + 128) * 256 + (y - origin.y + 128)) * 256 + (z - origin.z + 128);
  const cellAt: CellAt = (x, y, z) => {
    const key = keyOf(x, y, z);
    const worked = cells.get(key);
    if (worked !== undefined) {
      return worked;
    }
    const block = bot.blockAt(eye.clone().set(x, y, z));
    const isLiquid = block?.name === "water" || block?.name === "lava";
    const above = isLiquid ? bot.blockAt(eye.clone().set(x, y + 1, z))?.name : undefined;
    const cell = block === null ? "unloaded" : cellOf(block, above);
    cells.set(key, cell);
    return cell;
  };
  // What a cell holds, for a cell that a ray crossed.
  const known = (x: number, y: number, z: number) => {
    const cell = cells.get(keyOf(x, y, z));
    return cell === undefined || typeof cell === "string" ? cell : cell.name;
  };
  return { eye, cellAt, known };
}

// Whether sight reaches into the cell at a position. The cell of a block in view counts, and
// so does a cell of air that sight passes through.
export function sees(sight: ReturnType<typeof sightOf>, x: number, y: number, z: number): boolean {
  return inView(sight.eye, { x, y, z }, range, sight.cellAt);
}

export const look = defineQuery({
  name: "look",
  description:
    "Report what the bot sees. A block is in view when a straight line from the bot's eyes reaches it within 96 blocks. Sight passes glass and water, and one block of leaves. `eye` is where the eyes are and what they are in, such as air or water. North is -z and east is +x. There are three modes. Mode `surfaces` looks in every direction around the bot. The farther away something is, the less is said about it. `near` holds the surfaces within a few blocks. A surface is sides of blocks that face the same way and lie in one plane: `faces` is the way they face (`up` for a surface seen from above, `down` for one seen from below, or a compass direction for an upright one), one coordinate is the plane, and the other two are the stretch it covers from edge to edge. A block at position 4 fills 4 to 5. Seen from under water, the surface of the water is a surface that faces down. `middle` holds lumps of blocks that touch, each with the distance to its nearest block, its edges, its largest surfaces and its main kinds. `far` holds lumps with only their edges and two main kinds. `rare` names single blocks of kinds that are few in view, with the position to pass to other tools. `omitted` counts smaller entries that were left out. `unloaded` is the share of the view that ends where the world is not loaded. With `toward`, the bot looks only in a cone around that position, and detail reaches about four times farther. Mode `cells` reports every cell of a box of 9 by 9 by 9 blocks around the bot, or around `toward`. `box` gives the first and the last block of the box on each axis. `columns` lists the columns of the box by x and z. Each entry of `cells` is a run of cells on top of one another that hold the same thing: the lowest y, the highest y, and a block name, `air`, or `unseen` for cells that are not in view. A column without a cell in view is left out. Mode `find` lists the blocks of the kind named by `block` that are in view, nearest first, each with its distance. `omitted` counts the ones beyond the first 50. A small block far away can lie between two rays and go unseen, and `toward` searches one direction more closely.",
  input: z.object({
    mode: z
      .enum(["surfaces", "cells", "find"])
      .default("surfaces")
      .describe(
        "What to report: the surfaces all around, every cell of a small box, or the blocks of one kind.",
      ),
    toward: z
      .object({ x: z.number(), y: z.number(), z: z.number() })
      .optional()
      .describe(
        "In the modes surfaces and find, look only toward this position. In mode cells, the middle of the box.",
      ),
    block: z
      .string()
      .optional()
      .describe("In mode find, the name of the block to look for, such as oak_sign."),
  }),
  async run({ bot }, { mode, toward, block }): Promise<View | CellView | FindView> {
    if (mode === "find" && block === undefined) {
      throw new Error("Mode find needs `block`, the name of the block to look for.");
    }
    if (mode !== "find" && block !== undefined) {
      throw new Error("`block` goes with mode find only.");
    }
    const sought = block === undefined ? undefined : blockNamed(bot, block).name;
    const feet = bot.entity.position;
    const { eye: eyeAt, cellAt, known } = sightOf(bot);
    const sweep = async (axis: Vector, halfAngle: number, reach: number) => {
      const rays: Array<Ray> = [];
      let sliceStart = performance.now();
      for (const direction of directions(rayCount, axis, halfAngle)) {
        rays.push(cast(eyeAt, direction, reach, cellAt));
        if (performance.now() - sliceStart > sliceMs) {
          await Bun.sleep(1);
          sliceStart = performance.now();
        }
      }
      return rays;
    };
    const eye = { x: eyeAt.x, y: eyeAt.y, z: eyeAt.z, in: surrounding(eyeAt, cellAt) };

    if (mode === "cells") {
      const box = boxAround(toward ?? feet);
      const middle = {
        x: (box.x[0] + box.x[1] + 1) / 2,
        y: (box.y[0] + box.y[1] + 1) / 2,
        z: (box.z[0] + box.z[1] + 1) / 2,
      };
      const radius =
        Math.hypot(box.x[1] - box.x[0] + 1, box.y[1] - box.y[0] + 1, box.z[1] - box.z[0] + 1) / 2;
      const { axis, halfAngle, away } = coneOver(eyeAt, middle, radius);
      await sweep(axis, halfAngle, Math.min(range, away + radius));
      return { eye: rounded(eye), box, columns: columns(box, known) };
    }

    const axis =
      toward === undefined
        ? { x: 0, y: 1, z: 0 }
        : { x: toward.x - eye.x, y: toward.y - eye.y, z: toward.z - eye.z };
    const halfAngle = toward === undefined ? 180 : narrow;
    const { seen, unloaded } = gather(await sweep(axis, halfAngle, range));
    if (sought !== undefined) {
      return {
        eye: rounded(eye),
        block: sought,
        ...spotted(seen, sought, mostFound),
        unloaded: Math.round(unloaded * 100) / 100,
      };
    }
    const closer = zoom(halfAngle);
    return describe(eye, seen, unloaded, {
      near: nearLimit * closer,
      middle: middleLimit * closer,
    });
  },
});
