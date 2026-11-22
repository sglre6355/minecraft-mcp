import type { Face as SeenFace, Shape, Side } from "./cast.ts";

// A block in view, with the sides of it that a ray reached.
export type Seen = {
  x: number;
  y: number;
  z: number;
  name: string;
  // To the nearest point of it that a ray reached.
  distance: number;
  faces: Array<SeenFace>;
};

// A stretch of coordinates, from its low edge to its high edge. A block at position 4 fills 4 to 5.
export type Span = [low: number, high: number];

type Stretch = {
  // How many blocks of it are in view.
  blocks: number;
  // Its most common kinds of block.
  kinds: Array<string>;
};

// Sides of blocks that face the same way and lie in one plane. The plane's coordinate is one
// number, and the other two coordinates are the stretch the surface covers.
export type Surface =
  | (Stretch & { faces: "up" | "down"; y: number; x: Span; z: Span })
  | (Stretch & { faces: "north" | "south"; z: number; x: Span; y: Span })
  | (Stretch & { faces: "west" | "east"; x: number; z: Span; y: Span });

export type Surfaces = {
  // The largest ones, largest first.
  listed: Array<Surface>;
  // How many smaller ones are left out.
  omitted: number;
};

// One side of a block, as a rectangle in its plane. `a` and `b` are the two directions in the
// plane, which are x and z for a level side, and the level direction and y for an upright one.
type Face = {
  side: Side;
  plane: number;
  a: Span;
  b: Span;
  // The block's position along `a` and `b`.
  cell: [number, number];
  name: string;
};

function faceOf(block: Seen, side: Side, [x0, y0, z0, x1, y1, z1]: Shape): Face {
  const { name } = block;
  switch (side) {
    case "up":
      return { side, plane: y1, a: [x0, x1], b: [z0, z1], cell: [block.x, block.z], name };
    case "down":
      return { side, plane: y0, a: [x0, x1], b: [z0, z1], cell: [block.x, block.z], name };
    case "north":
      return { side, plane: z0, a: [x0, x1], b: [y0, y1], cell: [block.x, block.y], name };
    case "south":
      return { side, plane: z1, a: [x0, x1], b: [y0, y1], cell: [block.x, block.y], name };
    case "west":
      return { side, plane: x0, a: [z0, z1], b: [y0, y1], cell: [block.z, block.y], name };
    case "east":
      return { side, plane: x1, a: [z0, z1], b: [y0, y1], cell: [block.z, block.y], name };
  }
}

// Splits the faces of one plane into groups whose blocks touch, corners included.
function parts(faces: Array<Face>): Array<Array<Face>> {
  const byCell = new Map<string, Array<Face>>();
  for (const face of faces) {
    const key = face.cell.join(",");
    const there = byCell.get(key);
    if (there === undefined) {
      byCell.set(key, [face]);
    } else {
      there.push(face);
    }
  }
  const found: Array<Array<Face>> = [];
  const visited = new Set<string>();
  for (const start of byCell.keys()) {
    if (visited.has(start)) {
      continue;
    }
    visited.add(start);
    const part: Array<Face> = [];
    const queue = [start];
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      const here = byCell.get(key) ?? [];
      part.push(...here);
      const [a, b] = here[0]?.cell ?? [0, 0];
      for (const da of [-1, 0, 1]) {
        for (const db of [-1, 0, 1]) {
          const neighbor = `${a + da},${b + db}`;
          if (byCell.has(neighbor) && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
    found.push(part);
  }
  return found;
}

function mostCommon(names: Array<string>, most: number): Array<string> {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, most)
    .map(([name]) => name);
}

function surfaceOf(faces: Array<Face>, side: Side, plane: number): Surface {
  const a: Span = [
    Math.min(...faces.map((face) => face.a[0])),
    Math.max(...faces.map((face) => face.a[1])),
  ];
  const b: Span = [
    Math.min(...faces.map((face) => face.b[0])),
    Math.max(...faces.map((face) => face.b[1])),
  ];
  const stretch = {
    blocks: new Set(faces.map((face) => face.cell.join(","))).size,
    kinds: mostCommon(
      faces.map((face) => face.name),
      2,
    ),
  };
  switch (side) {
    case "up":
    case "down":
      return { faces: side, y: plane, x: a, z: b, ...stretch };
    case "north":
    case "south":
      return { faces: side, z: plane, x: a, y: b, ...stretch };
    case "west":
    case "east":
      return { faces: side, x: plane, z: a, y: b, ...stretch };
  }
}

// The surfaces that some blocks in view make up.
// With `touching`, a plane's sides that do not touch count as surfaces of their own. From far
// away the rays leave gaps between the blocks they reach, so there a plane is one surface.
export function surfaces(
  blocks: Array<Seen>,
  options: { touching: boolean; most: number },
): Surfaces {
  const planes = new Map<string, Array<Face>>();
  for (const block of blocks) {
    for (const { side, box } of block.faces) {
      const face = faceOf(block, side, box);
      const key = `${face.side} ${face.plane}`;
      const there = planes.get(key);
      if (there === undefined) {
        planes.set(key, [face]);
      } else {
        there.push(face);
      }
    }
  }

  const all: Array<Surface> = [];
  for (const faces of planes.values()) {
    const first = faces[0];
    if (first !== undefined) {
      for (const part of options.touching ? parts(faces) : [faces]) {
        all.push(surfaceOf(part, first.side, first.plane));
      }
    }
  }
  all.sort((a, b) => b.blocks - a.blocks);
  return { listed: all.slice(0, options.most), omitted: Math.max(0, all.length - options.most) };
}
