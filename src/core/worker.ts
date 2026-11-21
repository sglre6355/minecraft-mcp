import { z } from "zod";

import type { Config } from "../config/schema.ts";
import type { ToolDescriptor } from "../protocol/descriptors.ts";
import type { CallResult, CoreToGateway, GatewayToCore } from "../protocol/messages.ts";
import type { Emit } from "./events/event.ts";
import type { Registry } from "./plugins.ts";

import { log } from "../log.ts";
import { builtin } from "./builtin.ts";
import { Connection, connectionEventKinds } from "./connection.ts";
import { describeEventKind } from "./events/event.ts";
import { buildRegistry, loadPlugins } from "./plugins.ts";

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

interface Core {
  registry: Registry;
  connection: Connection;
}

let core: Core | undefined;

async function init(config: Config): Promise<void> {
  const registry = buildRegistry([builtin, ...(await loadPlugins(config.plugins))]);
  const connection = new Connection(config.minecraft, emit);
  core = { registry, connection };

  const tools: Array<ToolDescriptor> = [...registry.queries.values()].map((query) => ({
    kind: "query",
    name: query.name,
    description: query.description,
    inputSchema: z.toJSONSchema(query.input, { io: "input" }),
  }));
  const eventKinds = [...connectionEventKinds, ...registry.eventKinds].map(describeEventKind);

  connection.connect();
  post({ type: "ready", tools, eventKinds });
}

async function call(tool: string, input: unknown): Promise<CallResult> {
  const query = core?.registry.queries.get(tool);
  if (core === undefined || query === undefined) {
    return { ok: false, error: { code: "unknown_tool", message: `No tool is named "${tool}".` } };
  }
  try {
    const parsed = await query.input.safeParseAsync(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "invalid_input", message: z.prettifyError(parsed.error) },
      };
    }
    const bot = core.connection.bot;
    if (bot === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "The bot is not in the Minecraft server." },
      };
    }
    return { ok: true, output: await query.run({ bot }, parsed.data) };
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
