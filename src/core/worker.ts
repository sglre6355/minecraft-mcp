import type { Bot } from "mineflayer";

import type { Config } from "../config/schema.ts";
import type { CallResult, CoreToGateway, GatewayToCore } from "../protocol/messages.ts";
import type { Emit, EventSourceDefinition } from "./events/event.ts";
import type { Tool } from "./tools.ts";

import { log } from "../log.ts";
import { ActionRunner, actionEventKinds } from "./action-runner.ts";
import { Body } from "./body.ts";
import { builtin } from "./builtin.ts";
import { Connection, connectionEventKinds } from "./connection.ts";
import { describeEventKind } from "./events/event.ts";
import { buildRegistry, loadPlugins } from "./plugins.ts";
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

// An action told to stop keeps the body for at most this long.
const stopGraceMs = 2000;

let tools: Map<string, Tool> | undefined;

async function init(config: Config): Promise<void> {
  const registry = buildRegistry([builtin, ...(await loadPlugins(config.plugins))]);
  const runner = new ActionRunner({
    body: new Body(),
    emit,
    waitMs: config.actions.waitMs,
    stopGraceMs,
  });
  let stopEventSources: (() => void) | undefined;
  const connection = new Connection(config.minecraft, emit, {
    onSpawn: (bot) => {
      stopEventSources = startEventSources(registry.eventSources, bot, config);
    },
    onEnd: () => {
      stopEventSources?.();
      stopEventSources = undefined;
      runner.disconnected();
    },
  });
  tools = buildTools({ registry, runner, emit, bot: () => connection.bot });

  const eventKinds = [...connectionEventKinds, ...actionEventKinds, ...registry.eventKinds];

  connection.connect();
  post({
    type: "ready",
    tools: [...tools.values()].map((tool) => tool.descriptor),
    eventKinds: eventKinds.map(describeEventKind),
  });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handle(message: GatewayToCore): Promise<void> {
  switch (message.type) {
    case "init":
      await init(message.config);
      break;
    case "ping":
      post({ type: "pong" });
      break;
    case "call": {
      const result = await call(message.tool, message.input);
      try {
        post({ type: "result", id: message.id, result });
      } catch (error) {
        // The output could not be copied to the gateway thread.
        post({
          type: "result",
          id: message.id,
          result: { ok: false, error: { code: "failed", message: errorMessage(error) } },
        });
      }
      break;
    }
  }
}

self.addEventListener("message", (event: MessageEvent<GatewayToCore>) => {
  handle(event.data).catch((error: unknown) => {
    log("error", "core", errorMessage(error));
    throw error;
  });
});
