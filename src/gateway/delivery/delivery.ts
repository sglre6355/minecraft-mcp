import type { McpServer } from "@modelcontextprotocol/server";

import type { EventLog } from "./event-log.ts";

// A way to hand recorded events to the agent.
// The SDK builds a server for each request, so `attach` runs once per request.
export interface Delivery {
  name: string;
  attach(server: McpServer, log: EventLog): void;
}
