// Some of one kind of item, in a slot or on the cursor. `kind` tells stacks apart that do not
// go into one slot together, and `size` is how many of the kind one slot holds.
export type Pile = { kind: string; count: number; size: number };

export type Click = { slot: number; button: "left" | "right" };

type Slots = ReadonlyArray<Pile | null>;

// What a click does to the slots and the cursor, by the rules of the game. Changes `slots`
// and returns the new cursor.
export function press(slots: Array<Pile | null>, cursor: Pile | null, click: Click): Pile | null {
  const there = slots[click.slot] ?? null;
  if (cursor === null) {
    // An empty hand takes the whole stack.
    slots[click.slot] = null;
    return there;
  }
  if (there !== null && there.kind !== cursor.kind) {
    // A stack put down on another kind changes places with it.
    slots[click.slot] = cursor;
    return there;
  }
  const room = cursor.size - (there?.count ?? 0);
  const put = Math.min(room, click.button === "left" ? cursor.count : 1);
  slots[click.slot] = { ...cursor, count: (there?.count ?? 0) + put };
  return put === cursor.count ? null : { ...cursor, count: cursor.count - put };
}

// Why the slots cannot be brought into a layout, or undefined when they can. They can when
// the layout holds as many of each kind as the slots do and overfills no slot. `called`
// gives the name of a kind for the message.
export function misfit(
  now: Slots,
  want: Slots,
  called: (kind: string) => string,
): string | undefined {
  const tooMany = want.find((pile) => pile !== null && pile.count > pile.size);
  if (tooMany !== undefined && tooMany !== null) {
    return `One slot holds at most ${tooMany.size} ${called(tooMany.kind)}, and the layout puts ${tooMany.count} into one.`;
  }
  const total = (piles: Slots, kind: string) =>
    piles.reduce((sum, pile) => sum + (pile?.kind === kind ? pile.count : 0), 0);
  const kinds = new Set([...now, ...want].flatMap((pile) => (pile === null ? [] : [pile.kind])));
  const off = [...kinds].filter((kind) => total(now, kind) !== total(want, kind));
  if (off.length === 0) {
    return undefined;
  }
  const shown = off
    .slice(0, 5)
    .map(
      (kind) =>
        `${total(want, kind)} ${called(kind)} where the container holds ${total(now, kind)}`,
    );
  return `The layout must hold what the container holds, no more and no less. It has ${shown.join(", ")}.`;
}

// The most clicks a layout may take. A large chest that is turned over completely takes a
// few hundred.
const mostClicks = 20_000;

// The clicks that bring the slots into the layout, as a player would make them: stacks are
// picked up and put down where they belong, and a stack in the way changes places with the
// one on the cursor. The layout must fit, see `misfit`.
export function arrange(now: Slots, want: Slots): Array<Click> {
  const slots = now.map((pile) => (pile === null ? null : { ...pile }));
  const clicks: Array<Click> = [];
  let cursor: Pile | null = null;
  const click = (slot: number, button: Click["button"]) => {
    cursor = press(slots, cursor, { slot, button });
    clicks.push({ slot, button });
    if (clicks.length > mostClicks) {
      throw new Error("The layout takes too many clicks.");
    }
  };
  const wanted = (slot: number) => want[slot] ?? null;
  const misplaced = (slot: number) => {
    const pile = slots[slot] ?? null;
    return pile !== null && pile.kind !== wanted(slot)?.kind;
  };
  const extra = (slot: number) => (slots[slot]?.count ?? 0) - (wanted(slot)?.count ?? 0);

  for (;;) {
    const all = slots.map((_, slot) => slot);
    const from = all.find(misplaced) ?? all.find((slot) => extra(slot) > 0);
    if (from === undefined) {
      return clicks;
    }
    const stays = misplaced(from) ? 0 : (wanted(from)?.count ?? 0);
    click(from, "left");
    // The whole stack is on the cursor. What belongs in the slot goes back one by one.
    for (let back = 0; back < stays; back += 1) {
      click(from, "right");
    }
    while (cursor !== null) {
      const held: Pile = cursor;
      const lacking = all.find((slot) => {
        const pile = slots[slot] ?? null;
        return (
          wanted(slot)?.kind === held.kind &&
          (pile === null || (pile.kind === held.kind && pile.count < (wanted(slot)?.count ?? 0)))
        );
      });
      if (lacking !== undefined) {
        const need = (wanted(lacking)?.count ?? 0) - (slots[lacking]?.count ?? 0);
        if (held.count <= need) {
          click(lacking, "left");
        } else {
          for (let placed = 0; placed < need; placed += 1) {
            click(lacking, "right");
          }
        }
        continue;
      }
      const taken = all.find((slot) => wanted(slot)?.kind === held.kind && misplaced(slot));
      if (taken === undefined) {
        throw new Error("The layout does not hold what the container holds.");
      }
      click(taken, "left");
    }
  }
}
