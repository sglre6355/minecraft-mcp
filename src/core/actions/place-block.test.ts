import { describe, expect, test } from "bun:test";

import { landing } from "./place-block.ts";

describe("landing", () => {
  test("is one block down for a fall of one block", () => {
    expect(landing("gravel", ["gravel", "stone"])).toBe(1);
  });

  test("counts the air the block fell through", () => {
    expect(landing("gravel", ["air", "air", "gravel", "stone"])).toBe(3);
  });

  test("finds the block on a floor of its own kind", () => {
    expect(landing("gravel", ["air", "gravel", "gravel"])).toBe(2);
  });

  test("follows a fall through water", () => {
    expect(landing("sand", ["water", "water", "sand", "dirt"])).toBe(3);
  });

  test("is missing when the block broke on what it hit", () => {
    expect(landing("gravel", ["air", "torch", "stone"])).toBeUndefined();
  });

  test("is missing when the block fell out of the world", () => {
    expect(landing("gravel", ["air", "air", "air"])).toBeUndefined();
    expect(landing("gravel", [])).toBeUndefined();
  });
});
