import { describe, expect, test } from "bun:test";

import type { Held, Outcome, Wanted } from "./moves.ts";

import { held, plan, shortfall } from "./moves.ts";

const wool = (count: number): Held => ({
  name: "white_wool",
  label: "White Wool",
  details: {},
  count,
  stackSize: 64,
  kind: "white_wool",
});
const stone = (count: number): Held => ({
  name: "stone",
  label: "Stone",
  details: {},
  count,
  stackSize: 64,
  kind: "stone",
});
const key = (count: number): Held => ({ ...stone(count), label: "Gate Key", kind: "stone+key" });
const sword: Held = {
  name: "iron_sword",
  label: "Iron Sword",
  details: {},
  count: 1,
  stackSize: 1,
  kind: "iron_sword",
};

// The names the items have when nobody has given them one.
const names = (name: string) =>
  ({ white_wool: "White Wool", stone: "Stone", iron_sword: "Iron Sword", potion: "Potion" })[
    name
  ] ?? name;

const empty = (slots: number) => Array.from({ length: slots }, () => null);

// A plan between two sides with nine slots to a row.
const between = (
  wanted: Array<Wanted>,
  source: Array<Held | null>,
  destination: Array<Held | null>,
) => plan(wanted, source, destination, 9, 9, names, "forward");

describe("plan", () => {
  test("moves a whole stack into the first empty slot", () => {
    const result = between([{ name: "white_wool" }], [wool(64)], empty(3));

    expect(result.moves).toEqual([{ from: 0, to: 0, count: 64 }]);
    expect(result.outcomes).toEqual([
      {
        name: "white_wool",
        label: "White Wool",
        details: {},
        called: "white_wool",
        moved: 64,
        left: 0,
        why: "none",
        searched: "everywhere",
        others: false,
      },
    ]);
  });

  test("finds a stack by its details whatever order their keys come in", () => {
    const brew: Held = {
      name: "potion",
      label: "Potion",
      details: { data: { Potion: "minecraft:healing", CustomPotionColor: 1 } },
      count: 1,
      stackSize: 1,
      kind: "potion+healing",
    };
    const details = { data: { CustomPotionColor: 1, Potion: "minecraft:healing" } };

    expect(between([{ name: "potion", details }], [brew], empty(1)).moves).toEqual([
      { from: 0, to: 0, count: 1 },
    ]);
    expect(between([{ name: "potion" }], [brew], empty(1)).moves).toEqual([]);
  });

  test("takes from several slots when one does not hold enough", () => {
    const source = [wool(64), null, wool(64)];
    const result = between([{ name: "white_wool", count: 100 }], source, empty(3));

    expect(result.moves).toEqual([
      { from: 0, to: 0, count: 64 },
      { from: 2, to: 1, count: 36 },
    ]);
    expect(result.outcomes[0]).toMatchObject({ moved: 100, left: 0, why: "none" });
  });

  test("tops up a stack of the same kind before it uses an empty slot", () => {
    const result = between([{ name: "white_wool" }], [wool(30)], [null, wool(50)]);

    expect(result.moves).toEqual([
      { from: 0, to: 1, count: 14 },
      { from: 0, to: 0, count: 16 },
    ]);
  });

  test("fills from the last slot back when asked to", () => {
    const result = plan([{ name: "white_wool" }], [wool(10)], empty(3), 9, 9, names, "backward");

    expect(result.moves).toEqual([{ from: 0, to: 2, count: 10 }]);
  });

  test("leaves a stack with a name of its own alone unless the name is given", () => {
    const source = [key(3), stone(5)];

    expect(between([{ name: "stone" }], source, empty(2)).moves).toEqual([
      { from: 1, to: 0, count: 5 },
    ]);
    expect(between([{ name: "stone", label: "Gate Key" }], source, empty(2)).moves).toEqual([
      { from: 0, to: 0, count: 3 },
    ]);
  });

  test("puts no stack on one of another kind, even with the same label", () => {
    const result = between([{ name: "stone" }], [stone(5)], [{ ...key(3), label: "Stone" }, null]);

    expect(result.moves).toEqual([{ from: 0, to: 1, count: 5 }]);
  });

  test("takes only from the sources given, in their order", () => {
    const sources = [
      { row: 1, column: 0 },
      { row: 0, column: 0 },
    ];
    const source = [wool(64), wool(64), null, wool(64)];
    const wanted = [{ name: "white_wool", count: 70, sources }];
    const result = plan(wanted, source, empty(4), 3, 9, names, "forward");

    expect(result.moves).toEqual([
      { from: 3, to: 0, count: 64 },
      { from: 0, to: 1, count: 6 },
    ]);
  });

  test("puts only into the destinations given, in their order", () => {
    const destinations = [
      { row: 0, column: 2 },
      { row: 0, column: 0 },
    ];
    const result = between([{ name: "white_wool", destinations }], [wool(64), wool(10)], empty(3));

    expect(result.moves).toEqual([
      { from: 0, to: 2, count: 64 },
      { from: 1, to: 0, count: 10 },
    ]);
  });

  test("moves what fits and says that the rest found no room", () => {
    const result = between([{ name: "white_wool" }], [wool(64), wool(64)], [wool(40), sword]);

    expect(result.moves).toEqual([{ from: 0, to: 0, count: 24 }]);
    expect(result.outcomes[0]).toMatchObject({ moved: 24, left: 104, why: "full" });
  });

  test("moves what there is and says that the rest is missing", () => {
    const result = between([{ name: "white_wool", count: 100 }], [wool(64)], empty(3));

    expect(result.outcomes[0]).toMatchObject({ moved: 64, left: 36, why: "missing" });
  });

  test("moves nothing and says so when nothing of the kind is there", () => {
    const result = between([{ name: "white_wool" }], [stone(5)], empty(3));

    expect(result.moves).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ moved: 0, left: 0, why: "missing" });
  });

  test("skips a source that holds something else", () => {
    const sources = [{ row: 0, column: 0 }];
    const result = between([{ name: "white_wool", sources }], [stone(5), wool(64)], empty(3));

    expect(result.moves).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ moved: 0, why: "missing" });
  });

  test("gives one slot to each item that does not stack", () => {
    const result = between([{ name: "iron_sword" }], [sword, sword], [sword, null, null]);

    expect(result.moves).toEqual([
      { from: 0, to: 1, count: 1 },
      { from: 1, to: 2, count: 1 },
    ]);
  });

  test("lets a later entry use only the room an earlier one left", () => {
    const wanted = [{ name: "white_wool" }, { name: "stone" }];
    const result = between(wanted, [wool(64), stone(5)], empty(1));

    expect(result.outcomes.map(({ moved, why }) => [moved, why])).toEqual([
      [64, "none"],
      [0, "full"],
    ]);
  });
});

describe("held", () => {
  const stored = {
    type: 1,
    name: "stone",
    displayName: "Stone",
    count: 5,
    stackSize: 64,
    customName: null,
    customLore: null,
    enchants: [],
    nbt: null,
  };

  test("is nothing for an empty slot", () => {
    expect(held(null)).toBeNull();
  });

  test("tells a stack with a name of its own apart from a plain one of the same item", () => {
    const named = {
      ...stored,
      customName: '{"text":"Stone"}',
      nbt: { type: "compound", value: {} },
    };

    expect(held(stored)?.label).toBe("Stone");
    expect(held(named)?.label).toBe("Stone");
    expect(held(named)?.kind).not.toBe(held(stored)?.kind);
  });
});

describe("shortfall", () => {
  const outcome: Omit<Outcome, "moved" | "left" | "why"> = {
    name: "white_wool",
    label: "White Wool",
    details: {},
    called: "white_wool",
    searched: "everywhere",
    others: false,
  };

  test("says how much moved and that the rest found no room", () => {
    const text = shortfall(
      [{ ...outcome, moved: 100, left: 28, why: "full" }],
      "inventory",
      "chest",
    );

    expect(text).toBe("Moved 100 of 128 white_wool. The chest has no room for the other 28.");
  });

  test("says that the source ran out", () => {
    const text = shortfall(
      [{ ...outcome, moved: 64, left: 36, why: "missing" }],
      "chest",
      "inventory",
    );

    expect(text).toBe("Moved 64 of 100 white_wool. The chest holds no more.");
  });

  test("speaks of the slots when the call named its sources", () => {
    const text = shortfall(
      [{ ...outcome, searched: "sources", moved: 64, left: 36, why: "missing" }],
      "chest",
      "inventory",
    );

    expect(text).toBe("Moved 64 of 100 white_wool. The slots given as sources hold no more.");
  });

  test("says so when nothing of the kind was there, and names the label asked for", () => {
    const key = {
      ...outcome,
      name: "stone",
      label: "Gate Key",
      called: 'stone labeled "Gate Key"',
    };
    const text = shortfall([{ ...key, moved: 0, left: 0, why: "missing" }], "chest", "inventory");

    expect(text).toBe('The chest holds no stone labeled "Gate Key".');
  });

  test("points to the label and details when the item is there in another form", () => {
    const potion = { ...outcome, name: "potion", called: "potion", others: true };
    const text = shortfall(
      [{ ...potion, moved: 0, left: 0, why: "missing" }],
      "chest",
      "inventory",
    );

    expect(text).toBe(
      "The chest holds no potion. There is potion with another label or other details. Give the `label` and `details` that the list of slots shows for it.",
    );
  });

  test("lists every entry, the ones that went through as well", () => {
    const text = shortfall(
      [
        { ...outcome, moved: 64, left: 0, why: "none" },
        { ...outcome, name: "stone", called: "stone", moved: 0, left: 5, why: "full" },
      ],
      "inventory",
      "chest",
    );

    expect(text).toBe(
      "Moved 64 white_wool. Moved 0 of 5 stone. The chest has no room for the other 5.",
    );
  });
});
