import { describe, expect, test } from "bun:test";

import { Cursors } from "./cursors.ts";

describe("Cursors", () => {
  test("gives back the positions a cursor stands for", () => {
    const cursors = new Cursors(4);

    const cursor = cursors.issue({ "chat.message": 4 });

    expect(cursors.find(cursor)).toEqual({ "chat.message": 4 });
  });

  test("issues a short token", () => {
    const cursors = new Cursors(4);

    expect(cursors.issue({ "chat.message": 4 })).toMatch(/^[\da-f]{8}$/);
  });

  test("issues the same cursor again for the same positions", () => {
    const cursors = new Cursors(4);
    const cursor = cursors.issue({ "chat.message": 4, "body.damage": 1 });

    expect(cursors.issue({ "body.damage": 1, "chat.message": 4 }, cursor)).toBe(cursor);
    expect(cursors.issue({ "body.damage": 2, "chat.message": 4 }, cursor)).not.toBe(cursor);
  });

  test("does not know a cursor it never issued", () => {
    const cursors = new Cursors(4);

    expect(cursors.find("made-up")).toBeUndefined();
  });

  test("forgets the oldest cursors beyond its capacity", () => {
    const cursors = new Cursors(2);
    const first = cursors.issue({ "chat.message": 1 });
    const second = cursors.issue({ "chat.message": 2 });
    const third = cursors.issue({ "chat.message": 3 });

    expect(cursors.find(first)).toBeUndefined();
    expect(cursors.find(second)).toEqual({ "chat.message": 2 });
    expect(cursors.find(third)).toEqual({ "chat.message": 3 });
  });
});
