import type { CallToolResult, StandardSchemaWithJSON } from "@modelcontextprotocol/server";

import { McpServer } from "@modelcontextprotocol/server";

import type { JsonSchema, ToolDescriptor } from "../protocol/descriptors.ts";
import type { CallResult } from "../protocol/messages.ts";
import type { Delivery } from "./delivery/delivery.ts";
import type { EventLog } from "./delivery/event-log.ts";

export interface CoreTools {
  readonly tools: Array<ToolDescriptor>;
  call(tool: string, input: unknown): Promise<CallResult>;
}

export interface ServerParts {
  core: CoreTools;
  log: EventLog;
  deliveries: Array<Delivery>;
}

export function createServer({ core, log, deliveries }: ServerParts): McpServer {
  const server = new McpServer({ name: "minecraft-mcp", version: "0.0.0" });

  for (const tool of core.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: describedBy(tool.inputSchema),
        annotations: { readOnlyHint: tool.kind === "query" },
      },
      async (input) => toToolResult(await core.call(tool.name, input)),
    );
  }
  for (const delivery of deliveries) {
    delivery.attach(server, log);
  }
  return server;
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

function toToolResult(result: CallResult): CallToolResult {
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(result.error) }],
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.output) }] };
}
