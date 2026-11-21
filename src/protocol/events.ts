import type { JsonObject } from "type-fest";

export interface EventOccurrence {
  kind: string;
  occurredAt: Date;
  payload: JsonObject;
}
