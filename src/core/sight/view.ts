import type { Ray } from "./cast.ts";
import type { Seen, Span, Surfaces } from "./surfaces.ts";

import { surfaces } from "./surfaces.ts";

export type Position = {
  x: number;
  y: number;
  z: number;
};

export type Kind = {
  name: string;
  count: number;
};

// One block, named with where it is.
export type Sighting = {
  name: string;
  coordinates: Position;
};

// What lies within a few steps of the eye.
export type Near = {
  within: number;
  surfaces: Surfaces;
  kinds: Array<Kind>;
  rare: Array<Sighting>;
};

// Blocks that touch, some way off.
export type Lump = {
  // To its nearest block in view.
  distance: number;
  x: Span;
  y: Span;
  z: Span;
  // How many of its blocks are in view.
  blocks: number;
  surfaces: Surfaces;
  kinds: Array<Kind>;
  rare: Array<Sighting>;
};

// Blocks that touch, far away.
export type Outline = {
  distance: number;
  x: Span;
  y: Span;
  z: Span;
  kinds: Array<string>;
};

// Where the eyes are, and what they are in, such as air or water.
export type Eye = Position & {
  in: string;
};

export type View = {
  eye: Eye;
  near: Near;
  middle: {
    within: number;
    // The largest ones, nearest first.
    lumps: Array<Lump>;
    // How many smaller ones are left out.
    omitted: number;
  };
  far: {
    // The largest ones, nearest first.
    lumps: Array<Outline>;
    // How many smaller ones are left out.
    omitted: number;
  };
  // The share of the view that ends at the edge of the loaded world.
  unloaded: number;
};

// Puts together what all rays reached, block by block. `unloaded` is the share of rays that
// ran into the edge of the loaded world.
export function gather(rays: Array<Ray>) {
  const blocks = new Map<string, Seen>();
  let cut = 0;
  for (const ray of rays) {
    if (ray.unloaded) {
      cut += 1;
    }
    for (const { x, y, z, name, distance, face } of ray.hits) {
      const key = `${x},${y},${z}`;
      let block = blocks.get(key);
      if (block === undefined) {
        block = { x, y, z, name, distance, faces: [] };
        blocks.set(key, block);
      }
      block.distance = Math.min(block.distance, distance);
      if (face !== undefined && !block.faces.some((known) => known.side === face.side)) {
        block.faces.push(face);
      }
    }
  }
  return { seen: [...blocks.values()], unloaded: rays.length === 0 ? 0 : cut / rays.length };
}

// Groups blocks that touch, corners included. Blocks touch when their cells of the given size
// do, so a larger cell bridges the gaps that rays leave between far blocks.
export function lumps(blocks: Array<Seen>, cell: number): Array<Array<Seen>> {
  const byCell = new Map<string, Array<Seen>>();
  for (const block of blocks) {
    const key = [block.x, block.y, block.z].map((at) => Math.floor(at / cell)).join(",");
    const there = byCell.get(key);
    if (there === undefined) {
      byCell.set(key, [block]);
    } else {
      there.push(block);
    }
  }
  const found: Array<Array<Seen>> = [];
  const visited = new Set<string>();
  for (const start of byCell.keys()) {
    if (visited.has(start)) {
      continue;
    }
    visited.add(start);
    const lump: Array<Seen> = [];
    const queue = [start];
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      lump.push(...(byCell.get(key) ?? []));
      const [x = 0, y = 0, z = 0] = key.split(",").map(Number);
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          for (const dz of [-1, 0, 1]) {
            const neighbor = `${x + dx},${y + dy},${z + dz}`;
            if (byCell.has(neighbor) && !visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }
    }
    found.push(lump);
  }
  return found;
}

// Kinds by how many of the blocks they make up, most first.
function count(blocks: Array<Seen>): Array<Kind> {
  const counts = new Map<string, number>();
  for (const { name } of blocks) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, blocksOfKind]) => ({ name, count: blocksOfKind }))
    .toSorted((a, b) => b.count - a.count);
}

function span(positions: Array<number>): Span {
  return [Math.min(...positions), Math.max(...positions) + 1];
}

// The edges of the smallest box around some blocks.
function edges(blocks: Array<Seen>) {
  return {
    x: span(blocks.map((block) => block.x)),
    y: span(blocks.map((block) => block.y)),
    z: span(blocks.map((block) => block.z)),
  };
}

function nearest(blocks: Array<Seen>): number {
  return Math.min(...blocks.map((block) => block.distance));
}

// The eye as a report gives it, to one decimal place.
export function rounded(eye: Eye): Eye {
  return { x: oneDecimal(eye.x), y: oneDecimal(eye.y), z: oneDecimal(eye.z), in: eye.in };
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

// A kind with this many blocks in view or fewer is listed block by block.
const rareAtMost = 4;

const nearSurfaces = 16;
const lumpSurfaces = 3;
const lumpKinds = 4;
const middleLumps = 12;
const farLumps = 16;

// Rays leave gaps between the blocks they reach, wider ones the farther away.
const middleCell = 2;
const farCell = 6;

// Describes what is in view, with less detail the farther away it is.
// `limits` are the distances at which the near and the middle band end.
export function describe(
  eye: Eye,
  seen: Array<Seen>,
  unloaded: number,
  limits: { near: number; middle: number },
): View {
  const inView = new Map(count(seen).map((kind) => [kind.name, kind.count]));
  const isRare = (block: Seen) => (inView.get(block.name) ?? 0) <= rareAtMost;
  const sightings = (blocks: Array<Seen>): Array<Sighting> =>
    blocks.flatMap((block) =>
      isRare(block)
        ? [{ name: block.name, coordinates: { x: block.x, y: block.y, z: block.z } }]
        : [],
    );
  const common = (blocks: Array<Seen>) => count(blocks.filter((block) => !isRare(block)));

  const near = seen.filter((block) => block.distance <= limits.near);
  const middle = seen.filter(
    (block) => block.distance > limits.near && block.distance <= limits.middle,
  );
  const far = seen.filter((block) => block.distance > limits.middle);

  const someWayOff = lumps(middle, middleCell).toSorted((a, b) => b.length - a.length);
  const farAway = lumps(far, farCell).toSorted((a, b) => b.length - a.length);
  return {
    eye: rounded(eye),
    near: {
      within: oneDecimal(limits.near),
      surfaces: surfaces(near, { touching: true, most: nearSurfaces }),
      kinds: common(near),
      rare: sightings(near),
    },
    middle: {
      within: oneDecimal(limits.middle),
      lumps: someWayOff
        .slice(0, middleLumps)
        .map((blocks) => ({
          distance: oneDecimal(nearest(blocks)),
          ...edges(blocks),
          blocks: blocks.length,
          surfaces: surfaces(blocks, { touching: false, most: lumpSurfaces }),
          kinds: common(blocks).slice(0, lumpKinds),
          rare: sightings(blocks),
        }))
        .toSorted((a, b) => a.distance - b.distance),
      omitted: Math.max(0, someWayOff.length - middleLumps),
    },
    far: {
      lumps: farAway
        .slice(0, farLumps)
        .map((blocks) => ({
          distance: Math.round(nearest(blocks)),
          ...edges(blocks),
          kinds: count(blocks)
            .slice(0, 2)
            .map((kind) => kind.name),
        }))
        .toSorted((a, b) => a.distance - b.distance),
      omitted: Math.max(0, farAway.length - farLumps),
    },
    unloaded: Math.round(unloaded * 100) / 100,
  };
}

// A block of the kind that was looked for, and how far away it is.
export type Spotted = Position & {
  distance: number;
};

// The blocks of one kind that are in view.
export type FindView = {
  eye: Eye;
  block: string;
  // The nearest ones, nearest first.
  positions: Array<Spotted>;
  // How many more are in view.
  omitted: number;
  // The share of the view that ends at the edge of the loaded world.
  unloaded: number;
};

// The blocks of one kind among those in view, nearest first.
export function spotted(seen: Array<Seen>, name: string, most: number) {
  const found = seen
    .filter((block) => block.name === name)
    .toSorted((a, b) => a.distance - b.distance);
  return {
    positions: found
      .slice(0, most)
      .map(({ x, y, z, distance }) => ({ x, y, z, distance: oneDecimal(distance) })),
    omitted: Math.max(0, found.length - most),
  };
}
