import { describe, expect, test } from "bun:test";

import { countByName, gained, list, listed } from "./items.ts";

// A stack as Mineflayer gives it, with nothing of its own.
const stone = {
  name: "stone",
  displayName: "Stone",
  count: 5,
  customName: null,
  customLore: null,
  enchants: [],
  nbt: null,
};

// Item data in the form Mineflayer keeps it.
const text = (value: string) => ({ type: "string", value });
const whole = (value: number) => ({ type: "int", value });
type Parts = { [name: string]: { type: string; value: unknown } };
const compound = (value: Parts) => ({ type: "compound", value });

describe("listed", () => {
  test("gives a stack with nothing of its own the name of its item and no details", () => {
    expect(listed(stone)).toEqual({ name: "stone", label: "Stone", count: 5, details: {} });
  });

  test("shows the name a stack was given", () => {
    const key = { ...stone, customName: '{"text":"Gate Key","color":"gold"}' };

    expect(listed(key)).toEqual({ name: "stone", label: "Gate Key", count: 5, details: {} });
  });

  test("joins a given name that comes in parts", () => {
    const key = { ...stone, customName: '[{"text":"Gate ","bold":true},{"text":"Key"}]' };

    expect(listed(key).label).toBe("Gate Key");
  });

  test("lists lore line by line", () => {
    const one = { ...stone, customLore: '{"text":"Opens the gate"}' };
    const two = { ...stone, customLore: ['{"text":"Opens the gate"}', '{"text":"Keep it"}'] };

    expect(listed(one).details).toEqual({ lore: ["Opens the gate"] });
    expect(listed(two).details).toEqual({ lore: ["Opens the gate", "Keep it"] });
  });

  test("lists enchantments with their levels", () => {
    const sword = {
      ...stone,
      name: "diamond_sword",
      displayName: "Diamond Sword",
      count: 1,
      enchants: [
        { name: "sharpness", lvl: 5 },
        { name: "unbreaking", lvl: 3 },
      ],
      nbt: compound({
        Enchantments: {
          type: "list",
          value: {
            type: "compound",
            value: [{ id: text("minecraft:sharpness"), lvl: { type: "short", value: 5 } }],
          },
        },
      }),
    };

    expect(listed(sword).details).toEqual({
      enchantments: [
        { name: "sharpness", level: 5 },
        { name: "unbreaking", level: 3 },
      ],
    });
  });

  test("keeps the rest of what a stack holds as data, such as the kind of a potion", () => {
    const potion = {
      ...stone,
      name: "potion",
      displayName: "Potion",
      count: 1,
      nbt: compound({ Potion: text("minecraft:strong_healing") }),
    };

    expect(listed(potion).details).toEqual({ data: { Potion: "minecraft:strong_healing" } });
  });

  test("keeps lists and nested data", () => {
    const box = {
      ...stone,
      nbt: compound({
        BlockEntityTag: compound({
          Items: {
            type: "list",
            value: {
              type: "compound",
              value: [{ id: text("minecraft:diamond"), Count: { type: "byte", value: 3 } }],
            },
          },
        }),
      }),
    };

    expect(listed(box).details).toEqual({
      data: { BlockEntityTag: { Items: [{ Count: 3, id: "minecraft:diamond" }] } },
    });
  });

  test("leaves the wear of a tool out, so that a used tool has no details", () => {
    const pickaxe = { ...stone, nbt: compound({ Damage: whole(100), RepairCost: whole(1) }) };

    expect(listed(pickaxe).details).toEqual({});
  });

  test("keeps what a stack shows besides its name and lore, such as a dye", () => {
    const cap = {
      ...stone,
      customName: '{"text":"Red Cap"}',
      nbt: compound({
        display: compound({ Name: text('{"text":"Red Cap"}'), color: whole(11_546_150) }),
      }),
    };

    expect(listed(cap).details).toEqual({ data: { display: { color: 11_546_150 } } });
  });

  test("cuts a long name, long lore and long text in the data", () => {
    const long = "x".repeat(500);
    const book = {
      ...stone,
      customName: JSON.stringify({ text: long }),
      customLore: [JSON.stringify({ text: long })],
      nbt: compound({ pages: { type: "list", value: { type: "string", value: [long] } } }),
    };
    const { label, details } = listed(book);

    expect(label).toBe(`${"x".repeat(100)} (400 more characters)`);
    expect(details.lore).toEqual([`${"x".repeat(200)} (300 more characters)`]);
    expect(details.data).toEqual({ pages: [`${"x".repeat(200)} (300 more characters)`] });
  });
});

describe("list", () => {
  const plain = { name: "stone", label: "Stone", count: 5, details: {} };
  const key = { name: "stone", label: "Gate Key", count: 3, details: {} };

  test("adds up stacks that are the same in every way", () => {
    expect(list([plain, { ...plain, count: 64 }])).toEqual([{ ...plain, count: 69 }]);
  });

  test("keeps stacks apart that differ in the name they were given", () => {
    expect(list([key, plain, { ...key, count: 2 }])).toEqual([{ ...key, count: 5 }, plain]);
  });

  test("keeps stacks apart that differ in their details", () => {
    const sharp = {
      name: "diamond_sword",
      label: "Diamond Sword",
      count: 1,
      details: { enchantments: [{ name: "sharpness", level: 5 }] },
    };
    const blunt = { ...sharp, details: {} };

    expect(list([sharp, blunt, sharp])).toEqual([blunt, { ...sharp, count: 2 }]);
  });

  test("orders by item and then by label", () => {
    const log = { name: "oak_log", label: "Oak Log", count: 1, details: {} };

    expect(list([plain, log, key])).toEqual([log, key, plain]);
  });

  test("is empty for an empty inventory", () => {
    expect(list([])).toEqual([]);
  });
});

describe("gained", () => {
  const log = { name: "oak_log", label: "Oak Log", count: 2, details: {} };
  const stick = { name: "stick", label: "Stick", count: 4, details: {} };

  test("lists what the later stacks hold beyond the earlier ones", () => {
    const cobblestone = { name: "cobblestone", label: "Cobblestone", count: 1, details: {} };
    const more = gained([log, stick], [cobblestone, { ...log, count: 5 }, { ...stick, count: 3 }]);

    expect(more).toEqual([cobblestone, { ...log, count: 3 }]);
  });

  test("counts a stack with a name of its own apart from the plain ones", () => {
    const wand = { ...stick, label: "Wand", count: 1 };

    expect(gained([stick], [stick, wand])).toEqual([wand]);
  });
});

describe("countByName", () => {
  test("adds up the stacks of each item, ordered by name", () => {
    const counts = countByName([
      { name: "oak_log", count: 64 },
      { name: "cobblestone", count: 3 },
      { name: "oak_log", count: 5 },
    ]);

    expect(counts).toEqual([
      { name: "cobblestone", count: 3 },
      { name: "oak_log", count: 69 },
    ]);
  });

  test("is empty for an empty inventory", () => {
    expect(countByName([])).toEqual([]);
  });
});
