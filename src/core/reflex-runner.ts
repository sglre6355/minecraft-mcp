import type { JsonObject } from "type-fest";

import { z } from "zod";

import type { EventFilterDescriptor } from "../protocol/descriptors.ts";
import type { Body, BodyLease } from "./body.ts";
import type { Emit, EventKindDefinition } from "./events/event.ts";

import { log } from "../log.ts";
import { defineEventKind } from "./events/event.ts";
import { aborted, within } from "./wait.ts";

// A subscription can ask for the events of one reflex.
const params = z.strictObject({
  reflex: z.string().optional().describe("Only events of this reflex."),
});
const filters: Array<EventFilterDescriptor> = [{ param: "reflex", field: "reflex", op: "eq" }];

export const activated = defineEventKind({
  kind: "reflex.activated",
  description:
    "A reflex took the body to act before the agent could. Until it ends, an action starts only if it names the reflex in suppressReflexes.",
  payload: z.object({
    reflex: z.string(),
    decision: z.string().describe("What the reflex chose to do."),
    interruptedActionId: z
      .string()
      .nullable()
      .describe("The action the reflex stopped to get the body."),
  }),
  params,
  filters,
});

export const ended = defineEventKind({
  kind: "reflex.ended",
  description:
    "A reflex gave the body back. `stopped` is false when the reflex ignored the order to stop and may still be moving the bot.",
  payload: z.object({
    reflex: z.string(),
    outcome: z
      .enum(["completed", "failed", "overruled", "timed_out", "disconnected"])
      .describe("`overruled` means an action that suppresses the reflex took the body."),
    message: z.string().nullable().describe("The error, when the reflex failed."),
    stopped: z.boolean(),
  }),
  params,
  filters,
});

export const reflexEventKinds = [activated, ended];

type End = Omit<z.infer<typeof ended.payload>, "reflex">;

// A reflex with the bot it watches already bound, so the runner works without Mineflayer.
export interface BoundReflex<Situation> {
  name: string;
  limitMs: number;
  observe(): Situation | undefined;
  decide(situation: Situation): Promise<string | undefined>;
  execute(signal: AbortSignal, decision: string): Promise<void>;
}

export interface ReflexRunnerOptions {
  body: Body;
  emit: Emit;
  // A reflex told to stop keeps the body for at most this long.
  stopGraceMs: number;
}

// Lets the reflexes watch the bot, and runs the one that decides to act on the bot's body.
export class ReflexRunner {
  readonly #body: Body;
  readonly #emit: Emit;
  readonly #stopGraceMs: number;

  // Counts the connections, so a decision made for an earlier one is dropped.
  #connection = 0;
  // The reflexes that are deciding or acting.
  readonly #responding = new Set<string>();
  // Stops the reflex that has the body.
  #stop: AbortController | undefined;

  constructor(options: ReflexRunnerOptions) {
    this.#body = options.body;
    this.#emit = options.emit;
    this.#stopGraceMs = options.stopGraceMs;
  }

  // Lets every reflex look once. Resolves when the reflexes this set off are done.
  // Never rejects.
  async check(reflexes: ReadonlyArray<BoundReflex<unknown>>): Promise<void> {
    const responses: Array<Promise<void>> = [];
    for (const reflex of reflexes) {
      if (!this.#responding.has(reflex.name)) {
        responses.push(this.#respond(reflex));
      }
    }
    await Promise.all(responses);
  }

  disconnected(): void {
    this.#connection += 1;
    this.#stop?.abort(new Error("The bot disconnected."));
  }

  // One reflex that fails does not affect the others.
  async #respond(reflex: BoundReflex<unknown>): Promise<void> {
    this.#responding.add(reflex.name);
    try {
      await this.#decide(reflex);
    } catch (error) {
      log("error", "reflex-runner", `the reflex ${reflex.name} failed before it could act`, {
        detail: errorMessage(error),
      });
    } finally {
      this.#responding.delete(reflex.name);
    }
  }

  // The body is asked for last, since asking for it stops a running action.
  async #decide(reflex: BoundReflex<unknown>): Promise<void> {
    const connection = this.#connection;
    const situation = reflex.observe();
    if (situation === undefined) {
      return;
    }
    const decision = await reflex.decide(situation);
    if (decision === undefined) {
      return;
    }
    // The decision may have taken a while.
    if (connection !== this.#connection || reflex.observe() === undefined) {
      return;
    }
    const grant = await this.#body.acquireForReflex(reflex.name);
    if (!grant.granted) {
      return;
    }
    if (connection !== this.#connection) {
      grant.lease.release();
      return;
    }

    this.#announce(activated, {
      reflex: reflex.name,
      decision,
      interruptedActionId: grant.interrupted?.kind === "action" ? grant.interrupted.id : null,
    });
    const end = await this.#execute(reflex, decision, grant.lease);
    grant.lease.release();
    this.#announce(ended, { reflex: reflex.name, ...end });
  }

  // Never rejects.
  async #execute(reflex: BoundReflex<unknown>, decision: string, lease: BodyLease): Promise<End> {
    const stop = new AbortController();
    this.#stop = stop;
    let timedOut = false;
    const limit = setTimeout(() => {
      timedOut = true;
      stop.abort(new Error(`The reflex reached its limit of ${reflex.limitMs} ms.`));
    }, reflex.limitMs);
    const signal = AbortSignal.any([lease.signal, stop.signal]);

    const outcome = settle(reflex, signal, decision);
    const first = await Promise.race([outcome, aborted(signal)]);
    clearTimeout(limit);
    this.#stop = undefined;

    if (first !== "aborted" && !signal.aborted) {
      return first;
    }
    const late = first === "aborted" ? await within(outcome, this.#stopGraceMs) : first;
    let reason: End["outcome"] = "disconnected";
    if (lease.takenBy !== undefined) {
      reason = "overruled";
    } else if (timedOut) {
      reason = "timed_out";
    }
    return { outcome: reason, message: null, stopped: late !== undefined };
  }

  // An event that cannot be sent must not cost the body.
  #announce<Payload extends JsonObject>(
    kind: EventKindDefinition<Payload>,
    payload: Payload,
  ): void {
    try {
      this.#emit(kind, payload);
    } catch (error) {
      log("error", "reflex-runner", `could not emit ${kind.kind}`, {
        detail: errorMessage(error),
      });
    }
  }
}

async function settle(
  reflex: BoundReflex<unknown>,
  signal: AbortSignal,
  decision: string,
): Promise<End> {
  try {
    await reflex.execute(signal, decision);
    return { outcome: "completed", message: null, stopped: true };
  } catch (error) {
    return { outcome: "failed", message: errorMessage(error), stopped: true };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
