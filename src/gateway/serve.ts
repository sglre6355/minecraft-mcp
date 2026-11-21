import { createMcpHandler } from "@modelcontextprotocol/server";

import type { Config } from "../config/schema.ts";

import { log } from "../log.ts";
import { createAuthGate } from "./auth.ts";
import { EventLog } from "./delivery/event-log.ts";
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

export async function serve({ config, token }: ServeOptions): Promise<Running> {
  const events = new EventLog(config.events.capacity);
  const supervisor = new Supervisor({
    workerUrl: new URL("../core/worker.ts", import.meta.url),
    config,
    onEvent: (event) => {
      events.append(event);
      log("info", "event", event.kind, { payload: event.payload });
    },
  });
  await supervisor.start();

  const handler = createMcpHandler(
    () => createServer({ core: supervisor, log: events, deliveries: [] }),
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
