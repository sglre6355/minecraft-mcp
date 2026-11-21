import type { Bot } from "mineflayer";
import type { JsonObject, JsonValue } from "type-fest";
import type { z } from "zod";

import type { Emit } from "../events/event.ts";

export interface ActionContext<Progress extends JsonObject> {
  bot: Bot;
  // Aborts when the agent cancels the action, a reflex takes the body, or the bot disconnects.
  // An action that keeps going after that loses the body anyway.
  signal: AbortSignal;
  progress: (data: Progress) => void;
  emit: Emit;
}

// An action moves the bot's body. One action runs at a time.
// The output goes to the agent as JSON.
export interface ActionDefinition<Input, Output extends JsonValue, Progress extends JsonObject> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  // The shape of what the action reports through `context.progress`.
  progress?: z.ZodType<Progress>;
  run(context: ActionContext<Progress>, input: Input): Promise<Output>;
}

export function defineAction<
  Input,
  Output extends JsonValue,
  Progress extends JsonObject = Record<string, never>,
>(
  definition: ActionDefinition<Input, Output, Progress>,
): ActionDefinition<Input, Output, Progress> {
  return definition;
}
