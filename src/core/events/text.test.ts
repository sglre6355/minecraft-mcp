import { describe, expect, test } from "bun:test";

import { clip, plain } from "./text.ts";

describe("plain", () => {
  test("keeps a bare string", () => {
    expect(plain("Welcome")).toBe("Welcome");
  });

  test("reads the text of a component that comes as JSON", () => {
    expect(plain('{"text":"Welcome","color":"red"}')).toBe("Welcome");
    expect(plain('"Welcome"')).toBe("Welcome");
  });

  test("joins the parts of a component", () => {
    const title = { text: "", extra: [{ text: "Good ", bold: true }, { text: "morning" }, "!"] };

    expect(plain(title)).toBe("Good morning!");
    expect(plain(JSON.stringify(title))).toBe("Good morning!");
  });

  test("goes into parts of parts", () => {
    expect(plain({ text: "a", extra: [{ text: "b", extra: [{ text: "c" }] }] })).toBe("abc");
  });

  test("joins a list of components", () => {
    expect(plain([{ text: "red " }, { text: "and plain" }])).toBe("red and plain");
  });

  test("gives the key of a text that the game would translate, with what goes into it", () => {
    expect(plain({ translate: "sleep.not_possible" })).toBe("sleep.not_possible");
    expect(plain({ translate: "chat.type.text", with: [{ text: "alex" }, "hi"] })).toBe(
      "chat.type.text alex hi",
    );
  });

  test("keeps text that is no JSON as it is", () => {
    expect(plain("{not json")).toBe("{not json");
  });

  test("is empty for what holds no text", () => {
    expect(plain({ color: "red" })).toBe("");
    expect(plain(null)).toBe("");
  });
});

describe("clip", () => {
  test("keeps a short text", () => {
    expect(clip("hello", 10)).toBe("hello");
  });

  test("cuts a long text and says how much is missing", () => {
    expect(clip("abcdefghij", 4)).toBe("abcd (6 more characters)");
  });
});
