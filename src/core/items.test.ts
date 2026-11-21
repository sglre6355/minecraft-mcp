import { describe, expect, test } from "bun:test";

import { countByName, gained } from "./items.ts";

describe("gained", () => {
  test("lists what the later counts hold beyond the earlier ones", () => {
    const more = gained(
      [
        { name: "oak_log", count: 2 },
        { name: "stick", count: 4 },
      ],
      [
        { name: "cobblestone", count: 1 },
        { name: "oak_log", count: 5 },
        { name: "stick", count: 3 },
      ],
    );

    expect(more).toEqual([
      { name: "cobblestone", count: 1 },
      { name: "oak_log", count: 3 },
    ]);
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
