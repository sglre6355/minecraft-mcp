import { describe, expect, test } from "bun:test";

import { blockState } from "./block-at.ts";

describe("blockState", () => {
  test("turns a counted property into a number", () => {
    const state = blockState({ age: "7" }, [{ name: "age", type: "int" }]);

    expect(state).toEqual({ age: 7 });
  });

  test("keeps switches and named values as they are", () => {
    const state = blockState({ open: true, half: "top", facing: "north" }, [
      { name: "open", type: "bool" },
      { name: "half", type: "enum" },
      { name: "facing", type: "direction" },
    ]);

    expect(state).toEqual({ open: true, half: "top", facing: "north" });
  });

  test("is empty for a block without properties", () => {
    expect(blockState({}, [])).toEqual({});
  });
});
