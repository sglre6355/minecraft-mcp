import { describe, expect, test } from "bun:test";

import { isSign, signText } from "./read-sign.ts";

describe("isSign", () => {
  test("holds for standing, wall and hanging signs of any wood", () => {
    expect(isSign("oak_sign")).toBe(true);
    expect(isSign("birch_wall_sign")).toBe(true);
    expect(isSign("cherry_hanging_sign")).toBe(true);
  });

  test("fails for other blocks", () => {
    expect(isSign("oak_planks")).toBe(false);
    expect(isSign("chest")).toBe(false);
  });
});

describe("signText", () => {
  test("has only a front on a sign with one side", () => {
    expect(signText(["Hello\nworld"])).toEqual({ front: "Hello\nworld" });
  });

  test("has both sides of a sign with two", () => {
    expect(signText(["in", "out"])).toEqual({ front: "in", back: "out" });
  });

  test("cuts a side that is far longer than a sign shows", () => {
    const text = signText(["x".repeat(1000), "y".repeat(1000)]);

    expect(text.front).toHaveLength(256);
    expect(text.back).toHaveLength(256);
  });
});
