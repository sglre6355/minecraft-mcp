import { describe, expect, test } from "bun:test";

import { isTrusted } from "./chat.ts";

describe("isTrusted", () => {
  test("marks a sender on the list", () => {
    expect(isTrusted("alex", ["steve", "alex"])).toBe(true);
  });

  test("does not mark a sender who is not on the list", () => {
    expect(isTrusted("herobrine", ["steve", "alex"])).toBe(false);
    expect(isTrusted("alex", [])).toBe(false);
  });

  test("ignores letter case, as Minecraft does for usernames", () => {
    expect(isTrusted("Alex", ["alex"])).toBe(true);
  });

  test("does not mark a name that only contains a listed one", () => {
    expect(isTrusted("alex2", ["alex"])).toBe(false);
  });
});
