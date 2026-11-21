import type { CallToolResult } from "@modelcontextprotocol/server";
import type { JsonObject } from "type-fest";

import { z } from "zod";

import type { EventKindDescriptor } from "../../../protocol/descriptors.ts";
import type { Delivery } from "../delivery.ts";
import type { EventLog } from "../event-log.ts";
import type { Subscription } from "./poll.ts";

import { Cursors } from "./cursors.ts";
import { collect, nextEvent } from "./poll.ts";

const input = z.object({
  kinds: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "The event kinds to read. When omitted, every kind except those read only when named.",
    ),
  filters: z
    .record(z.string(), z.record(z.string(), z.json()))
    .optional()
    .describe("Filters that narrow a kind, keyed by kind."),
  cursor: z
    .string()
    .optional()
    .describe(
      "The cursor from the previous result. Omit it on the first call to read the events on record.",
    ),
  limit: z.int().min(1).max(200).default(50).describe("The most events to return."),
  waitSeconds: z
    .number()
    .min(0)
    .max(60)
    .default(0)
    .describe("How long to wait for an event when none is new."),
});

type Input = z.infer<typeof input>;

// Lets a client that lacks the MCP Events extension fetch events with a tool call.
export function pollTool(kinds: () => ReadonlyArray<EventKindDescriptor>): Delivery {
  // Outlives the per-request servers, so a cursor from one call is known to the next.
  const cursors = new Cursors(64);
  return {
    name: "poll-tool",
    attach(server, log) {
      const known = kinds();
      server.registerTool(
        "poll_events",
        {
          description: describe(known),
          inputSchema: input,
          annotations: { readOnlyHint: true },
        },
        async (args, context) => {
          const outcome = await poll(log, cursors, known, args, context.mcpReq.signal);
          return typeof outcome === "string" ? failure(outcome) : success(outcome);
        },
      );
    },
  };
}

function describe(kinds: ReadonlyArray<EventKindDescriptor>): string {
  const lines = kinds.map((kind) => {
    const filters = kind.filters.map((filter) => filter.param);
    const filtering = filters.length === 0 ? "" : ` Filters are ${filters.join(", ")}.`;
    const naming = kind.optIn ? " Read only when named." : "";
    return `- ${kind.kind}. ${kind.description}${filtering}${naming}`;
  });
  return [
    "Read what happened in the game, oldest first. The result carries a cursor. Pass it back to read only what came after. `truncated` means some events were dropped before they could be read.",
    "The event kinds follow.",
    ...lines,
  ].join("\n");
}

interface Polled {
  events: Array<{ kind: string; occurredAt: string; payload: JsonObject }>;
  cursor: string;
  truncated: boolean;
  hasMore: boolean;
}

// Returns the reason as text when the input cannot be served.
async function poll(
  log: EventLog,
  cursors: Cursors,
  known: ReadonlyArray<EventKindDescriptor>,
  args: Input,
  signal: AbortSignal,
): Promise<Polled | string> {
  const descriptors = new Map(known.map((kind) => [kind.kind, kind]));
  const byDefault = known.flatMap((kind) => (kind.optIn ? [] : [kind.kind]));
  const wanted = new Set(args.kinds ?? byDefault);
  const subscriptions: Array<Subscription> = [];
  for (const name of wanted) {
    const descriptor = descriptors.get(name);
    if (descriptor === undefined) {
      return `No event kind is named "${name}".`;
    }
    const filterArguments = args.filters?.[name] ?? {};
    const checked = z.fromJSONSchema(descriptor.paramsSchema).safeParse(filterArguments);
    if (!checked.success) {
      return `The filters for "${name}" are invalid.\n${z.prettifyError(checked.error)}`;
    }
    subscriptions.push({ kind: name, filters: descriptor.filters, arguments: filterArguments });
  }
  const stray = Object.keys(args.filters ?? {}).find((name) => !wanted.has(name));
  if (stray !== undefined) {
    return `The filters name "${stray}", which is not among the kinds to read.`;
  }

  const positions = args.cursor === undefined ? undefined : cursors.find(args.cursor);
  // A cursor from before a restart, or one issued long ago, is no longer known.
  // What happened since then cannot be told, so the read starts over and says so.
  const forgotten = args.cursor !== undefined && positions === undefined;

  let batch = collect(log, subscriptions, positions, args.limit);
  let truncated = forgotten || batch.truncated;
  const deadline = Date.now() + args.waitSeconds * 1000;
  while (batch.events.length === 0 && !signal.aborted && Date.now() < deadline) {
    await nextEvent(log, wanted, deadline - Date.now(), signal);
    batch = collect(log, subscriptions, batch.positions, args.limit);
    truncated ||= batch.truncated;
  }

  return {
    events: batch.events.map((event) => ({
      kind: event.kind,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    })),
    cursor: cursors.issue({ ...positions, ...batch.positions }, args.cursor),
    truncated,
    hasMore: batch.hasMore,
  };
}

function success(polled: Polled): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(polled) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
