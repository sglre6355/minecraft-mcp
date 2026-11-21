import type { Result, ServerContext } from "@modelcontextprotocol/server";

import {
  ProtocolError,
  ProtocolErrorCode,
  SUBSCRIPTION_ID_META_KEY,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { EventKindDescriptor } from "../../../protocol/descriptors.ts";
import type { Delivery } from "../delivery.ts";
import type { EventLog, RecordedEvent } from "../event-log.ts";
import type { Subscription } from "./read.ts";

import { matches } from "../filter.ts";
import { encodeCursor, locate, page } from "./read.ts";

const extension = "io.modelcontextprotocol/events";

// The specification names this code NotFound and calls the number provisional.
const notFound = -32_023;

const subscription = {
  name: z.string(),
  arguments: z.record(z.string(), z.json()).optional(),
  cursor: z.string().nullish(),
  maxAgeMs: z.int().min(0).optional(),
};
const pollParams = z.object({ ...subscription, maxEvents: z.int().min(1).optional() });
const streamParams = z.object({ ...subscription, heartbeatMs: z.int().min(1).optional() });

type SubscriptionParams = z.infer<z.ZodObject<typeof subscription>>;

export interface McpEventsOptions {
  kinds: () => ReadonlyArray<EventKindDescriptor>;
  // The shortest heartbeat interval a client may ask for.
  minHeartbeatMs?: number;
}

const defaultHeartbeatMs = 30_000;
const maxHeartbeatMs = 60_000;
const defaultMaxEvents = 50;
const mostEvents = 200;
// Events are in memory, so a poll is cheap and the client may poll often.
const nextPollMs = 1000;

// Implements the MCP Events extension, with poll and push delivery.
// https://modelcontextprotocol.io/seps/3415-events-extension
export function mcpEvents({ kinds, minHeartbeatMs = 1000 }: McpEventsOptions): Delivery {
  return {
    name: "mcp-events",
    attach(server, log, era) {
      // The extension is defined for the 2026-07-28 revision onward.
      if (era !== "modern") {
        return;
      }
      const known = kinds();
      const protocol = server.server;
      protocol.registerCapabilities({ extensions: { [extension]: {} } });

      protocol.setRequestHandler("events/list", { params: z.object({}) }, () => ({
        events: known.map((kind) => ({
          name: kind.kind,
          description: kind.description,
          delivery: ["poll", "push"],
          inputSchema: kind.paramsSchema,
          payloadSchema: kind.payloadSchema,
        })),
      }));

      protocol.setRequestHandler("events/poll", { params: pollParams }, (params) => {
        const subscribed = resolve(known, params);
        const start = locate(log, params.name, params.cursor, params.maxAgeMs, Date.now());
        const limit = Math.min(params.maxEvents ?? defaultMaxEvents, mostEvents);
        const next = page(log, subscribed, start.after, limit);
        // After a gap the client first learns where delivery resumes, and polls again from there.
        return start.truncated
          ? {
              events: [],
              cursor: encodeCursor(log.epoch, start.after),
              truncated: true,
              hasMore: next.events.length > 0,
              nextPollMs,
            }
          : {
              events: next.events.map((event) => occurrence(log, event)),
              cursor: encodeCursor(log.epoch, next.after),
              truncated: false,
              hasMore: next.hasMore,
              nextPollMs,
            };
      });

      protocol.setRequestHandler("events/stream", { params: streamParams }, (params, context) => {
        const subscribed = resolve(known, params);
        const wanted = params.heartbeatMs ?? defaultHeartbeatMs;
        const heartbeatMs = Math.min(Math.max(wanted, minHeartbeatMs), maxHeartbeatMs);
        return stream(log, subscribed, params, heartbeatMs, context);
      });
    },
  };
}

// Finds the event kind and checks the arguments against its schema.
function resolve(
  known: ReadonlyArray<EventKindDescriptor>,
  params: SubscriptionParams,
): Subscription {
  const descriptor = known.find((kind) => kind.kind === params.name);
  if (descriptor === undefined) {
    throw new ProtocolError(notFound, "NotFound", { kind: "event" });
  }
  const given = params.arguments ?? {};
  const checked = z.fromJSONSchema(descriptor.paramsSchema).safeParse(given);
  if (!checked.success) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      `The arguments do not match the inputSchema of "${params.name}".\n${z.prettifyError(checked.error)}`,
    );
  }
  return { kind: descriptor.kind, filters: descriptor.filters, arguments: given };
}

function occurrence(log: EventLog, event: RecordedEvent) {
  return {
    // The same event carries the same ID through poll and through push.
    eventId: `${log.epoch}.${event.order}`,
    name: event.kind,
    timestamp: event.occurredAt.toISOString(),
    data: event.payload,
  };
}

// Serves one push subscription until the client goes away.
async function stream(
  log: EventLog,
  subscribed: Subscription,
  params: SubscriptionParams,
  heartbeatMs: number,
  context: ServerContext,
): Promise<Result> {
  const { signal, notify } = context.mcpReq;
  const meta = { [SUBSCRIPTION_ID_META_KEY]: context.mcpReq.id };
  const start = locate(log, subscribed.kind, params.cursor, params.maxAgeMs, Date.now());

  // The backlog is read and the listener attached in the same tick, so no event falls between.
  const pending = log.read(subscribed.kind, start.after).events;
  let woken = Promise.withResolvers<void>();
  const leave = log.subscribe((event) => {
    if (event.kind === subscribed.kind) {
      pending.push(event);
      woken.resolve();
    }
  });

  let position = start.after;
  try {
    await notify({
      method: "notifications/events/active",
      params: {
        cursor: encodeCursor(log.epoch, position),
        truncated: start.truncated,
        heartbeatMs,
        _meta: meta,
      },
    });
    let lastSent = Date.now();
    while (!signal.aborted) {
      const event = pending.shift();
      if (event !== undefined) {
        position = event.seq;
        if (matches(subscribed.filters, subscribed.arguments, event.payload)) {
          await notify({
            method: "notifications/events/event",
            params: {
              ...occurrence(log, event),
              cursor: encodeCursor(log.epoch, position),
              _meta: meta,
            },
          });
          lastSent = Date.now();
        }
        continue;
      }
      const quietMs = Date.now() - lastSent;
      if (quietMs >= heartbeatMs) {
        // The cursor moves past events the arguments excluded, so the client's copy stays fresh.
        await notify({
          method: "notifications/events/heartbeat",
          params: { cursor: encodeCursor(log.epoch, position), _meta: meta },
        });
        lastSent = Date.now();
        continue;
      }
      woken = Promise.withResolvers();
      await idle(woken.promise, heartbeatMs - quietMs, signal);
    }
  } catch (error) {
    // Writing to a client that has gone away fails. That is how the stream ends.
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    leave();
  }
  return { _meta: meta };
}

// Resolves when woken, when the time is up, or when the signal aborts.
function idle(woken: Promise<void>, ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const end = () => {
    resolve();
  };
  const timer = setTimeout(end, ms);
  signal.addEventListener("abort", end, { once: true });
  void woken.then(end);
  return promise.finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", end);
  });
}
