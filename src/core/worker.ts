import type { Bot } from "mineflayer";

import type { Config } from "../config/schema.ts";
import type {
  ActionOperation,
  CallResult,
  CoreToGateway,
  GatewayToCore,
  Target,
} from "../protocol/messages.ts";
import type { DialHooks } from "./connection.ts";
import type { Emit, EventSourceDefinition } from "./events/event.ts";
import type { Registry } from "./plugins.ts";
import type { BoundReflex } from "./reflex-runner.ts";
import type { Reflex } from "./reflexes/reflex.ts";
import type { Tool } from "./tools.ts";

import { log } from "../log.ts";
import { ActionRunner } from "./action-runner.ts";
import { Body } from "./body.ts";
import { builtin } from "./builtin.ts";
import { connectionEventKinds, dial, disconnected } from "./connection.ts";
import { describeEventKind } from "./events/event.ts";
import { buildRegistry, loadPlugins } from "./plugins.ts";
import { describeCause, Presence } from "./presence.ts";
import { ReflexRunner, reflexEventKinds } from "./reflex-runner.ts";
import { buildTools } from "./tools.ts";

declare const self: Worker;

function post(message: CoreToGateway): void {
  self.postMessage(message);
}

// Events are emitted from inside Mineflayer's listeners, where a throw would take the core down.
// An event that cannot be sent is logged and dropped.
const emit: Emit = (kind, payload) => {
  try {
    post({
      type: "event",
      event: { kind: kind.kind, occurredAt: new Date(), payload: kind.payload.parse(payload) },
    });
  } catch (error) {
    log("error", "core", `could not emit ${kind.kind}`, { detail: errorMessage(error) });
  }
};

// Runs every event source on a bot. Returns the function that stops them all.
// One source that fails to start or stop does not affect the others.
function startEventSources(
  sources: ReadonlyArray<EventSourceDefinition>,
  bot: Bot,
  config: Config,
): () => void {
  const stops = sources.flatMap((source) => {
    try {
      return [{ name: source.name, stop: source.start({ bot, emit, config }) }];
    } catch (error) {
      log("error", "core", `the event source ${source.name} did not start`, {
        detail: errorMessage(error),
      });
      return [];
    }
  });
  return () => {
    for (const { name, stop } of stops) {
      try {
        stop();
      } catch (error) {
        log("error", "core", `the event source ${name} did not stop`, {
          detail: errorMessage(error),
        });
      }
    }
  };
}

// The reflexes that the config leaves switched on.
function enabledReflexes(
  all: Registry["reflexes"],
  settings: Config["reflexes"],
): Registry["reflexes"] {
  for (const name of Object.keys(settings)) {
    if (!all.has(name)) {
      throw new Error(`The config has settings for the reflex "${name}", which does not exist`);
    }
  }
  const enabled: Registry["reflexes"] = new Map();
  for (const [name, reflex] of all) {
    if (settings[name]?.enabled !== false) {
      enabled.set(name, reflex);
    }
  }
  return enabled;
}

function bind(reflex: Reflex<unknown, string>, bot: Bot): BoundReflex<unknown> {
  return {
    name: reflex.name,
    limitMs: reflex.limitMs,
    observe: () => reflex.observe(bot),
    decide: (situation) => reflex.policy.decide(situation),
    execute: (signal, decision) => reflex.execute({ bot, signal, emit }, decision),
  };
}

// An action or a reflex told to stop keeps the body for at most this long.
const stopGraceMs = 2000;

// How often the reflexes look at the bot.
const reflexCheckMs = 100;

// `connect` responds after this much time, even if the bot is still joining.
const connectWaitMs = 10_000;

let tools: Map<string, Tool> | undefined;
let actions: ActionRunner | undefined;

// The waits between tries to join again, as for the core's restarts.
const reconnectBaseMs = 1000;
const reconnectMaxMs = 60_000;
const stableAfterMs = 30_000;

async function init(config: Config, rejoin: Target | null): Promise<void> {
  const loaded = buildRegistry([builtin, ...(await loadPlugins(config.plugins))]);
  const registry = { ...loaded, reflexes: enabledReflexes(loaded.reflexes, config.reflexes) };
  const body = new Body();
  const runner = new ActionRunner({ body, stopGraceMs });
  actions = runner;
  const reflexRunner = new ReflexRunner({ body, emit, stopGraceMs });

  // The bot of the connection that is up, with what runs on it.
  let present: { bot: Bot; stop: () => void } | undefined;
  const hooks: DialHooks = {
    onSpawn: (bot) => {
      bot.on("death", () => {
        runner.died();
      });
      const stopEventSources = startEventSources(registry.eventSources, bot, config);
      const reflexes = [...registry.reflexes.values()].map((reflex) => bind(reflex, bot));
      const reflexChecks = setInterval(() => {
        void reflexRunner.check(reflexes);
      }, reflexCheckMs);
      present = {
        bot,
        stop: () => {
          stopEventSources();
          clearInterval(reflexChecks);
        },
      };
    },
    onEnd: (bot) => {
      if (present?.bot === bot) {
        present.stop();
        present = undefined;
        runner.disconnected();
        reflexRunner.disconnected();
      }
    },
  };
  const presence = new Presence<Target>({
    dial: (target, auto, events) => dial(target, config.minecraft, auto, emit, hooks, events),
    onDisconnected: (cause, retryInMs) => {
      emit(disconnected, {
        reason: describeCause(cause),
        willReconnect: retryInMs !== null,
        retryInSeconds: retryInMs === null ? null : retryInMs / 1000,
      });
    },
    onTarget: (target) => {
      post({ type: "target", target: target ?? null });
    },
    baseDelayMs: reconnectBaseMs,
    maxDelayMs: reconnectMaxMs,
    stableAfterMs,
  });
  tools = buildTools({
    registry,
    runner,
    emit,
    config,
    presence,
    // A bot that is leaving is of no use to a tool.
    bot: () => (presence.state === "connected" ? present?.bot : undefined),
    connectWaitMs,
  });

  const eventKinds = [...connectionEventKinds, ...reflexEventKinds, ...registry.eventKinds];

  post({
    type: "ready",
    tools: [...tools.values()].map((tool) => tool.descriptor),
    eventKinds: eventKinds.map(describeEventKind),
  });
  // The core before this one was in a server when it went down.
  if (rejoin !== null) {
    void presence.resume(rejoin);
  }
}

async function call(name: string, input: unknown): Promise<CallResult> {
  const tool = tools?.get(name);
  if (tool === undefined) {
    return { ok: false, error: { code: "unknown_tool", message: `No tool is named "${name}".` } };
  }
  try {
    return await tool.call(input);
  } catch (error) {
    return { ok: false, error: { code: "failed", message: errorMessage(error) } };
  }
}

async function operate(op: ActionOperation, actionId: string): Promise<CallResult> {
  const report =
    op === "get"
      ? actions?.report(actionId)
      : op === "wait"
        ? await actions?.ended(actionId)
        : actions?.cancel(actionId);
  if (report === undefined) {
    return {
      ok: false,
      error: { code: "unknown_action", message: `No action has the ID "${actionId}".` },
    };
  }
  return { ok: true, output: report };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handle(message: GatewayToCore): Promise<void> {
  switch (message.type) {
    case "init":
      await init(message.config, message.rejoin);
      break;
    case "ping":
      post({ type: "pong" });
      break;
    case "call":
      reply(message.id, await call(message.tool, message.input));
      break;
    case "action":
      reply(message.id, await operate(message.op, message.actionId));
      break;
  }
}

function reply(id: number, result: CallResult): void {
  try {
    post({ type: "result", id, result });
  } catch (error) {
    // The output could not be copied to the gateway thread.
    post({
      type: "result",
      id,
      result: { ok: false, error: { code: "failed", message: errorMessage(error) } },
    });
  }
}

self.addEventListener("message", (event: MessageEvent<GatewayToCore>) => {
  handle(event.data).catch((error: unknown) => {
    log("error", "core", errorMessage(error));
    throw error;
  });
});
