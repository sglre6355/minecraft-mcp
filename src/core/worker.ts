import type { Config } from "../config/schema.ts";
import type { CallResult, CoreToGateway, GatewayToCore } from "../protocol/messages.ts";
import type { Emit } from "./events/event.ts";
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

const emit: Emit = (kind, payload) => {
  post({
    type: "event",
    event: { kind: kind.kind, occurredAt: new Date(), payload: kind.payload.parse(payload) },
  });
};

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
  const connection = new Connection(config.minecraft, emit, () => {
    runner.disconnected();
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
