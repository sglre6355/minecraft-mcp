import type { JsonObject } from "type-fest";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { EventKindDescriptor, ToolDescriptor } from "../protocol/descriptors.ts";

import { EventLog } from "./delivery/event-log.ts";
import { pollTool } from "./delivery/poll-tool/poll-tool.ts";
import { createServer } from "./server.ts";

const noSchema = z.toJSONSchema(z.object({}));

const eventKinds: Array<EventKindDescriptor> = [
  {
    kind: "chat.message",
    description: "Someone spoke.",
    payloadSchema: noSchema,
    paramsSchema: noSchema,
    filters: [],
    optIn: false,
  },
  {
    kind: "body.damage",
    description: "The bot was hurt.",
    payloadSchema: noSchema,
    paramsSchema: z.toJSONSchema(z.strictObject({ minAmount: z.number().optional() })),
    filters: [{ param: "minAmount", field: "amount", op: "gte" }],
    optIn: false,
  },
  {
    kind: "action.progress",
    description: "An action moved on.",
    payloadSchema: noSchema,
    paramsSchema: noSchema,
    filters: [],
    optIn: true,
  },
];

const moveTo: ToolDescriptor = {
  kind: "action",
  name: "move_to",
  description: "Walk to a position.",
  inputSchema: noSchema,
  progressSchema: z.toJSONSchema(z.object({ distance: z.number() })),
};

// The real SDK serves the requests in this process. Nothing listens on a port.
function serve(tools: Array<ToolDescriptor> = []) {
  const log = new EventLog(8);
  const deliveries = [pollTool(() => eventKinds)];
  const handler = createMcpHandler((context) =>
    createServer(
      { core: { tools, call: () => Promise.resolve({ ok: true, output: null }) }, log, deliveries },
      context.era,
    ),
  );
  const request = async (method: string, params: JsonObject) => {
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const text = await response.text();
    return answer.parse(JSON.parse(text.slice(text.indexOf("{"))));
  };
  const poll = async (args: JsonObject) => {
    const { result } = await request("tools/call", { name: "poll_events", arguments: args });
    const text = result.content?.[0]?.text ?? "";
    return result.isError === true ? { error: text } : { polled: polled.parse(JSON.parse(text)) };
  };
  return { log, request, poll };
}

const answer = z.object({
  result: z.object({
    tools: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    content: z.array(z.object({ text: z.string() })).optional(),
    isError: z.boolean().optional(),
  }),
});

const polled = z.object({
  events: z.array(
    z.object({ kind: z.string(), occurredAt: z.string(), payload: z.record(z.string(), z.json()) }),
  ),
  cursor: z.string(),
  truncated: z.boolean(),
  hasMore: z.boolean(),
});

function chat(text: string) {
  return { kind: "chat.message", occurredAt: new Date(0), payload: { text } };
}

function damage(amount: number) {
  return { kind: "body.damage", occurredAt: new Date(0), payload: { amount } };
}

function progress(distance: number) {
  return { kind: "action.progress", occurredAt: new Date(0), payload: { distance } };
}

describe("createServer", () => {
  test("puts the shape of an action's progress into the tool description", async () => {
    const { request } = serve([moveTo]);

    const { result } = await request("tools/list", {});
    const description = result.tools?.find((tool) => tool.name === "move_to")?.description;

    expect(description).toStartWith("Walk to a position.\n");
    expect(description).toContain('"distance":{"type":"number"}');
    expect(description).not.toContain("$schema");
  });

  test("refuses a core tool that takes the name of a delivery's tool", () => {
    const clash: ToolDescriptor = { ...moveTo, name: "poll_events" };

    expect(() =>
      createServer(
        {
          core: { tools: [clash], call: () => Promise.resolve({ ok: true, output: null }) },
          log: new EventLog(8),
          deliveries: [pollTool(() => eventKinds)],
        },
        "legacy",
      ),
    ).toThrow("poll_events");
  });
});

describe("poll_events", () => {
  test("lists the event kinds and their filters in its description", async () => {
    const { request } = serve();

    const { result } = await request("tools/list", {});
    const description = result.tools?.find((tool) => tool.name === "poll_events")?.description;

    expect(description).toContain("- chat.message. Someone spoke.");
    expect(description).toContain("- body.damage. The bot was hurt. Filters are minAmount.");
    expect(description).toContain("- action.progress. An action moved on. Read only when named.");
  });

  test("leaves a kind that is read only when named out of a call that names no kinds", async () => {
    const { log, poll } = serve();
    log.append(chat("a"));
    log.append(progress(12));

    const { polled } = await poll({});

    expect(polled?.events.map((event) => event.kind)).toEqual(["chat.message"]);
  });

  test("does not end a wait for a kind that is read only when named", async () => {
    const { log, poll } = serve();
    setTimeout(() => log.append(progress(12)), 10);
    setTimeout(() => log.append(chat("late")), 60);

    const { polled } = await poll({ waitSeconds: 5 });

    expect(polled?.events.map((event) => event.kind)).toEqual(["chat.message"]);
  });

  test("reads a kind that is read only when named once it is named", async () => {
    const { log, poll } = serve();
    log.append(progress(12));

    const { polled } = await poll({ kinds: ["action.progress"] });

    expect(polled?.events.map((event) => event.payload)).toEqual([{ distance: 12 }]);
  });

  test("returns the events on record on the first call, with the time as text", async () => {
    const { log, poll } = serve();
    log.append(chat("hello"));

    const { polled } = await poll({});

    expect(polled?.events).toEqual([
      { kind: "chat.message", occurredAt: "1970-01-01T00:00:00.000Z", payload: { text: "hello" } },
    ]);
    expect(polled?.truncated).toBe(false);
  });

  test("returns only what is new when given the cursor back", async () => {
    const { log, poll } = serve();
    log.append(chat("a"));
    const first = await poll({});
    log.append(chat("b"));

    const second = await poll({ cursor: first.polled?.cursor ?? "" });

    expect(second.polled?.events.map((event) => event.payload)).toEqual([{ text: "b" }]);
  });

  test("reads only the kinds it is asked for", async () => {
    const { log, poll } = serve();
    log.append(chat("a"));
    log.append(damage(1));

    const { polled } = await poll({ kinds: ["body.damage"] });

    expect(polled?.events.map((event) => event.kind)).toEqual(["body.damage"]);
  });

  test("keeps the position of a kind it was not asked for this time", async () => {
    const { log, poll } = serve();
    log.append(chat("a"));
    const first = await poll({});
    log.append(damage(1));
    const second = await poll({ kinds: ["body.damage"], cursor: first.polled?.cursor ?? "" });

    const third = await poll({ cursor: second.polled?.cursor ?? "" });

    expect(third.polled?.events).toEqual([]);
  });

  test("narrows a kind with its filters", async () => {
    const { log, poll } = serve();
    log.append(damage(1));
    log.append(damage(6));

    const { polled } = await poll({ filters: { "body.damage": { minAmount: 4 } } });

    expect(polled?.events.map((event) => event.payload)).toEqual([{ amount: 6 }]);
  });

  test("waits for an event when none is new", async () => {
    const { log, poll } = serve();
    setTimeout(() => log.append(chat("late")), 30);

    const { polled } = await poll({ waitSeconds: 5 });

    expect(polled?.events.map((event) => event.payload)).toEqual([{ text: "late" }]);
    expect(log.listenerCount).toBe(0);
  });

  test("answers empty when the wait ends with nothing new", async () => {
    const { log, poll } = serve();

    const { polled } = await poll({ waitSeconds: 0.05 });

    expect(polled?.events).toEqual([]);
    expect(log.listenerCount).toBe(0);
  });

  test("treats a cursor from another run of the server as truncated", async () => {
    const earlier = serve();
    earlier.log.append(chat("old"));
    const stale = await earlier.poll({});
    const { log, poll } = serve();
    log.append(chat("new"));

    const { polled } = await poll({ cursor: stale.polled?.cursor ?? "" });

    expect(polled?.events.map((event) => event.payload)).toEqual([{ text: "new" }]);
    expect(polled?.truncated).toBe(true);
  });

  test("issues a short cursor, and the same one while nothing is new", async () => {
    const { log, poll } = serve();
    log.append(chat("a"));

    const first = await poll({});
    const second = await poll({ cursor: first.polled?.cursor ?? "" });

    expect(first.polled?.cursor).toMatch(/^[\da-f]{8}$/);
    expect(second.polled?.cursor).toBe(first.polled?.cursor);
  });

  test("rejects an event kind it does not know", async () => {
    const { poll } = serve();

    expect(await poll({ kinds: ["weather.rain"] })).toEqual({
      error: 'No event kind is named "weather.rain".',
    });
  });

  test("rejects filters the kind does not accept", async () => {
    const { poll } = serve();

    const { error } = await poll({ filters: { "body.damage": { minAmount: "lots" } } });

    expect(error).toStartWith('The filters for "body.damage" are invalid.');
  });

  test("rejects filters for a kind that is not being read", async () => {
    const { poll } = serve();

    expect(
      await poll({ kinds: ["chat.message"], filters: { "body.damage": { minAmount: 1 } } }),
    ).toEqual({ error: 'The filters name "body.damage", which is not among the kinds to read.' });
  });
});
