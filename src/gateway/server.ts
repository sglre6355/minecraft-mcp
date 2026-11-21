import type {
  CallToolResult,
  ProtocolEra,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

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

// Builds the server for one request. `era` is the protocol era of that request.
export function createServer({ core, log, deliveries }: ServerParts, era: ProtocolEra): McpServer {
  const server = new McpServer({ name: "minecraft-mcp", version: "0.0.0" });

  for (const tool of core.tools) {
    server.registerTool(
      tool.name,
      {
        description: describe(tool),
        inputSchema: describedBy(tool.inputSchema),
        annotations: { readOnlyHint: tool.kind === "query" },
      },
      async (input) => toToolResult(await core.call(tool.name, input)),
    );
  }
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

function toToolResult(result: CallResult): CallToolResult {
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(result.error) }],
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.output) }] };
}
