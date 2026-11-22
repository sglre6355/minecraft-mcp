import { describe, expect, test } from "bun:test";

import { isContainer } from "./chest.ts";

describe("isContainer", () => {
  test("holds for chests and barrels", () => {
    expect(isContainer("chest")).toBe(true);
    expect(isContainer("trapped_chest")).toBe(true);
    expect(isContainer("barrel")).toBe(true);
  });

  test("holds for dispensers, droppers and hoppers", () => {
    expect(isContainer("dispenser")).toBe(true);
    expect(isContainer("dropper")).toBe(true);
    expect(isContainer("hopper")).toBe(true);
  });

  test("holds for shulker boxes of any color", () => {
    expect(isContainer("shulker_box")).toBe(true);
    expect(isContainer("light_blue_shulker_box")).toBe(true);
  });

  test("fails for a furnace, which has its own actions", () => {
    expect(isContainer("furnace")).toBe(false);
  });

  test("fails for an ender chest, which holds something else for each player", () => {
    expect(isContainer("ender_chest")).toBe(false);
  });
});
