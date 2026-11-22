import type { Vector } from "./rays.ts";

// A box as its lowest and highest corner, x0, y0, z0, x1, y1, z1.
export type Shape = [number, number, number, number, number, number];

// The way a side of a block faces.
export type Side = "down" | "up" | "north" | "south" | "west" | "east";

// What sight needs to know about the block in a cell.
export type Cell = {
  name: string;
  // The boxes the block fills, inside its cell.
  shapes: Array<Shape>;
  // `ends` stops a ray. `passes` lets it through, as glass and water do. `veils` lets it
  // through once, so that a ray ends at the second block of leaves.
  sight: "ends" | "passes" | "veils";
  // The liquid that fills the rest of the cell, for a block that stands in one.
  within?: string;
  // The block has no body, as a torch or a flower. It is in view wherever a ray crosses its
  // cell, and it shows no sides.
  bodiless?: boolean;
};

// A cell holds a block, or air, or lies outside the loaded world.
export type CellAt = (x: number, y: number, z: number) => Cell | "air" | "unloaded";

// A side of a block that is in view.
export type Face = {
  side: Side;
  // The box around the whole block, in the world. A block made of several boxes, such as a
  // wall with its post and arms, counts as one.
  box: Shape;
};

// A block that a ray reached.
export type Hit = {
  x: number;
  y: number;
  z: number;
  name: string;
  distance: number;
  // Missing where the ray met no side. A block without a body has none, and neither has a
  // block that the ray enters from another of its kind.
  face?: Face;
};

export type Ray = {
  hits: Array<Hit>;
  // The ray ran into the edge of the loaded world.
  unloaded: boolean;
};

const veilLimit = 2;

type Entry = {
  distance: number;
  side: Side;
};

// Where a ray enters the nearest of some boxes, which lie in the cell at x, y, z.
// A box that holds the eye has no side toward it and is left out.
function enter(
  eye: Vector,
  direction: Vector,
  shapes: Array<Shape>,
  x: number,
  y: number,
  z: number,
): Entry | undefined {
  let nearest: Entry | undefined;
  for (const [x0, y0, z0, x1, y1, z1] of shapes) {
    const box = [x + x0, y + y0, z + z0, x + x1, y + y1, z + z1] as const;
    let from = -Infinity;
    let to = Infinity;
    let side: Side = "up";
    let missed = false;
    const axes = [
      { start: eye.x, step: direction.x, low: box[0], high: box[3], toward: "west", away: "east" },
      { start: eye.y, step: direction.y, low: box[1], high: box[4], toward: "down", away: "up" },
      {
        start: eye.z,
        step: direction.z,
        low: box[2],
        high: box[5],
        toward: "north",
        away: "south",
      },
    ] as const;
    for (const axis of axes) {
      if (axis.step === 0) {
        missed ||= axis.start < axis.low || axis.start > axis.high;
      } else {
        const a = (axis.low - axis.start) / axis.step;
        const b = (axis.high - axis.start) / axis.step;
        if (Math.min(a, b) > from) {
          from = Math.min(a, b);
          // A ray that travels up an axis meets the side that faces down it.
          side = axis.step > 0 ? axis.toward : axis.away;
        }
        to = Math.min(to, Math.max(a, b));
      }
    }
    if (missed || from > to || from < 0) {
      continue;
    }
    if (nearest === undefined || from < nearest.distance) {
      nearest = { distance: from, side };
    }
  }
  return nearest;
}

// The box around all boxes of a block in the cell at x, y, z.
function around(shapes: Array<Shape>, x: number, y: number, z: number): Shape {
  return [
    x + Math.min(...shapes.map((shape) => shape[0])),
    y + Math.min(...shapes.map((shape) => shape[1])),
    z + Math.min(...shapes.map((shape) => shape[2])),
    x + Math.max(...shapes.map((shape) => shape[3])),
    y + Math.max(...shapes.map((shape) => shape[4])),
    z + Math.max(...shapes.map((shape) => shape[5])),
  ];
}

// The distance along a ray from a position in cell `at` to that cell's border.
function border(position: number, at: number, along: number): number {
  return along === 0 ? Infinity : (at + (along > 0 ? 1 : 0) - position) / along;
}

// Follows one ray from the eye through the cells on its way, and reports the blocks it reaches.
// `direction` has length one.
export function cast(eye: Vector, direction: Vector, range: number, cellAt: CellAt): Ray {
  const hits: Array<Hit> = [];
  const cell = { x: Math.floor(eye.x), y: Math.floor(eye.y), z: Math.floor(eye.z) };
  const step = {
    x: Math.sign(direction.x),
    y: Math.sign(direction.y),
    z: Math.sign(direction.z),
  };
  // The distance along the ray to the next cell border on each axis, and between two borders.
  const next = {
    x: border(eye.x, cell.x, direction.x),
    y: border(eye.y, cell.y, direction.y),
    z: border(eye.z, cell.z, direction.z),
  };
  const apart = {
    x: direction.x === 0 ? Infinity : Math.abs(1 / direction.x),
    y: direction.y === 0 ? Infinity : Math.abs(1 / direction.y),
    z: direction.z === 0 ? Infinity : Math.abs(1 / direction.z),
  };

  // The kind of block the ray is inside. A ray that goes from water into more water sees
  // no side between the two.
  let inside: string | undefined;
  let veils = 0;
  let entered = 0;
  while (entered <= range) {
    const found = cellAt(cell.x, cell.y, cell.z);
    if (found === "unloaded") {
      return { hits, unloaded: true };
    }
    if (found === "air") {
      inside = undefined;
    } else {
      const entry = enter(eye, direction, found.shapes, cell.x, cell.y, cell.z);
      if (entry === undefined) {
        // The eye is in the block, or the ray slips past its boxes.
        inside = found.within ?? (entered === 0 ? found.name : undefined);
      } else if (entry.distance > range) {
        break;
      } else {
        const fromSameKind = inside === found.name;
        if (found.sight !== "passes" || !fromSameKind) {
          const hit: Hit = { ...cell, name: found.name, distance: entry.distance };
          if (found.bodiless !== true && !fromSameKind) {
            const box = around(found.shapes, cell.x, cell.y, cell.z);
            hit.face = { side: entry.side, box };
          }
          hits.push(hit);
        }
        inside = found.within ?? found.name;
        if (found.sight === "veils") {
          veils += 1;
        }
        if (found.sight === "ends" || veils >= veilLimit) {
          break;
        }
      }
    }

    if (next.x <= next.y && next.x <= next.z) {
      entered = next.x;
      cell.x += step.x;
      next.x += apart.x;
    } else if (next.y <= next.z) {
      entered = next.y;
      cell.y += step.y;
      next.y += apart.y;
    } else {
      entered = next.z;
      cell.z += step.z;
      next.z += apart.z;
    }
  }
  return { hits, unloaded: false };
}
