import type { JsonObject } from "type-fest";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import type { EventKindDescriptor } from "../../../protocol/descriptors.ts";

import { createServer } from "../../server.ts";
import { EventLog } from "../event-log.ts";
import { mcpEvents } from "./mcp-events.ts";

const extension = "io.modelcontextprotocol/events";
const subscriptionId = "io.modelcontextprotocol/subscriptionId";

const damageKind: EventKindDescriptor = {
  kind: "body.damage",
  description: "The bot was hurt.",
  payloadSchema: z.toJSONSchema(z.object({ amount: z.number() })),
  paramsSchema: z.toJSONSchema(z.strictObject({ minAmount: z.number().optional() })),
  filters: [{ param: "minAmount", field: "amount", op: "gte" }],
  optIn: false,
};
const eventKinds = [damageKind];

function damage(amount: number) {
  return { kind: "body.damage", occurredAt: new Date(0), payload: { amount } };
}

const occurrence = z.object({
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.json()),
  cursor: z.string().optional(),
});
const listed = z.object({ events: z.array(z.record(z.string(), z.json())) });
const polled = z.object({
  events: z.array(occurrence),
  cursor: z.string(),
  truncated: z.boolean(),
  hasMore: z.boolean(),
  nextPollMs: z.number(),
});
const frame = z.looseObject({ _meta: z.record(z.string(), z.json()) });

const clients: Array<Client> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

// The official client talks to the real SDK server in this process. Nothing listens on a port.
async function connect(era: "modern" | "legacy" = "modern") {
  const log = new EventLog(4);
  const deliveries = [mcpEvents({ kinds: () => eventKinds, minHeartbeatMs: 20 })];
  const handler = createMcpHandler((context) =>
    createServer(
      {
        core: { tools: [], call: () => Promise.resolve({ ok: true, output: null }) },
        log,
        deliveries,
      },
      context.era,
    ),
  );
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(String(url), init)),
  });
  const client = new Client(
    { name: "test", version: "0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  await client.connect(transport);
  clients.push(client);

  const poll = (params: JsonObject) => client.request({ method: "events/poll", params }, polled);

  // Opens a push stream and collects what arrives on it.
  const open = (params: JsonObject) => {
    const frames: Array<{ method: string; params: z.infer<typeof frame> }> = [];
    for (const kind of ["active", "event", "heartbeat"]) {
      const method = `notifications/events/${kind}`;
      client.setNotificationHandler(method, { params: frame }, (received) => {
        frames.push({ method, params: received });
      });
    }
    const abandon = new AbortController();
    const ended = client
      .request({ method: "events/stream", params }, z.looseObject({}), {
        signal: abandon.signal,
        timeout: 60_000,
      })
      .then(
        () => "ended",
        () => "abandoned",
      );
    return { frames, abandon, ended };
  };

  return { log, client, poll, open };
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("the condition did not hold in time");
    }
    await Bun.sleep(5);
  }
}

const failure = z.object({
  code: z.number(),
  data: z.record(z.string(), z.json()).optional(),
});

// The JSON-RPC error a request was answered with.
async function rejection(promise: Promise<unknown>): Promise<z.infer<typeof failure>> {
  const answer: unknown = await promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (error: unknown) => error,
  );
  return failure.parse(answer);
}

describe("mcp-events", () => {
  test("declares the extension to a client of the 2026-07-28 revision", async () => {
    const { client } = await connect();

    expect(client.getServerCapabilities()?.extensions).toEqual({ [extension]: {} });
  });

  test("stays out of the way of a client of an earlier revision", async () => {
    const { client } = await connect("legacy");

    const error = await rejection(
      client.request({ method: "events/list", params: {} }, z.looseObject({})),
    );

    expect(client.getServerCapabilities()?.extensions).toBeUndefined();
    expect(error).toMatchObject({ code: -32_601 });
  });

  test("lists the event types with their schemas and delivery modes", async () => {
    const { client } = await connect();

    const result = await client.request({ method: "events/list", params: {} }, listed);

    expect<unknown>(result.events).toEqual([
      {
        name: "body.damage",
        description: "The bot was hurt.",
        delivery: ["poll", "push"],
        inputSchema: damageKind.paramsSchema,
        payloadSchema: damageKind.payloadSchema,
      },
    ]);
  });
});

describe("events/poll", () => {
  test("starts from now when the client has no cursor", async () => {
    const { log, poll } = await connect();
    log.append(damage(1));

    const first = await poll({ name: "body.damage" });
    const explicit = await poll({ name: "body.damage", cursor: null });

    expect(first).toMatchObject({ events: [], truncated: false, hasMore: false });
    expect(explicit.cursor).toBe(first.cursor);
  });

  test("returns what happened after the cursor", async () => {
    const { log, poll } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    log.append(damage(3));

    const result = await poll({ name: "body.damage", cursor });

    expect(result.events).toEqual([
      {
        eventId: expect.any(String),
        name: "body.damage",
        timestamp: "1970-01-01T00:00:00.000Z",
        data: { amount: 3 },
      },
    ]);
    expect(result.cursor).not.toBe(cursor);
    expect(result.truncated).toBe(false);
  });

  test("returns at most maxEvents and says that more remain", async () => {
    const { log, poll } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    log.append(damage(1));
    log.append(damage(2));
    log.append(damage(3));

    const first = await poll({ name: "body.damage", cursor, maxEvents: 2 });
    const rest = await poll({ name: "body.damage", cursor: first.cursor, maxEvents: 2 });

    expect(first.events.map((event) => event.data)).toEqual([{ amount: 1 }, { amount: 2 }]);
    expect(first.hasMore).toBe(true);
    expect(rest.events.map((event) => event.data)).toEqual([{ amount: 3 }]);
    expect(rest.hasMore).toBe(false);
  });

  test("narrows the events with the subscription's arguments", async () => {
    const { log, poll } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    log.append(damage(1));
    log.append(damage(6));

    const result = await poll({ name: "body.damage", arguments: { minAmount: 4 }, cursor });

    expect(result.events.map((event) => event.data)).toEqual([{ amount: 6 }]);
  });

  test("reports a gap, and resumes from there on the next poll", async () => {
    const { log, poll } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    for (const amount of [1, 2, 3, 4, 5, 6]) {
      log.append(damage(amount));
    }

    const gap = await poll({ name: "body.damage", cursor });
    const resumed = await poll({ name: "body.damage", cursor: gap.cursor });

    expect(gap).toMatchObject({ events: [], truncated: true, hasMore: true });
    expect(resumed.events.map((event) => event.data)).toEqual([
      { amount: 3 },
      { amount: 4 },
      { amount: 5 },
      { amount: 6 },
    ]);
    expect(resumed.truncated).toBe(false);
  });

  test("treats a cursor it did not issue as a gap, not as an error", async () => {
    const { poll } = await connect();

    const result = await poll({ name: "body.damage", cursor: "historyId_99842" });

    expect(result).toMatchObject({ events: [], truncated: true });
  });

  test("answers NotFound for an event name it does not offer", async () => {
    const { poll } = await connect();

    const error = await rejection(poll({ name: "weather.rain" }));

    expect(error).toMatchObject({ code: -32_023, data: { kind: "event" } });
  });

  test("answers InvalidParams for arguments the event type does not accept", async () => {
    const { poll } = await connect();

    const error = await rejection(poll({ name: "body.damage", arguments: { minAmount: "lots" } }));

    expect(error).toMatchObject({ code: -32_602 });
  });
});

describe("events/stream", () => {
  test("confirms the subscription first, then delivers events as they happen", async () => {
    const { log, open } = await connect();
    const { frames, abandon } = open({ name: "body.damage", heartbeatMs: 60_000 });
    await until(() => frames.length === 1);

    log.append(damage(3));
    await until(() => frames.length === 2);
    abandon.abort();

    expect(frames[0]).toMatchObject({
      method: "notifications/events/active",
      params: { cursor: expect.any(String), truncated: false, heartbeatMs: 60_000 },
    });
    expect(frames[1]).toMatchObject({
      method: "notifications/events/event",
      params: {
        eventId: expect.any(String),
        name: "body.damage",
        timestamp: "1970-01-01T00:00:00.000Z",
        data: { amount: 3 },
        cursor: expect.any(String),
      },
    });
    expect(frames[1]?.params._meta[subscriptionId]).toBe(frames[0]?.params._meta[subscriptionId]);
  });

  test("replays what happened after the cursor the client brings", async () => {
    const { log, poll, open } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    log.append(damage(1));
    log.append(damage(2));

    const { frames, abandon } = open({ name: "body.damage", cursor, heartbeatMs: 60_000 });
    await until(() => frames.length === 3);
    abandon.abort();

    expect(frames.map((received) => received.params["data"])).toEqual([
      undefined,
      { amount: 1 },
      { amount: 2 },
    ]);
  });

  test("gives an event the same ID as a poll does", async () => {
    const { log, poll, open } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    log.append(damage(1));

    const { frames, abandon } = open({ name: "body.damage", cursor, heartbeatMs: 60_000 });
    await until(() => frames.length === 2);
    abandon.abort();
    const viaPoll = await poll({ name: "body.damage", cursor });

    expect(frames[1]?.params["eventId"]).toBe(viaPoll.events[0]?.eventId);
  });

  test("sends a heartbeat when it is quiet, with a cursor past the events it left out", async () => {
    const { log, poll, open } = await connect();
    const { frames, abandon } = open({
      name: "body.damage",
      arguments: { minAmount: 4 },
      heartbeatMs: 20,
    });
    await until(() => frames.length === 1);

    log.append(damage(1));
    await until(() => frames.some((received) => received.method.endsWith("/heartbeat")));
    abandon.abort();
    const heartbeat = frames.find((received) => received.method.endsWith("/heartbeat"));
    const after = await poll({ name: "body.damage", cursor: String(heartbeat?.params["cursor"]) });

    expect(frames[0]?.params["heartbeatMs"]).toBe(20);
    expect(frames.every((received) => !received.method.endsWith("/event"))).toBe(true);
    expect(after.events).toEqual([]);
  });

  test("keeps the heartbeat interval a client asks for within its bounds", async () => {
    const { open } = await connect();
    const { frames, abandon } = open({ name: "body.damage", heartbeatMs: 1 });
    await until(() => frames.length === 1);
    abandon.abort();

    expect(frames[0]?.params["heartbeatMs"]).toBe(20);
  });

  test("announces a gap when the cursor fell off the record", async () => {
    const { log, poll, open } = await connect();
    const { cursor } = await poll({ name: "body.damage" });
    for (const amount of [1, 2, 3, 4, 5, 6]) {
      log.append(damage(amount));
    }

    const { frames, abandon } = open({ name: "body.damage", cursor, heartbeatMs: 60_000 });
    await until(() => frames.length === 5);
    abandon.abort();

    expect(frames[0]?.params["truncated"]).toBe(true);
    expect(frames.slice(1).map((received) => received.params["data"])).toEqual([
      { amount: 3 },
      { amount: 4 },
      { amount: 5 },
      { amount: 6 },
    ]);
  });

  test("lets go of the event log when the client goes away", async () => {
    const { log, open } = await connect();
    const { frames, abandon, ended } = open({ name: "body.damage", heartbeatMs: 60_000 });
    await until(() => frames.length === 1);
    expect(log.listenerCount).toBe(1);

    abandon.abort();
    await ended;
    await until(() => log.listenerCount === 0);

    expect(log.listenerCount).toBe(0);
  });

  test("answers NotFound without opening a stream for an unknown event name", async () => {
    const { log, open } = await connect();

    const { frames, ended } = open({ name: "weather.rain" });

    expect(await ended).toBe("abandoned");
    expect(frames).toEqual([]);
    expect(log.listenerCount).toBe(0);
  });
});
