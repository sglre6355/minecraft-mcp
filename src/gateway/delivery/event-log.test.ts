import { describe, expect, test } from "bun:test";

import type { RecordedEvent } from "./event-log.ts";

import { EventLog } from "./event-log.ts";

function chat(text: string) {
  return { kind: "chat.message", occurredAt: new Date(0), payload: { text } };
}

function texts(events: Array<RecordedEvent>) {
  return events.map((event) => event.payload["text"]);
}

describe("EventLog", () => {
  test("numbers events from 1 within each kind", () => {
    const log = new EventLog(8);

    const first = log.append(chat("a"));
    const other = log.append({ kind: "body.damage", occurredAt: new Date(0), payload: {} });
    const second = log.append(chat("b"));

    expect(first.seq).toBe(1);
    expect(other.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  test("reads the events after a cursor", () => {
    const log = new EventLog(8);
    log.append(chat("a"));
    log.append(chat("b"));
    log.append(chat("c"));

    const page = log.read("chat.message", 1);

    expect(texts(page.events)).toEqual(["b", "c"]);
    expect(page.cursor).toBe(3);
    expect(page.truncated).toBe(false);
  });

  test("returns the same cursor when nothing is new", () => {
    const log = new EventLog(8);
    log.append(chat("a"));

    const page = log.read("chat.message", 1);

    expect(page.events).toEqual([]);
    expect(page.cursor).toBe(1);
    expect(page.truncated).toBe(false);
  });

  test("reads an unknown kind as empty", () => {
    const log = new EventLog(8);

    expect(log.read("chat.message", 0)).toEqual({ events: [], cursor: 0, truncated: false });
  });

  test("stops at the limit and continues from the returned cursor", () => {
    const log = new EventLog(8);
    log.append(chat("a"));
    log.append(chat("b"));
    log.append(chat("c"));

    const first = log.read("chat.message", 0, 2);
    const rest = log.read("chat.message", first.cursor, 2);

    expect(texts(first.events)).toEqual(["a", "b"]);
    expect(texts(rest.events)).toEqual(["c"]);
  });

  test("drops the oldest events beyond the capacity", () => {
    const log = new EventLog(2);
    log.append(chat("a"));
    log.append(chat("b"));
    log.append(chat("c"));

    const page = log.read("chat.message", 0);

    expect(texts(page.events)).toEqual(["b", "c"]);
  });

  test("reports truncation when the cursor points at dropped events", () => {
    const log = new EventLog(2);
    log.append(chat("a"));
    log.append(chat("b"));
    log.append(chat("c"));
    log.append(chat("d"));

    const page = log.read("chat.message", 1);

    expect(texts(page.events)).toEqual(["c", "d"]);
    expect(page.cursor).toBe(4);
    expect(page.truncated).toBe(true);
  });

  test("reports truncation when the cursor is ahead of the log", () => {
    const log = new EventLog(8);
    log.append(chat("a"));

    const page = log.read("chat.message", 5);

    expect(texts(page.events)).toEqual(["a"]);
    expect(page.cursor).toBe(1);
    expect(page.truncated).toBe(true);
  });

  test("gives the latest sequence number as the head", () => {
    const log = new EventLog(8);

    expect(log.head("chat.message")).toBe(0);
    log.append(chat("a"));
    log.append(chat("b"));
    expect(log.head("chat.message")).toBe(2);
  });

  test("numbers events across kinds in the order they arrived", () => {
    const log = new EventLog(8);

    const first = log.append(chat("a"));
    const second = log.append({ kind: "body.damage", occurredAt: new Date(0), payload: {} });
    const third = log.append(chat("b"));

    expect([first.order, second.order, third.order]).toEqual([1, 2, 3]);
  });

  test("tells listeners about each appended event until they leave", () => {
    const log = new EventLog(8);
    const heard: Array<string> = [];
    const leave = log.subscribe((event) => heard.push(event.kind));

    log.append(chat("a"));
    leave();
    log.append(chat("b"));

    expect(heard).toEqual(["chat.message"]);
    expect(log.listenerCount).toBe(0);
  });
});
