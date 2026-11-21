import type { z } from "zod";

export type JsonSchema = z.core.JSONSchema.JSONSchema;

export interface ToolDescriptor {
  kind: "action" | "query";
  name: string;
  description: string;
  inputSchema: JsonSchema;
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
}
