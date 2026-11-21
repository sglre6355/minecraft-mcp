import { describe, expect, test } from "bun:test";

import type { RecordedEvent } from "../event-log.ts";
import type { Subscription } from "./read.ts";

import { EventLog } from "../event-log.ts";
import { decodeCursor, encodeCursor, locate, page } from "./read.ts";

const now = 1_000_000;

function damage(amount: number, ageMs = 0) {
  return { kind: "body.damage", occurredAt: new Date(now - ageMs), payload: { amount } };
}

const all: Subscription = { kind: "body.damage", filters: [], arguments: {} };
const heavy: Subscription = {
  kind: "body.damage",
  filters: [{ param: "minAmount", field: "amount", op: "gte" }],
  arguments: { minAmount: 4 },
};

function amounts(events: Array<RecordedEvent>) {
  return events.map((event) => event.payload["amount"]);
}

describe("cursor", () => {
  test("carries the epoch and the sequence number", () => {
    expect(decodeCursor(encodeCursor("4bae62a1", 12))).toEqual({ epoch: "4bae62a1", seq: 12 });
  });

  test("is not decoded from other text", () => {
    expect(decodeCursor("historyId_99842")).toBeUndefined();
    expect(decodeCursor("4bae62a1.-3")).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
  });
});

describe("locate", () => {
  test("starts from now when the client has no cursor", () => {
    const log = new EventLog(8);
    log.append(damage(1));
    log.append(damage(2));

    expect(locate(log, "body.damage", null, undefined, now)).toEqual({
      after: 2,
      truncated: false,
    });
    expect(locate(log, "body.damage", undefined, undefined, now)).toEqual({
      after: 2,
      truncated: false,
    });
  });

  test("continues after the position the cursor names", () => {
    const log = new EventLog(8);
    log.append(damage(1));
    log.append(damage(2));

    const start = locate(log, "body.damage", encodeCursor(log.epoch, 1), undefined, now);

    expect(start).toEqual({ after: 1, truncated: false });
  });

  test("resets to now, truncated, for a cursor from another run", () => {
    const log = new EventLog(8);
    log.append(damage(1));

    const start = locate(log, "body.damage", encodeCursor("0ld0ld0l", 1), undefined, now);

    expect(start).toEqual({ after: 1, truncated: true });
  });

  test("resets to now, truncated, for a cursor it cannot read", () => {
    const log = new EventLog(8);
    log.append(damage(1));

    expect(locate(log, "body.damage", "made-up", undefined, now)).toEqual({
      after: 1,
      truncated: true,
    });
  });

  test("moves to the oldest event on record when the cursor fell off it", () => {
    const log = new EventLog(2);
    log.append(damage(1));
    log.append(damage(2));
    log.append(damage(3));
    log.append(damage(4));

    const start = locate(log, "body.damage", encodeCursor(log.epoch, 1), undefined, now);

    expect(start).toEqual({ after: 2, truncated: true });
  });

  test("skips events older than the age limit and says so", () => {
    const log = new EventLog(8);
    log.append(damage(1, 9000));
    log.append(damage(2, 6000));
    log.append(damage(3, 1000));

    const start = locate(log, "body.damage", encodeCursor(log.epoch, 0), 5000, now);

    expect(start).toEqual({ after: 2, truncated: true });
  });

  test("is not truncated when the age limit excludes nothing after the cursor", () => {
    const log = new EventLog(8);
    log.append(damage(1, 9000));
    log.append(damage(2, 1000));

    const start = locate(log, "body.damage", encodeCursor(log.epoch, 1), 5000, now);

    expect(start).toEqual({ after: 1, truncated: false });
  });

  test("ignores the age limit when the client has no cursor", () => {
    const log = new EventLog(8);
    log.append(damage(1, 9000));

    expect(locate(log, "body.damage", null, 5000, now)).toEqual({ after: 1, truncated: false });
  });
});

describe("page", () => {
  test("returns the events after a position", () => {
    const log = new EventLog(8);
    log.append(damage(1));
    log.append(damage(2));
    log.append(damage(3));

    const result = page(log, all, 1, 10);

    expect(amounts(result.events)).toEqual([2, 3]);
    expect(result.after).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  test("stops at the limit and reports that more remain", () => {
    const log = new EventLog(8);
    log.append(damage(1));
    log.append(damage(2));
    log.append(damage(3));

    const result = page(log, all, 0, 2);

    expect(amounts(result.events)).toEqual([1, 2]);
    expect(result.after).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  test("moves past events the subscription's arguments exclude", () => {
    const log = new EventLog(8);
    log.append(damage(6));
    log.append(damage(1));
    log.append(damage(2));

    const result = page(log, heavy, 0, 10);

    expect(amounts(result.events)).toEqual([6]);
    expect(result.after).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  test("keeps the position when nothing is new", () => {
    const log = new EventLog(8);
    log.append(damage(1));

    expect(page(log, all, 1, 10)).toEqual({ events: [], after: 1, hasMore: false });
  });
});
