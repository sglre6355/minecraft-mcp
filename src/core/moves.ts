import type { Details, Held, Place } from "./items.ts";

import { matches } from "./items.ts";

// What a call asks to move. Without a label and details it means the stacks that have
// neither. Without a count it means all there is.
export type Wanted = {
  name: string;
  label?: string | undefined;
  details?: Details | undefined;
  count?: number | undefined;
  sources?: Array<Place> | undefined;
  destinations?: Array<Place> | undefined;
};

// Some of a stack, from one slot of the source to one slot of the destination.
export type Move = { from: number; to: number; count: number };

// How one entry of a call went. `called` is how a message names the stack. `why` says what
// kept the rest from moving: the destination had no room for it, or the source did not hold
// it. `searched` says where the stack was looked for, and `others` whether the source holds
// the item in stacks that the entry does not name.
export type Outcome = {
  name: string;
  label: string;
  details: Details;
  called: string;
  moved: number;
  left: number;
  why: "none" | "full" | "missing";
  searched: "everywhere" | "sources";
  others: boolean;
};

export type Plan = { moves: Array<Move>; outcomes: Array<Outcome> };

type Slots = ReadonlyArray<Held | null>;

// What to tell the agent after a call that did not move everything. `source` and
// `destination` name the two sides, such as "inventory" and "chest".
export function shortfall(
  outcomes: ReadonlyArray<Outcome>,
  source: string,
  destination: string,
): string {
  return outcomes
    .map(({ name, called, moved, left, why, searched, others }) => {
      if (why === "none") {
        return `Moved ${moved} ${called}.`;
      }
      if (why === "full") {
        return `Moved ${moved} of ${moved + left} ${called}. The ${destination} has no room for the other ${left}.`;
      }
      const place =
        searched === "sources" ? "The slots given as sources hold" : `The ${source} holds`;
      if (moved > 0) {
        return `Moved ${moved} of ${moved + left} ${called}. ${place} no more.`;
      }
      return others
        ? `${place} no ${called}. There is ${name} with another label or other details. Give the \`label\` and \`details\` that the list of slots shows for it.`
        : `${place} no ${called}.`;
    })
    .join(" ");
}

// Works out the moves that carry out a call, slot by slot, without making them. `labelOf`
// gives the name an item has when nobody has given it one. Without destinations the slots are
// used as a shift-click uses them: stacks of the same kind are topped up first, then empty
// slots are filled, from the first slot on or from the last one back.
export function plan(
  wanted: ReadonlyArray<Wanted>,
  source: Slots,
  destination: Slots,
  sourceColumns: number,
  destinationColumns: number,
  labelOf: (name: string) => string,
  order: "forward" | "backward",
): Plan {
  const from = [...source];
  const to = [...destination];
  const moves: Array<Move> = [];

  const outcomes = wanted.map((entry): Outcome => {
    const label = entry.label ?? labelOf(entry.name);
    const details = entry.details ?? {};
    const fits = (stack: Held | null | undefined): stack is Held =>
      stack !== null && stack !== undefined && matches(stack, entry.name, label, details);

    const everywhere = from.flatMap((stack, slot) => (fits(stack) ? [slot] : []));
    const named = entry.sources?.map(({ row, column }) => row * sourceColumns + column);
    const taken = (named ?? everywhere).filter((slot) => fits(from[slot]));
    const all = taken.reduce((sum, slot) => sum + (from[slot]?.count ?? 0), 0);
    const asked = entry.count ?? all;

    const given = entry.destinations?.map(({ row, column }) => row * destinationColumns + column);
    const spread = to.map((_, slot) => slot);
    const lined = order === "forward" ? spread : spread.toReversed();

    let moved = 0;
    let full = false;
    for (const slot of taken) {
      let carry = Math.min(from[slot]?.count ?? 0, asked - moved);
      const stack = from[slot];
      if (carry === 0 || stack === null || stack === undefined) {
        continue;
      }
      // Stacks of the same kind that have room come before the empty slots.
      const topUp = (given ?? lined).filter((at) => to[at]?.kind === stack.kind);
      const fresh = (given ?? lined).filter((at) => to[at] === null);
      const targets = given === undefined ? [...topUp, ...fresh] : given;
      for (const at of targets) {
        const there = to[at];
        if (there === undefined || (there !== null && there.kind !== stack.kind)) {
          continue;
        }
        const room = stack.stackSize - (there?.count ?? 0);
        const count = Math.min(room, carry);
        if (count <= 0) {
          continue;
        }
        moves.push({ from: slot, to: at, count });
        to[at] = { ...stack, count: (there?.count ?? 0) + count };
        const rest = (from[slot]?.count ?? 0) - count;
        from[slot] = rest === 0 ? null : { ...stack, count: rest };
        carry -= count;
        moved += count;
        if (carry === 0) {
          break;
        }
      }
      if (carry > 0) {
        full = true;
        break;
      }
    }

    const left = asked - moved;
    // An entry without a count that matches nothing leaves nothing behind, and is missing
    // all the same.
    const lacking = left > 0 || all === 0;
    const marked = entry.label !== undefined || entry.details !== undefined;
    return {
      name: entry.name,
      label,
      details,
      called: marked ? `${entry.name} labeled "${label}"` : entry.name,
      searched: named === undefined ? "everywhere" : "sources",
      others:
        all === 0 &&
        source.some((stack, slot) => stack?.name === entry.name && (named?.includes(slot) ?? true)),
      moved,
      left,
      why: full ? "full" : lacking ? "missing" : "none",
    };
  });

  return { moves, outcomes };
}
