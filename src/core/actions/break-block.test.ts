import { describe, expect, test } from "bun:test";

import { breakable } from "./break-block.ts";

describe("breakable", () => {
  test("holds for an ordinary block", () => {
    expect(breakable({ name: "stone", diggable: true })).toBe(true);
  });

  test("holds for a block that stands in nobody's way, such as a torch or a sign", () => {
    expect(breakable({ name: "torch", diggable: true })).toBe(true);
    expect(breakable({ name: "oak_sign", diggable: true })).toBe(true);
  });

  test("fails for a block the game lets nobody break", () => {
    expect(breakable({ name: "bedrock", diggable: false })).toBe(false);
    expect(breakable({ name: "air", diggable: false })).toBe(false);
  });

  test("fails for a liquid", () => {
    expect(breakable({ name: "water", diggable: true })).toBe(false);
    expect(breakable({ name: "lava", diggable: true })).toBe(false);
  });
});
