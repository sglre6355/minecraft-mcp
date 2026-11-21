import { describe, expect, test } from "bun:test";

import type { RecordedEvent } from "../event-log.ts";
import type { Subscription } from "./poll.ts";

import { EventLog } from "../event-log.ts";
import { collect, nextEvent } from "./poll.ts";

function chat(text: string) {
  return { kind: "chat.message", occurredAt: new Date(0), payload: { text } };
}

function damage(amount: number) {
  return { kind: "body.damage", occurredAt: new Date(0), payload: { amount } };
}

const chats: Subscription = { kind: "chat.message", filters: [], arguments: {} };
const damages: Subscription = { kind: "body.damage", filters: [], arguments: {} };
const heavyDamages: Subscription = {
  kind: "body.damage",
  filters: [{ param: "minAmount", field: "amount", op: "gte" }],
  arguments: { minAmount: 4 },
};

function payloads(events: Array<RecordedEvent>) {
  return events.map((event) => event.payload);
}

describe("collect", () => {
  test("merges the kinds in the order the events arrived", () => {
    const log = new EventLog(8);
    log.append(chat("a"));
    log.append(damage(1));
    log.append(chat("b"));

    const batch = collect(log, [damages, chats], undefined, 10);

    expect(payloads(batch.events)).toEqual([{ text: "a" }, { amount: 1 }, { text: "b" }]);
    expect(batch.positions).toEqual({ "chat.message": 2, "body.damage": 1 });
    expect(batch.hasMore).toBe(false);
  });

  test("reads what is on record on the first call, without calling it truncated", () => {
    const log = new EventLog(2);
    log.append(chat("a"));
    log.append(chat("b"));
    log.append(chat("c"));

    const batch = collect(log, [chats], undefined, 10);

    expect(payloads(batch.events)).toEqual([{ text: "b" }, { text: "c" }]);
    expect(batch.truncated).toBe(false);
  });

  test("returns only what is new after the given positions", () => {
    const log = new EventLog(8);
    log.append(chat("a"));
    const first = collect(log, [chats], undefined, 10);
    log.append(chat("b"));

    const second = collect(log, [chats], first.positions, 10);

    expect(payloads(second.events)).toEqual([{ text: "b" }]);
  });

  test("keeps the positions when nothing is new", () => {
    const log = new EventLog(8);
    log.append(chat("a"));
    const first = collect(log, [chats, damages], undefined, 10);

    const second = collect(log, [chats, damages], first.positions, 10);

    expect(second.events).toEqual([]);
    expect(second.positions).toEqual({ "chat.message": 1, "body.damage": 0 });
  });

  test("stops at the limit and continues from there on the next call", () => {
    const log = new EventLog(8);
    log.append(chat("a"));
    log.append(damage(1));
    log.append(chat("b"));

    const first = collect(log, [chats, damages], undefined, 2);
    const rest = collect(log, [chats, damages], first.positions, 2);

    expect(payloads(first.events)).toEqual([{ text: "a" }, { amount: 1 }]);
    expect(first.hasMore).toBe(true);
    expect(payloads(rest.events)).toEqual([{ text: "b" }]);
    expect(rest.hasMore).toBe(false);
  });

  test("leaves out events that the subscription's arguments exclude", () => {
    const log = new EventLog(8);
    log.append(damage(1));
    log.append(damage(6));
    log.append(damage(2));

    const batch = collect(log, [heavyDamages], undefined, 10);

    expect(payloads(batch.events)).toEqual([{ amount: 6 }]);
    expect(batch.positions).toEqual({ "body.damage": 3 });
    expect(batch.hasMore).toBe(false);
  });

  test("does not report more when only excluded events remain past the limit", () => {
    const log = new EventLog(8);
    log.append(damage(6));
    log.append(damage(1));

    const batch = collect(log, [heavyDamages], undefined, 1);

    expect(payloads(batch.events)).toEqual([{ amount: 6 }]);
    expect(batch.hasMore).toBe(false);
  });

  test("reports truncation when a position it was given has fallen off the record", () => {
    const log = new EventLog(2);
    log.append(chat("a"));
    const first = collect(log, [chats], undefined, 10);
    log.append(chat("b"));
    log.append(chat("c"));
    log.append(chat("d"));

    const second = collect(log, [chats], first.positions, 10);

    expect(payloads(second.events)).toEqual([{ text: "c" }, { text: "d" }]);
    expect(second.truncated).toBe(true);
  });

  test("starts a kind the positions do not mention from what is on record", () => {
    const log = new EventLog(8);
    log.append(damage(1));
    const first = collect(log, [chats], undefined, 10);

    const second = collect(log, [chats, damages], first.positions, 10);

    expect(payloads(second.events)).toEqual([{ amount: 1 }]);
    expect(second.truncated).toBe(false);
  });
});

describe("nextEvent", () => {
  const kinds = new Set(["chat.message"]);

  test("ends when an event of a wanted kind arrives", async () => {
    const log = new EventLog(8);
    const waiting = nextEvent(log, kinds, 5000, new AbortController().signal);

    log.append(damage(1));
    log.append(chat("a"));
    await waiting;

    expect(log.listenerCount).toBe(0);
  });

  test("ends when the time is up", async () => {
    const log = new EventLog(8);

    await nextEvent(log, kinds, 20, new AbortController().signal);

    expect(log.listenerCount).toBe(0);
  });

  test("ends when the request is abandoned", async () => {
    const log = new EventLog(8);
    const abandon = new AbortController();
    const waiting = nextEvent(log, kinds, 5000, abandon.signal);

    abandon.abort();
    await waiting;

    expect(log.listenerCount).toBe(0);
  });

  test("does not wait for a request that is already abandoned", async () => {
    const log = new EventLog(8);
    const abandon = new AbortController();
    abandon.abort();

    await nextEvent(log, kinds, 5000, abandon.signal);

    expect(log.listenerCount).toBe(0);
  });
});
