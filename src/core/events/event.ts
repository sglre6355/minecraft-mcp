import type { Bot } from "mineflayer";
import type { JsonObject } from "type-fest";

import { z } from "zod";

import type { EventFilterDescriptor, EventKindDescriptor } from "../../protocol/descriptors.ts";

export interface EventKindDefinition<Payload extends JsonObject> {
  kind: string;
  description: string;
  payload: z.ZodType<Payload>;
  // Arguments a subscription may pass, and how each one narrows the events delivered.
  params?: z.ZodType;
  filters?: Array<EventFilterDescriptor>;
  // Set for a kind so frequent that it would drown the others. It then reaches only a
  // subscription that names it.
  optIn?: boolean;
}

export function defineEventKind<Payload extends JsonObject>(
  definition: EventKindDefinition<Payload>,
): EventKindDefinition<Payload> {
  return definition;
}

export type Emit = <Payload extends JsonObject>(
  kind: EventKindDefinition<Payload>,
  payload: Payload,
) => void;

export interface EventSourceContext {
  bot: Bot;
  emit: Emit;
}

export interface EventSourceDefinition {
  name: string;
  kinds: Array<EventKindDefinition<JsonObject>>;
  // Runs once per connection. The returned function detaches listeners and timers.
  start(context: EventSourceContext): () => void;
}

export function describeEventKind(
  definition: EventKindDefinition<JsonObject>,
): EventKindDescriptor {
  return {
    kind: definition.kind,
    description: definition.description,
    payloadSchema: z.toJSONSchema(definition.payload),
    paramsSchema: z.toJSONSchema(definition.params ?? z.object({}), { io: "input" }),
    filters: definition.filters ?? [],
    optIn: definition.optIn ?? false,
  };
}
