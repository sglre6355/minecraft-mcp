import type { Bot } from "mineflayer";
import type { JsonObject, JsonValue } from "type-fest";
import type { z } from "zod";

import type { Emit } from "../events/event.ts";

export interface ActionContext {
  bot: Bot;
  // Aborts when the agent cancels the action, a reflex takes the body, or time runs out.
  signal: AbortSignal;
  progress(data: JsonObject): void;
  emit: Emit;
}

// An action moves the bot's body. One action runs at a time.
// The output goes to the agent as JSON.
export interface ActionDefinition<Input, Output extends JsonValue> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  run(context: ActionContext, input: Input): Promise<Output>;
}

export function defineAction<Input, Output extends JsonValue>(
  definition: ActionDefinition<Input, Output>,
): ActionDefinition<Input, Output> {
  return definition;
}
