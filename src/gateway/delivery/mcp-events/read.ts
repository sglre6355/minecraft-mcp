import type { JsonObject } from "type-fest";

import type { EventFilterDescriptor } from "../../../protocol/descriptors.ts";
import type { EventLog, RecordedEvent } from "../event-log.ts";

import { matches } from "../filter.ts";

export interface Subscription {
  kind: string;
  filters: ReadonlyArray<EventFilterDescriptor>;
  arguments: JsonObject;
}

// A cursor is a position within one kind. The client must be able to hand it to any later
// request, so it carries everything needed to read it.
export function encodeCursor(epoch: string, seq: number): string {
  return `${epoch}.${seq}`;
}

export function decodeCursor(cursor: string): { epoch: string; seq: number } | undefined {
  const [, epoch, seq] = /^([\da-z]+)\.(\d+)$/.exec(cursor) ?? [];
  return epoch === undefined || seq === undefined ? undefined : { epoch, seq: Number(seq) };
}

export interface Start {
  // Delivery begins with the event after this sequence number.
  after: number;
  // Delivery begins later than the cursor asked for, so events were skipped.
  truncated: boolean;
}

// Decides where delivery begins for the cursor a client supplied.
export function locate(
  log: EventLog,
  kind: string,
  cursor: string | null | undefined,
  maxAgeMs: number | undefined,
  now: number,
): Start {
  if (cursor === null || cursor === undefined) {
    return { after: log.head(kind), truncated: false };
  }
  const position = decodeCursor(cursor);
  if (position === undefined || position.epoch !== log.epoch) {
    return { after: log.head(kind), truncated: true };
  }
  const unread = log.read(kind, position.seq);
  const oldest = unread.events[0];
  const start: Start = unread.truncated
    ? { after: oldest === undefined ? log.head(kind) : oldest.seq - 1, truncated: true }
    : { after: position.seq, truncated: false };

  if (maxAgeMs !== undefined) {
    const floor = now - maxAgeMs;
    for (const event of unread.events) {
      if (event.occurredAt.getTime() >= floor) {
        break;
      }
      start.after = event.seq;
      start.truncated = true;
    }
  }
  return start;
}

export interface Page {
  events: Array<RecordedEvent>;
  // The sequence number read up to, including events the arguments excluded.
  after: number;
  hasMore: boolean;
}

// Reads the events of a subscription after a position, up to a limit.
export function page(
  log: EventLog,
  subscription: Subscription,
  after: number,
  limit: number,
): Page {
  const result: Page = { events: [], after, hasMore: false };
  for (const event of log.read(subscription.kind, after).events) {
    const wanted = matches(subscription.filters, subscription.arguments, event.payload);
    if (result.events.length === limit) {
      result.hasMore ||= wanted;
      continue;
    }
    result.after = event.seq;
    if (wanted) {
      result.events.push(event);
    }
  }
  return result;
}
