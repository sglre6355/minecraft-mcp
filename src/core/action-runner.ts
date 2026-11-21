import type { JsonObject, JsonValue } from "type-fest";

import { z } from "zod";

import type { EventFilterDescriptor } from "../protocol/descriptors.ts";
import type { Body, BodyHolder, BodyLease } from "./body.ts";
import type { Emit, EventKindDefinition } from "./events/event.ts";

import { log } from "../log.ts";
import { defineEventKind } from "./events/event.ts";
import { aborted, within } from "./wait.ts";

const identity = { actionId: z.string(), name: z.string() };
const progressData: z.ZodType<JsonObject> = z.record(z.string(), z.json());

// A subscription can ask for the events of one action.
const params = z.strictObject({
  actionId: z.string().optional().describe("Only events of this action."),
});
const filters: Array<EventFilterDescriptor> = [{ param: "actionId", field: "actionId", op: "eq" }];

export const started = defineEventKind({
  kind: "action.started",
  description: "An action began.",
  payload: z.object(identity),
  params,
  filters,
});

export const progressed = defineEventKind({
  kind: "action.progress",
  description:
    "A running action reported how far it has come. The latest report is also available from action_status.",
  payload: z.object({ ...identity, data: progressData }),
  params,
  filters,
  optIn: true,
});

export const completed = defineEventKind({
  kind: "action.completed",
  description: "An action finished. Its output is available from action_status.",
  payload: z.object(identity),
  params,
  filters,
});

export const failed = defineEventKind({
  kind: "action.failed",
  description: "An action ended with an error.",
  payload: z.object({ ...identity, message: z.string() }),
  params,
  filters,
});

export const interrupted = defineEventKind({
  kind: "action.interrupted",
  description:
    "An action was stopped before it finished. `stopped` is false when the action ignored the order to stop and may still be moving the bot.",
  params,
  filters,
  payload: z.object({
    ...identity,
    by: z.enum(["agent", "reflex", "disconnect"]),
    reflex: z.string().nullable(),
    stopped: z.boolean(),
  }),
});

export const actionEventKinds = [started, progressed, completed, failed, interrupted];

type Interrupter = z.infer<typeof interrupted.payload>["by"];

type Outcome = { status: "completed"; output: JsonValue } | { status: "failed"; message: string };

export type ActionReport =
  | { actionId: string; name: string; status: "running"; progress: JsonObject | null }
  | { actionId: string; name: string; status: "completed"; output: JsonValue }
  | { actionId: string; name: string; status: "failed"; message: string }
  | {
      actionId: string;
      name: string;
      status: "interrupted";
      by: Interrupter;
      reflex: string | null;
      stopped: boolean;
    };

export interface ActionControl {
  // Aborts when the agent cancels, a reflex takes the body, or the bot disconnects.
  signal: AbortSignal;
  progress: (data: JsonObject) => void;
}

export interface ActionRequest {
  name: string;
  suppressReflexes: ReadonlyArray<string>;
  run(control: ActionControl): Promise<JsonValue>;
}

export type StartResult =
  | { started: true; report: ActionReport }
  | { started: false; heldBy: BodyHolder };

export interface ActionRunnerOptions {
  body: Body;
  emit: Emit;
  // A call that starts an action answers after this long, even if the action still runs.
  waitMs: number;
  // An action told to stop keeps the body for at most this long.
  stopGraceMs: number;
}

interface Running {
  id: string;
  name: string;
  progress: JsonObject | null;
  stop: AbortController;
  stoppedBy: Interrupter | undefined;
  ended: Promise<ActionReport>;
}

const remembered = 32;

// Runs one action at a time on the bot's body and keeps the reports of recent ones.
export class ActionRunner {
  readonly #body: Body;
  readonly #emit: Emit;
  readonly #waitMs: number;
  readonly #stopGraceMs: number;

  #running: Running | undefined;
  #latest: string | undefined;
  readonly #ended = new Map<string, ActionReport>();

  constructor(options: ActionRunnerOptions) {
    this.#body = options.body;
    this.#emit = options.emit;
    this.#waitMs = options.waitMs;
    this.#stopGraceMs = options.stopGraceMs;
  }

  async start(request: ActionRequest): Promise<StartResult> {
    const id = crypto.randomUUID().slice(0, 8);
    const grant = await this.#body.acquireForAction(id, request.suppressReflexes);
    if (!grant.granted) {
      return { started: false, heldBy: grant.heldBy };
    }

    const ended = Promise.withResolvers<ActionReport>();
    const running: Running = {
      id,
      name: request.name,
      progress: null,
      stop: new AbortController(),
      stoppedBy: undefined,
      ended: ended.promise,
    };
    this.#running = running;
    this.#latest = id;
    void this.#run(running, request, grant.lease).then(ended.resolve);

    const report = await within(ended.promise, this.#waitMs);
    return { started: true, report: report ?? runningReport(running) };
  }

  // The report of the given action, or of the latest one.
  report(actionId?: string): ActionReport | undefined {
    const id = actionId ?? this.#latest;
    if (id === undefined) {
      return undefined;
    }
    const running = this.#running;
    return running?.id === id ? runningReport(running) : this.#ended.get(id);
  }

  cancel(actionId: string): Promise<ActionReport | undefined> {
    const running = this.#running;
    if (running?.id !== actionId) {
      return Promise.resolve(this.#ended.get(actionId));
    }
    this.#stop(running, "agent");
    return running.ended;
  }

  disconnected(): void {
    if (this.#running !== undefined) {
      this.#stop(this.#running, "disconnect");
    }
  }

  #stop(running: Running, by: Interrupter): void {
    running.stoppedBy ??= by;
    running.stop.abort(new Error(`The action was stopped by ${by}.`));
  }

  // Never rejects, and gives the body back on every path.
  async #run(running: Running, request: ActionRequest, lease: BodyLease): Promise<ActionReport> {
    const signal = AbortSignal.any([lease.signal, running.stop.signal]);
    const name = { actionId: running.id, name: running.name };
    this.#announce(started, name);

    const outcome = settle(request, {
      signal,
      progress: (data) => {
        if (this.#running === running) {
          running.progress = data;
          this.#announce(progressed, { ...name, data });
        }
      },
    });
    const first = await Promise.race([outcome, aborted(signal)]);

    let report: ActionReport;
    if (first !== "aborted" && !signal.aborted) {
      report = { ...name, ...first };
    } else {
      const late = first === "aborted" ? await within(outcome, this.#stopGraceMs) : first;
      const taker = lease.takenBy;
      report = {
        ...name,
        status: "interrupted",
        by: taker === undefined ? (running.stoppedBy ?? "agent") : "reflex",
        reflex: taker?.kind === "reflex" ? taker.name : null,
        stopped: late !== undefined,
      };
    }

    this.#running = undefined;
    this.#ended.set(running.id, report);
    if (this.#ended.size > remembered) {
      for (const oldest of this.#ended.keys()) {
        this.#ended.delete(oldest);
        break;
      }
    }
    lease.release();

    switch (report.status) {
      case "completed":
        this.#announce(completed, name);
        break;
      case "failed":
        this.#announce(failed, { ...name, message: report.message });
        break;
      case "interrupted":
        this.#announce(interrupted, {
          ...name,
          by: report.by,
          reflex: report.reflex,
          stopped: report.stopped,
        });
        break;
    }
    return report;
  }

  // An event that cannot be sent must not cost the action or the body.
  #announce<Payload extends JsonObject>(
    kind: EventKindDefinition<Payload>,
    payload: Payload,
  ): void {
    try {
      this.#emit(kind, payload);
    } catch (error) {
      log("error", "action-runner", `could not emit ${kind.kind}`, {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function runningReport(running: Running): ActionReport {
  return {
    actionId: running.id,
    name: running.name,
    status: "running",
    progress: running.progress,
  };
}

async function settle(request: ActionRequest, control: ActionControl): Promise<Outcome> {
  try {
    return { status: "completed", output: await request.run(control) };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
