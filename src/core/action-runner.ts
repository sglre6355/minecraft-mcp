import type { JsonObject, JsonValue } from "type-fest";

import type { Body, BodyLease } from "./body.ts";

import { aborted, within } from "./wait.ts";

type Interrupter = "reflex" | "death" | "disconnect";

type ActionRef = { actionId: string; name: string };

type Identity = ActionRef & { createdAt: string; lastUpdatedAt: string };

type Outcome = { status: "completed"; output: JsonValue } | { status: "failed"; message: string };

// How an action ended. For `skipped`, `after` identifies the action whose outcome prevented
// this one from running.
type End =
  | Outcome
  | { status: "interrupted"; by: Interrupter; reflex: string | null; stopped: boolean }
  | { status: "canceled"; stopped: boolean }
  | { status: "skipped"; after: ActionRef };

// `ahead` lists actions ahead of this action in the order they will run, from the action
// running now or about to run to the action directly ahead of this one.
export type ActionReport = Identity &
  (
    | { status: "queued"; ahead: Array<ActionRef> }
    | { status: "running"; progress: JsonObject | null }
    | End
  );

export interface ActionControl {
  // Aborts when the agent cancels, a reflex takes the body, or the bot dies or disconnects.
  signal: AbortSignal;
  progress: (data: JsonObject) => void;
}

export interface ActionRequest {
  name: string;
  suppressReflexes: ReadonlyArray<string>;
  run(control: ActionControl): Promise<JsonValue>;
}

export type Enqueued =
  | { accepted: true; report: ActionReport }
  | { accepted: false; waiting: number };

export interface ActionRunnerOptions {
  body: Body;
  // An action told to stop keeps the body for at most this long.
  stopGraceMs: number;
}

interface Entry {
  id: string;
  request: ActionRequest;
  createdAt: string;
  lastUpdatedAt: string;
  started: boolean;
  progress: JsonObject | null;
  stop: AbortController;
  stoppedBy: "agent" | "death" | "disconnect" | undefined;
  ended: PromiseWithResolvers<ActionReport>;
}

// How many finished reports are kept and how many actions may wait behind the running action.
const remembered = 64;
const mostWaiting = 16;

// Runs actions on the bot's body one at a time, in the order they arrived, and keeps recent
// reports. When an action does not complete, the actions waiting behind it are skipped.
export class ActionRunner {
  readonly #body: Body;
  readonly #stopGraceMs: number;

  // The action that is running or waiting for the body so it can run.
  #head: Entry | undefined;
  #queue: Array<Entry> = [];
  readonly #ended = new Map<string, ActionReport>();

  constructor(options: ActionRunnerOptions) {
    this.#body = options.body;
    this.#stopGraceMs = options.stopGraceMs;
  }

  enqueue(request: ActionRequest): Enqueued {
    if (this.#head !== undefined && this.#queue.length >= mostWaiting) {
      return { accepted: false, waiting: this.#queue.length };
    }
    const now = new Date().toISOString();
    const entry: Entry = {
      id: crypto.randomUUID().slice(0, 8),
      request,
      createdAt: now,
      lastUpdatedAt: now,
      started: false,
      progress: null,
      stop: new AbortController(),
      stoppedBy: undefined,
      ended: Promise.withResolvers(),
    };
    this.#queue.push(entry);
    this.#next();
    return { accepted: true, report: this.#reportOf(entry) };
  }

  report(actionId: string): ActionReport | undefined {
    const entry = this.#live(actionId);
    return entry === undefined ? this.#ended.get(actionId) : this.#reportOf(entry);
  }

  // Resolves with the report once the action has ended.
  ended(actionId: string): Promise<ActionReport> | undefined {
    const entry = this.#live(actionId);
    if (entry !== undefined) {
      return entry.ended.promise;
    }
    const report = this.#ended.get(actionId);
    return report === undefined ? undefined : Promise.resolve(report);
  }

  // A queued action ends immediately. A running action is told to stop and ends soon after.
  cancel(actionId: string): ActionReport | undefined {
    const head = this.#head;
    if (head?.id === actionId) {
      this.#stop(head, "agent");
      return this.#reportOf(head);
    }
    const queued = this.#queue.find((entry) => entry.id === actionId);
    if (queued === undefined) {
      return this.#ended.get(actionId);
    }
    this.#queue = this.#queue.filter((entry) => entry !== queued);
    return this.#settle(queued, { status: "canceled", stopped: true });
  }

  // The bot comes back to life somewhere else, so what it was doing is over.
  died(): void {
    if (this.#head !== undefined) {
      this.#stop(this.#head, "death");
    }
  }

  disconnected(): void {
    if (this.#head !== undefined) {
      this.#stop(this.#head, "disconnect");
    }
  }

  #live(actionId: string): Entry | undefined {
    return this.#head?.id === actionId
      ? this.#head
      : this.#queue.find((entry) => entry.id === actionId);
  }

  #reportOf(entry: Entry): ActionReport {
    const identity = {
      actionId: entry.id,
      name: entry.request.name,
      createdAt: entry.createdAt,
      lastUpdatedAt: entry.lastUpdatedAt,
    };
    if (entry.started) {
      return { ...identity, status: "running", progress: entry.progress };
    }
    const place = this.#queue.indexOf(entry);
    const before = place === -1 ? [] : [this.#head, ...this.#queue.slice(0, place)];
    const ahead = before
      .filter((other) => other !== undefined)
      .map((other) => ({ actionId: other.id, name: other.request.name }));
    return { ...identity, status: "queued", ahead };
  }

  #stop(entry: Entry, by: "agent" | "death" | "disconnect"): void {
    entry.stoppedBy ??= by;
    entry.stop.abort(new Error(`The action was stopped by ${by}.`));
  }

  #next(): void {
    if (this.#head !== undefined) {
      return;
    }
    const entry = this.#queue.shift();
    if (entry === undefined) {
      return;
    }
    this.#head = entry;
    // If the body is free, it is acquired immediately, so the action counts as running from this
    // point.
    entry.started = this.#body.holder === undefined;
    void this.#run(entry);
  }

  // Never rejects, and gives the body back on every path.
  async #run(entry: Entry): Promise<void> {
    let lease: BodyLease | undefined;
    while (lease === undefined) {
      if (entry.stop.signal.aborted) {
        this.#finish(entry, this.#stopped(entry, undefined, true));
        return;
      }
      const grant = await this.#body.acquireForAction(entry.id, entry.request.suppressReflexes);
      if (grant.granted) {
        lease = grant.lease;
      } else {
        await Promise.race([this.#body.free(), aborted(entry.stop.signal)]);
      }
    }
    const signal = AbortSignal.any([lease.signal, entry.stop.signal]);
    if (signal.aborted) {
      lease.release();
      this.#finish(entry, this.#stopped(entry, lease, true));
      return;
    }
    entry.started = true;
    entry.lastUpdatedAt = new Date().toISOString();

    const outcome = settle(entry.request, {
      signal,
      progress: (data) => {
        if (this.#head === entry) {
          entry.progress = data;
          entry.lastUpdatedAt = new Date().toISOString();
        }
      },
    });
    const first = await Promise.race([outcome, aborted(signal)]);

    let end: End;
    if (first !== "aborted" && !signal.aborted) {
      end = first;
    } else {
      const late = first === "aborted" ? await within(outcome, this.#stopGraceMs) : first;
      end = this.#stopped(entry, lease, late !== undefined);
    }
    lease.release();
    this.#finish(entry, end);
  }

  #stopped(entry: Entry, lease: BodyLease | undefined, stopped: boolean): End {
    const taker = lease?.takenBy;
    if (taker !== undefined) {
      const reflex = taker.kind === "reflex" ? taker.name : null;
      return { status: "interrupted", by: "reflex", reflex, stopped };
    }
    if (entry.stoppedBy === "death" || entry.stoppedBy === "disconnect") {
      return { status: "interrupted", by: entry.stoppedBy, reflex: null, stopped };
    }
    return { status: "canceled", stopped };
  }

  // Ends the action that ran, skips the actions behind it unless it completed, and starts the
  // next action.
  #finish(entry: Entry, end: End): void {
    this.#head = undefined;
    const report = this.#settle(entry, end);
    if (report.status !== "completed") {
      const skipped = this.#queue;
      this.#queue = [];
      for (const waiting of skipped) {
        this.#settle(waiting, {
          status: "skipped",
          after: { actionId: entry.id, name: entry.request.name },
        });
      }
    }
    this.#next();
  }

  #settle(entry: Entry, end: End): ActionReport {
    const report: ActionReport = {
      actionId: entry.id,
      name: entry.request.name,
      createdAt: entry.createdAt,
      lastUpdatedAt: new Date().toISOString(),
      ...end,
    };
    this.#ended.set(entry.id, report);
    if (this.#ended.size > remembered) {
      for (const oldest of this.#ended.keys()) {
        this.#ended.delete(oldest);
        break;
      }
    }
    entry.ended.resolve(report);
    return report;
  }
}

async function settle(request: ActionRequest, control: ActionControl): Promise<Outcome> {
  try {
    return { status: "completed", output: await request.run(control) };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
