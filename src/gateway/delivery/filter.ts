import type { JsonObject, JsonValue } from "type-fest";

import type { EventFilterDescriptor, FilterOperator } from "../../protocol/descriptors.ts";

// Whether an event passes every filter that the subscription's arguments switch on.
export function matches(
  filters: ReadonlyArray<EventFilterDescriptor>,
  args: JsonObject,
  payload: JsonObject,
): boolean {
  return filters.every((filter) => {
    const argument = args[filter.param];
    return argument === undefined || holds(filter.op, payload[filter.field], argument);
  });
}

function holds(op: FilterOperator, value: JsonValue | undefined, argument: JsonValue): boolean {
  switch (op) {
    case "eq":
      return value === argument;
    case "gte":
      return typeof value === "number" && typeof argument === "number" && value >= argument;
    case "lte":
      return typeof value === "number" && typeof argument === "number" && value <= argument;
    case "in":
      return Array.isArray(argument) && value !== undefined && argument.includes(value);
  }
}
