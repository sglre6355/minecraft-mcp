import type { JsonObject } from "type-fest";

import type { EventFilterDescriptor } from "../../../protocol/descriptors.ts";
import type { EventLog, RecordedEvent } from "../event-log.ts";

import { matches } from "../filter.ts";

export interface Subscription {
  kind: string;
  filters: ReadonlyArray<EventFilterDescriptor>;
  arguments: JsonObject;
}

export interface Batch {
  events: Array<RecordedEvent>;
  // The sequence number read up to, per kind. Passing it back continues from there.
  positions: Record<string, number>;
  // Events after a given position were dropped before they could be read.
  truncated: boolean;
  // Matching events remain beyond the limit.
  hasMore: boolean;
}

// Reads the subscribed kinds as one stream in order of arrival.
// Without positions it starts from the oldest events on record.
export function collect(
  log: EventLog,
  subscriptions: ReadonlyArray<Subscription>,
  positions: Readonly<Record<string, number>> | undefined,
  limit: number,
): Batch {
  const batch: Batch = { events: [], positions: {}, truncated: false, hasMore: false };
  const unread: Array<{ event: RecordedEvent; wanted: boolean }> = [];

  for (const subscription of subscriptions) {
    const known = positions?.[subscription.kind];
    const page = log.read(subscription.kind, known ?? 0);
    const oldest = page.events[0];
    // Skips what was dropped, so the same gap is reported once.
    batch.positions[subscription.kind] = oldest === undefined ? page.cursor : oldest.seq - 1;
    batch.truncated ||= known !== undefined && page.truncated;
    for (const event of page.events) {
      const wanted = matches(subscription.filters, subscription.arguments, event.payload);
      unread.push({ event, wanted });
    }
  }

  unread.sort((a, b) => a.event.order - b.event.order);
  for (const { event, wanted } of unread) {
    if (batch.events.length === limit) {
      batch.hasMore ||= wanted;
      continue;
    }
    batch.positions[event.kind] = event.seq;
    if (wanted) {
      batch.events.push(event);
    }
  }
  return batch;
}

// Resolves when an event of one of the kinds arrives, the time is up, or the signal aborts.
export function nextEvent(
  log: EventLog,
  kinds: ReadonlySet<string>,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  const end = () => {
    resolve();
  };
  const leave = log.subscribe((event) => {
    if (kinds.has(event.kind)) {
      end();
    }
  });
  const timer = setTimeout(end, ms);
  signal.addEventListener("abort", end, { once: true });
  return promise.finally(() => {
    leave();
    clearTimeout(timer);
    signal.removeEventListener("abort", end);
  });
}
