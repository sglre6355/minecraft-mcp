import type { Bot } from "mineflayer";

import type { Emit } from "../events/event.ts";

export interface ReflexContext {
  bot: Bot;
  // Aborts when an action that suppresses this reflex takes the body, the reflex reaches its
  // time limit, or the bot disconnects. A reflex that keeps going after that loses the body anyway.
  signal: AbortSignal;
  emit: Emit;
}

// `decide` takes data and returns data, so it runs without Mineflayer.
export interface Policy<Situation, Decision extends string> {
  // Resolves to `undefined` when nothing should be done.
  decide(situation: Situation): Promise<Decision | undefined>;
}

// A reflex takes the first move when harm would arrive before the agent can answer.
export interface Reflex<Situation, Decision extends string> {
  name: string;
  // The longest the reflex may hold the body.
  limitMs: number;
  // Returns the situation that calls for a decision, or `undefined` when all is well.
  // A reflex that has acted on a situation reports it again only if it got worse.
  observe(bot: Bot): Situation | undefined;
  policy: Policy<Situation, Decision>;
  execute(context: ReflexContext, decision: Decision): Promise<void>;
}
