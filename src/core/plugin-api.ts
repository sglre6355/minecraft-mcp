import type { JsonValue } from "type-fest";

import type { ActionDefinition } from "./actions/action.ts";
import type { EventSourceDefinition } from "./events/event.ts";
import type { QueryDefinition } from "./queries/query.ts";
import type { Reflex } from "./reflexes/reflex.ts";

export { defineAction } from "./actions/action.ts";
export type { ActionContext, ActionDefinition } from "./actions/action.ts";
export { defineQuery } from "./queries/query.ts";
export type { QueryContext, QueryDefinition } from "./queries/query.ts";
export type { Policy, Reflex, ReflexContext } from "./reflexes/reflex.ts";
export { defineEventKind } from "./events/event.ts";
export type {
  Emit,
  EventKindDefinition,
  EventSourceContext,
  EventSourceDefinition,
} from "./events/event.ts";

export interface Plugin {
  name: string;
  actions?: Array<ActionDefinition<unknown, JsonValue>>;
  queries?: Array<QueryDefinition<unknown, JsonValue>>;
  reflexes?: Array<Reflex<unknown, string>>;
  eventSources?: Array<EventSourceDefinition>;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
