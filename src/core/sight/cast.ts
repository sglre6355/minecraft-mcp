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
  // block that the ray enters from another of its kind. The surface of water that the eye is
  // in comes as a box without thickness.
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

// Whether a point lies in one of the boxes of the block in the cell at x, y, z.
function holds(shapes: Array<Shape>, x: number, y: number, z: number, point: Vector): boolean {
  return shapes.some(
    ([x0, y0, z0, x1, y1, z1]) =>
      point.x >= x + x0 &&
      point.x <= x + x1 &&
      point.y >= y + y0 &&
      point.y <= y + y1 &&
      point.z >= z + z0 &&
      point.z <= z + z1,
  );
}

// What the eye is in: the block whose body holds it, or else the liquid of its cell, or air.
export function surrounding(eye: Vector, cellAt: CellAt): string {
  const x = Math.floor(eye.x);
  const y = Math.floor(eye.y);
  const z = Math.floor(eye.z);
  const cell = cellAt(x, y, z);
  if (cell === "air" || cell === "unloaded") {
    return cell;
  }
  if (cell.bodiless !== true && holds(cell.shapes, x, y, z, eye)) {
    return cell.name;
  }
  return cell.within ?? "air";
}

type Axis = "x" | "y" | "z";

// The side a ray meets when it travels along an axis, up it or down it.
const sideMet = {
  x: { up: "west", down: "east" },
  y: { up: "down", down: "up" },
  z: { up: "north", down: "south" },
} as const;

// The side of a box that a ray leaves through, as a box without thickness.
function sideOf([x0, y0, z0, x1, y1, z1]: Shape, axis: Axis, way: "up" | "down"): Shape {
  switch (axis) {
    case "x": {
      const x = way === "up" ? x1 : x0;
      return [x, y0, z0, x, y1, z1];
    }
    case "y": {
      const y = way === "up" ? y1 : y0;
      return [x0, y, z0, x1, y, z1];
    }
    case "z": {
      const z = way === "up" ? z1 : z0;
      return [x0, y0, z, x1, y1, z];
    }
  }
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
  // The see-through block that holds the eye, for as long as the ray has not left it, and the
  // box of it that the ray was in last. Where the ray leaves it, its surface shows from the
  // inside, as the surface of water does from below.
  let medium: string | undefined;
  let last: { x: number; y: number; z: number; box: Shape } | undefined;
  let stepped: Axis = "x";
  let veils = 0;
  let entered = 0;
  while (entered <= range) {
    const found = cellAt(cell.x, cell.y, cell.z);
    if (found === "unloaded") {
      return { hits, unloaded: true };
    }
    if (found === "air") {
      if (medium !== undefined && last !== undefined) {
        // The ray left through the border between two cells.
        const way = step[stepped] > 0 ? "up" : "down";
        const { x, y, z } = last;
        const face = { side: sideMet[stepped][way], box: sideOf(last.box, stepped, way) };
        hits.push({ x, y, z, name: medium, distance: entered, face });
        medium = undefined;
      }
      inside = undefined;
    } else {
      if (
        entered === 0 &&
        found.sight === "passes" &&
        found.bodiless !== true &&
        found.within === undefined &&
        holds(found.shapes, cell.x, cell.y, cell.z, eye)
      ) {
        medium = found.name;
      }
      if (medium !== undefined && found.name === medium) {
        const box = around(found.shapes, cell.x, cell.y, cell.z);
        const top = box[4];
        // The top of the block lies under the top of its cell, as the surface of water does.
        const leaves = direction.y > 0 ? (top - eye.y) / direction.y : Infinity;
        const leftCell = Math.min(next.x, next.y, next.z);
        if (top < cell.y + 1 && leaves < leftCell) {
          hits.push({
            ...cell,
            name: medium,
            distance: leaves,
            face: { side: "down", box: [box[0], top, box[2], box[3], top, box[5]] },
          });
          medium = undefined;
        } else {
          last = { ...cell, box };
        }
      } else if (medium !== undefined && found.within !== medium) {
        medium = undefined;
      }

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
      stepped = "x";
    } else if (next.y <= next.z) {
      stepped = "y";
    } else {
      stepped = "z";
    }
    entered = next[stepped];
    cell[stepped] += step[stepped];
    next[stepped] += apart[stepped];
  }
  return { hits, unloaded: false };
}
