import { describe, expect, test } from "bun:test";

import { weather } from "./status.ts";

describe("weather", () => {
  test("is clear when it does not rain", () => {
    expect(weather(false, 0)).toBe("clear");
  });

  test("is rain without thunder", () => {
    expect(weather(true, 0)).toBe("rain");
  });

  test("is thunder when the rain comes with thunder", () => {
    expect(weather(true, 1)).toBe("thunder");
    expect(weather(true, 0.4)).toBe("thunder");
  });

  test("is clear when thunder is left over after the rain has stopped", () => {
    expect(weather(false, 1)).toBe("clear");
  });
});
