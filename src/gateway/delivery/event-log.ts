import type { EventOccurrence } from "../../protocol/events.ts";

import { log } from "../../log.ts";

export interface RecordedEvent extends EventOccurrence {
  // Counts up within the event's kind.
  seq: number;
  // Counts up across all kinds, in order of arrival.
  order: number;
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

// Keeps the latest events of each kind, so a chatty kind cannot push out a rare one.
export class EventLog {
  // Sequence numbers restart with the process. A position that carries the epoch can be told
  // apart from one issued by an earlier run.
  readonly epoch = crypto.randomUUID().slice(0, 8);

  readonly #capacity: number;
  readonly #kinds = new Map<string, KindRecord>();
  readonly #listeners = new Set<(event: RecordedEvent) => void>();
  #appended = 0;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  append(event: EventOccurrence): RecordedEvent {
    let record = this.#kinds.get(event.kind);
    if (record === undefined) {
      record = { events: [], head: 0 };
      this.#kinds.set(event.kind, record);
    }
    record.head += 1;
    this.#appended += 1;
    const recorded = { ...event, seq: record.head, order: this.#appended };
    record.events.push(recorded);
    if (record.events.length > this.#capacity) {
      record.events.shift();
    }
    for (const listener of this.#listeners) {
      try {
        listener(recorded);
      } catch (error) {
        // A failing listener must not cost the record or the other listeners.
        log("error", "event-log", "a listener failed", {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return recorded;
  }

  // Returns the function that removes the listener.
  subscribe(listener: (event: RecordedEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
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
