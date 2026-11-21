import type { Bot } from "mineflayer";
import type { JsonValue } from "type-fest";
import type { z } from "zod";

import type { Config } from "../../config/schema.ts";

export interface CommandContext {
  bot: Bot;
  config: Config;
}

// A command acts on the world without the bot's body, so it runs at any time,
// also while an action or a reflex has the body. The output goes to the agent as JSON.
export interface CommandDefinition<Input, Output extends JsonValue> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  run(context: CommandContext, input: Input): Promise<Output>;
}

export function defineCommand<Input, Output extends JsonValue>(
  definition: CommandDefinition<Input, Output>,
): CommandDefinition<Input, Output> {
  return definition;
}
