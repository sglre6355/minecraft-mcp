import { createMcpHandler } from "@modelcontextprotocol/server";

import type { Config } from "../config/schema.ts";
import type { Delivery } from "./delivery/delivery.ts";
import type { ServerParts } from "./server.ts";

import { log } from "../log.ts";
import { BlockingCalls } from "./actions.ts";
import { createAuthGate } from "./auth.ts";
import { EventLog } from "./delivery/event-log.ts";
import { mcpEvents } from "./delivery/mcp-events/mcp-events.ts";
import { pollTool } from "./delivery/poll-tool/poll-tool.ts";
import { createServer } from "./server.ts";
import { Supervisor } from "./supervisor.ts";

export interface ServeOptions {
  config: Config;
  token: string;
}

export interface Running {
  url: URL;
  stop(): Promise<void>;
}

function createDelivery(name: Config["delivery"][number], supervisor: Supervisor): Delivery {
  switch (name) {
    case "poll-tool":
      return pollTool(() => supervisor.eventKinds);
    case "mcp-events":
      return mcpEvents({ kinds: () => supervisor.eventKinds });
  }
}

export async function serve({ config, token }: ServeOptions): Promise<Running> {
  const events = new EventLog(config.events.capacity);
  const supervisor = new Supervisor({
    workerUrl: new URL("../core/worker.ts", import.meta.url),
    config,
    onEvent: (event) => {
      events.append(event);
      // The payload stays out of the log. It can hold what players wrote in chat.
      log("info", "event", event.kind);
    },
  });
  await supervisor.start();

  const parts: ServerParts = {
    core: supervisor,
    log: events,
    deliveries: [...new Set(config.delivery)].map((name) => createDelivery(name, supervisor)),
    calls: new BlockingCalls(),
  };
  try {
    // A tool name claimed twice fails here, at startup, instead of on every request.
    createServer(parts, "legacy");
    createServer(parts, "modern");
  } catch (error) {
    supervisor.stop();
    throw error;
  }

  const handler = createMcpHandler(
    (context) => createServer(parts, context.era, context.requestInfo),
    {
      onerror: (error) => {
        log("error", "mcp", error.message);
      },
    },
  );
  const gate = createAuthGate(token);

  const http = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    // Event streams stay open with no traffic for long stretches.
    idleTimeout: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/mcp") {
        return new Response("Not found", { status: 404 });
      }
      const auth = await gate(request);
      if (!auth.ok) {
        return auth.response;
      }
      return handler.fetch(request, { authInfo: auth.authInfo });
    },
  });
  const url = new URL("/mcp", http.url);
  log("info", "gateway", "listening", { url: url.href });

  return {
    url,
    async stop() {
      await http.stop(true);
      await handler.close();
      supervisor.stop();
    },
  };
}
