import type { Bot } from "mineflayer";
import type { Move, SafeBlock } from "mineflayer-pathfinder";

import { Movements as PathfinderMovements } from "mineflayer-pathfinder";

type Vector = Bot["entity"]["position"];

type Shape = SafeBlock["shapes"][number];

// Whether a block holds up a bot that stands in the middle of it.
// An open trapdoor keeps a thin box at one edge, and an open gate keeps none.
export function coversMiddle(shapes: Array<Shape>): boolean {
  return shapes.some(([x0, , z0, x1, , z1]) => x0 <= 0.5 && x1 >= 0.5 && z0 <= 0.5 && z1 >= 0.5);
}

// The highest floor the bot gets onto from the top of deep water, counted from the bottom of
// the water block it floats in. Still water stands 0.89 high, and the bot climbs 0.61 above
// its surface.
const highestClimb = 1.5;

export function climbsOut(waterY: number, floorTop: number): boolean {
  return floorTop - waterY <= highestClimb;
}

function isWater(block: SafeBlock): boolean {
  return block.liquid && block.name === "water";
}

const sides = [
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: 0, z: 1 },
];

// A step of a path, in the form the pathfinder builds its own.
function step(from: Move, to: Vector, cost: number): Move {
  return Object.assign(to, {
    remainingBlocks: from.remainingBlocks,
    cost,
    toBreak: [],
    toPlace: [],
    parkour: false,
    hash: `${to.x},${to.y},${to.z}`,
  });
}

// The pathfinder's rules for where the bot can go, with what they lack.
export class Movements extends PathfinderMovements {
  override getBlock(position: Vector, dx: number, dy: number, dz: number): SafeBlock {
    const block = super.getBlock(position, dx, dy, dz);
    // A ladder holds the bot without a box under its middle.
    if (block.physical && !block.climbable && !coversMiddle(block.shapes)) {
      block.physical = false;
    }
    return block;
  }

  // Adds the ways through deep water. The pathfinder only swims level and leaves water
  // where it can stand on the bottom.
  override getNeighbors(node: Move): Array<Move> {
    const neighbors = super.getNeighbors(node);
    const feet = this.bot.entity.position.clone().set(node.x, node.y, node.z);
    const water = this.getBlock(feet, 0, 0, 0);
    if (!isWater(water)) {
      return neighbors;
    }

    const roomAbove = this.getBlock(feet, 0, 2, 0).safe;
    if (isWater(this.getBlock(feet, 0, 1, 0))) {
      if (roomAbove) {
        neighbors.push(step(node, feet.offset(0, 1, 0), 2));
      }
      return neighbors;
    }

    // Still water has level 0. Flowing water stands lower.
    if (water.metadata !== 0 || !this.getBlock(feet, 0, 1, 0).safe || !roomAbove) {
      return neighbors;
    }
    for (const side of sides) {
      const clear = (dy: number) => this.getBlock(feet, side.x, dy, side.z).safe;
      const bank = this.getBlock(feet, side.x, 0, side.z);
      if (!bank.physical) {
        continue;
      }
      if (clear(1) && clear(2)) {
        neighbors.push(step(node, feet.offset(side.x, 1, side.z), 3));
        continue;
      }
      // Something low lies on the bank, such as a slab.
      const rim = this.getBlock(feet, side.x, 1, side.z);
      if (
        rim.physical &&
        climbsOut(node.y, rim.height) &&
        clear(2) &&
        clear(3) &&
        this.getBlock(feet, 0, 3, 0).safe
      ) {
        neighbors.push(step(node, feet.offset(side.x, 2, side.z), 3));
      }
    }
    return neighbors;
  }
}
