import type { Bot } from "mineflayer";

import type { Emit } from "../events/event.ts";

export interface ReflexContext {
  bot: Bot;
  // Aborts when an action that suppresses this reflex takes the body.
  signal: AbortSignal;
  emit: Emit;
}

// `decide` takes data and returns data, so it runs without Mineflayer.
export interface Policy<Situation, Decision extends string> {
  decide(situation: Situation): Promise<Decision>;
}

export interface Reflex<Situation, Decision extends string> {
  name: string;
  // Returns the situation that calls for a decision, or `undefined` when all is well.
  observe(bot: Bot): Situation | undefined;
  policy: Policy<Situation, Decision>;
  execute(context: ReflexContext, decision: Decision): Promise<void>;
}
