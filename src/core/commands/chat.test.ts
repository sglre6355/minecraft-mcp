import { describe, expect, test } from "bun:test";

import { chatInput, isServerCommand } from "./chat.ts";

function accepts(input: unknown): boolean {
  return chatInput.safeParse(input).success;
}

describe("chatInput", () => {
  test("accepts a line of text, with or without a player to whisper to", () => {
    expect(accepts({ message: "hello there" })).toBe(true);
    expect(accepts({ message: "こんにちは", to: "Steve_01" })).toBe(true);
  });

  test("rejects a line break, which would send the rest as a message of its own", () => {
    expect(accepts({ message: "hi\n/time set night" })).toBe(false);
    expect(accepts({ message: "hi\r/time set night" })).toBe(false);
  });

  test("rejects the characters a server kicks for", () => {
    expect(accepts({ message: "a\tb" })).toBe(false);
    expect(accepts({ message: "§4red" })).toBe(false);
    expect(accepts({ message: "a\u007Fb" })).toBe(false);
  });

  test("rejects an empty message and one that is too long", () => {
    expect(accepts({ message: "" })).toBe(false);
    expect(accepts({ message: "x".repeat(257) })).toBe(false);
  });

  test("rejects a whisper target that is not a player's name", () => {
    expect(accepts({ message: "hi", to: "Steve /op me" })).toBe(false);
    expect(accepts({ message: "hi", to: "" })).toBe(false);
  });
});

describe("isServerCommand", () => {
  test("is true for a message that starts with a slash", () => {
    expect(isServerCommand("/time set night")).toBe(true);
  });

  test("is false for a slash further in", () => {
    expect(isServerCommand("type /help for help")).toBe(false);
  });
});
