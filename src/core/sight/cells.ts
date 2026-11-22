import type { Vector } from "./rays.ts";
import type { Eye } from "./view.ts";

// The first and the last block of a row of blocks.
export type Row = readonly [first: number, last: number];

// A box of cells, by the blocks it reaches from and to on each axis.
export type Box = {
  x: Row;
  y: Row;
  z: Row;
};

// Cells on top of one another that hold the same thing, from the lowest to the highest y.
// `unseen` stands for cells that no ray crossed.
export type Run = [low: number, high: number, name: string];

export type Column = {
  x: number;
  z: number;
  // From the lowest cell up.
  cells: Array<Run>;
};

// What every cell of a box holds, as far as it is in view.
export type CellView = {
  eye: Eye;
  box: Box;
  columns: Array<Column>;
};

// How far the box reaches from the block in its middle, to each side and down and up.
const reach = { side: 4, down: 3, up: 5 };

// The box of cells around a position. A body stands in the middle block and the one above
// it, so more of the box lies above the middle than below it.
export function boxAround(position: Vector): Box {
  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  const z = Math.floor(position.z);
  return {
    x: [x - reach.side, x + reach.side],
    y: [y - reach.down, y + reach.up],
    z: [z - reach.side, z + reach.side],
  };
}

// What the cells of a box hold, column by column. `known` names what is in a cell that a ray
// crossed. A column without such a cell is left out.
export function columns(
  box: Box,
  known: (x: number, y: number, z: number) => string | undefined,
): Array<Column> {
  const found: Array<Column> = [];
  for (let x = box.x[0]; x <= box.x[1]; x += 1) {
    for (let z = box.z[0]; z <= box.z[1]; z += 1) {
      const cells: Array<Run> = [];
      for (let y = box.y[0]; y <= box.y[1]; y += 1) {
        const name = known(x, y, z) ?? "unseen";
        const last = cells.at(-1);
        if (last !== undefined && last[2] === name) {
          last[1] = y;
        } else {
          cells.push([y, y, name]);
        }
      }
      if (cells.some(([, , name]) => name !== "unseen")) {
        found.push({ x, z, cells });
      }
    }
  }
  return found;
}
