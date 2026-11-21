import type { Bot } from "mineflayer";
import type { JsonValue } from "type-fest";
import type { z } from "zod";

export interface QueryContext {
  bot: Bot;
}

// A query only reads the world. Any number of queries may run at once.
// The output goes to the agent as JSON.
export interface QueryDefinition<Input, Output extends JsonValue> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  run(context: QueryContext, input: Input): Promise<Output>;
}

export function defineQuery<Input, Output extends JsonValue>(
  definition: QueryDefinition<Input, Output>,
): QueryDefinition<Input, Output> {
  return definition;
}
