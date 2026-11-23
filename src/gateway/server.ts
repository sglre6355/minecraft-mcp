import type { ProtocolEra, StandardSchemaWithJSON } from "@modelcontextprotocol/server";

import { McpServer } from "@modelcontextprotocol/server";

import type { JsonSchema, ToolDescriptor } from "../protocol/descriptors.ts";
import type { ActionCore, BlockingCalls } from "./actions.ts";
import type { Delivery } from "./delivery/delivery.ts";
import type { EventLog } from "./delivery/event-log.ts";

import { attachTasks, callAction, toToolResult } from "./actions.ts";

export interface CoreTools extends ActionCore {
  readonly tools: Array<ToolDescriptor>;
}

export interface ServerParts {
  core: CoreTools;
  log: EventLog;
  deliveries: Array<Delivery>;
  calls: BlockingCalls;
}

const instructions =
  "Actions run one at a time, in the order they were called. An action called while another is running waits its turn. When an action does not complete, the actions waiting behind it are skipped.";

// Builds the server for one request. `era` is the request's protocol era, and `request` is the
// HTTP request, if there is one.
export function createServer(
  { core, log, deliveries, calls }: ServerParts,
  era: ProtocolEra,
  request?: Request,
): McpServer {
  const server = new McpServer({ name: "minecraft-mcp", version: "0.0.0" }, { instructions });

  for (const tool of core.tools) {
    server.registerTool(
      tool.name,
      {
        description: describe(tool),
        inputSchema: describedBy(tool.inputSchema),
        annotations: { readOnlyHint: tool.kind === "query" },
      },
      async (input, context) =>
        tool.kind === "action"
          ? callAction(core, calls, tool.name, input, context, request)
          : toToolResult(await core.call(tool.name, input)),
    );
  }
  attachTasks(server, core, calls, era);
  for (const delivery of deliveries) {
    delivery.attach(server, log, era);
  }
  return server;
}

// MCP has no field for the shape of progress, so the description carries it to the model.
function describe(tool: ToolDescriptor): string {
  if (tool.progressSchema === undefined) {
    return tool.description;
  }
  const schema = JSON.stringify(tool.progressSchema, (key, value: unknown) =>
    key === "$schema" ? undefined : value,
  );
  return `${tool.description}\nWhile it runs, it reports progress as JSON that follows this schema. ${schema}`;
}

// Shows the schema to the client and lets every input through.
// The core owns the schemas and validates there.
function describedBy(schema: JsonSchema): StandardSchemaWithJSON {
  return {
    "~standard": {
      version: 1,
      vendor: "minecraft-mcp",
      validate: (value) => ({ value }),
      jsonSchema: { input: () => schema, output: () => schema },
    },
  };
}
