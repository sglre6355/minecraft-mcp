import type { EventOccurrence } from "../../protocol/events.ts";

export interface RecordedEvent extends EventOccurrence {
  seq: number;
}

export interface EventPage {
  events: Array<RecordedEvent>;
  // Sequence number of the last event read. Passing it back continues from there.
  cursor: number;
  // Events between the given cursor and the first returned event are gone.
  truncated: boolean;
}

interface KindRecord {
  events: Array<RecordedEvent>;
  head: number;
}

export class EventLog {
  readonly #capacity: number;
  readonly #kinds = new Map<string, KindRecord>();

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  append(event: EventOccurrence): RecordedEvent {
    let record = this.#kinds.get(event.kind);
    if (record === undefined) {
      record = { events: [], head: 0 };
      this.#kinds.set(event.kind, record);
    }
    record.head += 1;
    const recorded = { ...event, seq: record.head };
    record.events.push(recorded);
    if (record.events.length > this.#capacity) {
      record.events.shift();
    }
    return recorded;
  }

  head(kind: string): number {
    return this.#kinds.get(kind)?.head ?? 0;
  }

  read(kind: string, after: number, limit = Infinity): EventPage {
    const record = this.#kinds.get(kind) ?? { events: [], head: 0 };
    const oldest = record.head - record.events.length + 1;
    const truncated = after > record.head || after + 1 < oldest;
    const start = truncated ? 0 : after + 1 - oldest;
    const events = record.events.slice(start, start + limit);
    const cursor = events.at(-1)?.seq ?? (truncated ? record.head : after);
    return { events, cursor, truncated };
  }
}
