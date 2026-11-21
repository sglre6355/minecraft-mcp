import type { z } from "zod";

export type JsonSchema = z.core.JSONSchema.JSONSchema;

export interface ToolDescriptor {
  // A control tool manages running actions. It neither reads the world nor uses the body.
  kind: "action" | "query" | "control";
  name: string;
  description: string;
  inputSchema: JsonSchema;
  // What an action reports as progress while it runs.
  progressSchema?: JsonSchema;
}

export type FilterOperator = "eq" | "gte" | "lte" | "in";

// A filter passes when `payload[field] <op> params[param]` holds.
// A subscription that omits `param` skips the filter.
export interface EventFilterDescriptor {
  param: string;
  field: string;
  op: FilterOperator;
}

export interface EventKindDescriptor {
  kind: string;
  description: string;
  payloadSchema: JsonSchema;
  paramsSchema: JsonSchema;
  filters: Array<EventFilterDescriptor>;
  // An opt-in kind reaches only a subscription that names it.
  optIn: boolean;
}
