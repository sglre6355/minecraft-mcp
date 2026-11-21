import { z } from "zod";

import type { Config } from "../config/schema.ts";
import type { EventKindDescriptor, ToolDescriptor } from "../protocol/descriptors.ts";
import type { EventOccurrence } from "../protocol/events.ts";
import type { CallResult, CoreToGateway, GatewayToCore, Target } from "../protocol/messages.ts";

import { log } from "../log.ts";

const restartedPayload = z.object({
  reason: z.enum(["unresponsive", "crashed"]),
});

type RestartReason = z.infer<typeof restartedPayload>["reason"];

const coreRestarted: EventKindDescriptor = {
  kind: "core.restarted",
  description:
    "The bot's runtime stopped responding or crashed and was recreated. The bot left the Minecraft server and any running action is gone.",
  payloadSchema: z.toJSONSchema(restartedPayload),
  paramsSchema: z.toJSONSchema(z.object({})),
  filters: [],
  optIn: false,
};

export interface SupervisorOptions {
  workerUrl: URL;
  config: Config;
  onEvent: (event: EventOccurrence) => void;
  pingIntervalMs?: number;
  // The core is recreated after leaving this many pings in a row unanswered.
  missedPingLimit?: number;
  restartDelayMs?: number;
  maxRestartDelayMs?: number;
  // A core that stayed ready this long starts again from the shortest restart delay.
  stableAfterMs?: number;
}

// Doubles with each failure in a row, up to the maximum.
export function restartDelay(failuresInARow: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** failuresInARow, maxMs);
}

// Runs the core in a Worker and recreates it when it hangs or crashes.
export class Supervisor {
  readonly #workerUrl: URL;
  readonly #config: Config;
  readonly #onEvent: (event: EventOccurrence) => void;
  readonly #pingIntervalMs: number;
  readonly #missedPingLimit: number;
  readonly #restartDelayMs: number;
  readonly #maxRestartDelayMs: number;
  readonly #stableAfterMs: number;

  #worker: Worker | undefined;
  #ready = false;
  #readySince: number | undefined;
  #missedPings = 0;
  #failuresInARow = 0;
  #tools: Array<ToolDescriptor> = [];
  #eventKinds: Array<EventKindDescriptor> = [coreRestarted];
  // The server the bot is meant to be in. A core that is recreated joins it again.
  #target: Target | null = null;
  #nextCallId = 1;
  readonly #pendingCalls = new Map<number, (result: CallResult) => void>();
  #started: PromiseWithResolvers<void> | undefined;
  #pingTimer: Timer | undefined;
  #restartTimer: Timer | undefined;

  constructor(options: SupervisorOptions) {
    this.#workerUrl = options.workerUrl;
    this.#config = options.config;
    this.#onEvent = options.onEvent;
    this.#pingIntervalMs = options.pingIntervalMs ?? 1000;
    this.#missedPingLimit = options.missedPingLimit ?? 5;
    this.#restartDelayMs = options.restartDelayMs ?? 1000;
    this.#maxRestartDelayMs = options.maxRestartDelayMs ?? 60_000;
    this.#stableAfterMs = options.stableAfterMs ?? 30_000;
  }

  get tools(): Array<ToolDescriptor> {
    return this.#tools;
  }

  get eventKinds(): Array<EventKindDescriptor> {
    return this.#eventKinds;
  }

  // Resolves when the core reports ready. Rejects if the core fails before that.
  start(): Promise<void> {
    this.#started = Promise.withResolvers();
    this.#spawn();
    this.#pingTimer = setInterval(() => {
      this.#checkPulse();
    }, this.#pingIntervalMs);
    return this.#started.promise;
  }

  stop(): void {
    clearInterval(this.#pingTimer);
    clearTimeout(this.#restartTimer);
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#ready = false;
    this.#failPendingCalls();
    this.#started?.reject(new Error("The supervisor stopped before the core was ready."));
    this.#started = undefined;
  }

  call(tool: string, input: unknown): Promise<CallResult> {
    if (this.#worker === undefined || !this.#ready) {
      return Promise.resolve(unavailable);
    }
    const id = this.#nextCallId;
    this.#nextCallId += 1;
    const { promise, resolve } = Promise.withResolvers<CallResult>();
    this.#pendingCalls.set(id, resolve);
    this.#post(this.#worker, { type: "call", id, tool, input });
    return promise;
  }

  #spawn(): void {
    const worker = new Worker(this.#workerUrl);
    this.#worker = worker;
    this.#missedPings = 0;
    worker.addEventListener("message", (event: MessageEvent<CoreToGateway>) => {
      if (worker === this.#worker) {
        this.#receive(event.data);
      }
    });
    worker.addEventListener("error", (event) => {
      this.#recreate(worker, "crashed", event.message);
    });
    worker.addEventListener("close", () => {
      this.#recreate(worker, "crashed", "the worker exited");
    });
    this.#post(worker, { type: "init", config: this.#config, rejoin: this.#target });
  }

  #post(worker: Worker, message: GatewayToCore): void {
    worker.postMessage(message);
  }

  #receive(message: CoreToGateway): void {
    this.#missedPings = 0;
    switch (message.type) {
      case "ready":
        this.#ready = true;
        this.#readySince = Date.now();
        this.#tools = message.tools;
        this.#eventKinds = [coreRestarted, ...message.eventKinds];
        this.#started?.resolve();
        this.#started = undefined;
        break;
      case "pong":
        break;
      case "result": {
        const resolve = this.#pendingCalls.get(message.id);
        this.#pendingCalls.delete(message.id);
        resolve?.(message.result);
        break;
      }
      case "event":
        this.#onEvent(message.event);
        break;
      case "target":
        this.#target = message.target;
        break;
    }
  }

  #checkPulse(): void {
    const worker = this.#worker;
    if (worker === undefined) {
      return;
    }
    if (this.#missedPings >= this.#missedPingLimit) {
      this.#recreate(worker, "unresponsive", `no reply to ${this.#missedPingLimit} pings`);
      return;
    }
    this.#missedPings += 1;
    this.#post(worker, { type: "ping" });
  }

  #recreate(worker: Worker, reason: RestartReason, detail: string): void {
    if (worker !== this.#worker) {
      return;
    }
    worker.terminate();
    this.#worker = undefined;
    this.#ready = false;
    this.#failPendingCalls();

    if (this.#started !== undefined) {
      clearInterval(this.#pingTimer);
      this.#started.reject(new Error(`The core failed to start. ${detail}`));
      this.#started = undefined;
      return;
    }

    const stable =
      this.#readySince !== undefined && Date.now() - this.#readySince >= this.#stableAfterMs;
    if (stable) {
      this.#failuresInARow = 0;
    }
    const delayMs = restartDelay(
      this.#failuresInARow,
      this.#restartDelayMs,
      this.#maxRestartDelayMs,
    );
    this.#failuresInARow += 1;
    this.#readySince = undefined;

    log("warn", "supervisor", "recreating the core", { reason, detail, delayMs });
    this.#onEvent({ kind: coreRestarted.kind, occurredAt: new Date(), payload: { reason } });
    this.#restartTimer = setTimeout(() => {
      this.#spawn();
    }, delayMs);
  }

  #failPendingCalls(): void {
    for (const resolve of this.#pendingCalls.values()) {
      resolve(unavailable);
    }
    this.#pendingCalls.clear();
  }
}

const unavailable: CallResult = {
  ok: false,
  error: {
    code: "core_unavailable",
    message: "The bot's runtime is restarting. Any running action is gone.",
  },
};
