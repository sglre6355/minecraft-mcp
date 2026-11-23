import type { JsonObject, JsonValue } from "type-fest";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { ToolDescriptor } from "../protocol/descriptors.ts";
import type { ActionOperation, CallResult } from "../protocol/messages.ts";

import { BlockingCalls } from "./actions.ts";
import { EventLog } from "./delivery/event-log.ts";
import { createServer } from "./server.ts";

const tasks = "io.modelcontextprotocol/tasks";
const noSchema = z.toJSONSchema(z.object({}));
const moveTo: ToolDescriptor = {
  kind: "action",
  name: "move_to",
  description: "Walk to a position.",
  inputSchema: noSchema,
};
const status: ToolDescriptor = {
  kind: "query",
  name: "status",
  description: "The bot.",
  inputSchema: noSchema,
};

const times = { createdAt: "2026-11-23T10:00:00.000Z", lastUpdatedAt: "2026-11-23T10:00:01.000Z" };
const running = {
  actionId: "a1",
  name: "move_to",
  ...times,
  status: "running",
  progress: { distance: 4 },
};
const completed = { actionId: "a1", name: "move_to", ...times, status: "completed", output: 7 };

// A core whose action `a1` ends when the test says so.
function fakeCore(start: CallResult = { ok: true, output: running }) {
  const ops: Array<[ActionOperation, string]> = [];
  const end = Promise.withResolvers<JsonValue>();
  let current: JsonValue = running;
  const core = {
    tools: [moveTo, status],
    call: (tool: string): Promise<CallResult> =>
      Promise.resolve(tool === "move_to" ? start : { ok: true, output: { health: 20 } }),
    action: async (op: ActionOperation, actionId: string): Promise<CallResult> => {
      ops.push([op, actionId]);
      if (actionId !== "a1") {
        return { ok: false, error: { code: "unknown_action", message: "No action." } };
      }
      if (op === "wait") {
        current = await end.promise;
      }
      if (op === "cancel") {
        current = { ...running, status: "canceled", stopped: true };
        end.resolve(current);
      }
      return { ok: true, output: current };
    },
  };
  const finish = (report: JsonValue) => {
    current = report;
    end.resolve(report);
  };
  return { core, ops, finish };
}

const modern = "2026-07-28";

// Sends one JSON-RPC message the way a client of that era would.
function serve(core: ReturnType<typeof fakeCore>["core"]) {
  const calls = new BlockingCalls();
  const handler = createMcpHandler((context) =>
    createServer(
      { core, log: new EventLog(8), deliveries: [], calls },
      context.era,
      context.requestInfo,
    ),
  );
  const send = async (
    era: "legacy" | "modern",
    message: JsonObject,
    { declare = true, signal }: { declare?: boolean; signal?: AbortSignal } = {},
  ) => {
    const capabilities = declare ? { extensions: { [tasks]: {} } } : {};
    const params = z.record(z.string(), z.json()).parse(message.params ?? {});
    const meta = {
      "io.modelcontextprotocol/clientCapabilities": capabilities,
      ...(era === "modern" && {
        "io.modelcontextprotocol/protocolVersion": modern,
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
      }),
    };
    // A modern request names its method and its tool or task in headers as well.
    const named = z
      .object({ name: z.string() })
      .or(z.object({ taskId: z.string() }))
      .safeParse(params);
    const routing =
      era === "modern"
        ? {
            "mcp-method": z.string().parse(message.method),
            ...(named.success && {
              "mcp-name": "name" in named.data ? named.data.name : named.data.taskId,
            }),
          }
        : {};
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": era === "modern" ? modern : "2025-11-25",
          ...routing,
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...message, params: { ...params, _meta: meta } }),
        signal,
      }),
    );
    const text = await response.text();
    return text.includes("{") ? reply.parse(JSON.parse(text.slice(text.indexOf("{")))) : {};
  };
  return { send, calls };
}

const reply = z.object({
  result: z.looseObject({}).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

function callMoveTo(id = 1) {
  return { id, method: "tools/call", params: { name: "move_to", arguments: {} } };
}

const json = z.json();
type Json = z.infer<typeof json>;

// The JSON in the text of a tool result.
function textOf(result: unknown): Json {
  const parsed = z.object({ content: z.array(z.object({ text: z.string() })) }).parse(result);
  return json.parse(JSON.parse(parsed.content[0]?.text ?? "null"));
}

const eras: Array<"legacy" | "modern"> = ["legacy", "modern"];

describe("an action for a client that takes tasks", () => {
  for (const era of eras) {
    test(`answers with a task at once (${era})`, async () => {
      const { core } = fakeCore();
      const { send } = serve(core);

      const { result } = await send(era, callMoveTo());

      expect(result).toMatchObject({
        resultType: "task",
        taskId: "a1",
        status: "working",
        statusMessage: '{"distance":4}',
        ...times,
        ttlMs: null,
        pollIntervalMs: 500,
      });
    });
  }

  test("says how many actions wait ahead of a queued one", async () => {
    const queued = { actionId: "a1", name: "move_to", ...times, status: "queued", ahead: 2 };
    const { core } = fakeCore({ ok: true, output: queued });
    const { send } = serve(core);

    const { result } = await send("modern", callMoveTo());

    expect(result).toMatchObject({
      status: "working",
      statusMessage: "Waiting for 2 actions to end first.",
    });
  });

  test("hands the output over once the task has completed", async () => {
    const { core, finish } = fakeCore();
    const { send } = serve(core);
    await send("modern", callMoveTo());
    finish(completed);

    const { result } = await send("modern", {
      id: 2,
      method: "tasks/get",
      params: { taskId: "a1" },
    });

    expect(result).toMatchObject({ taskId: "a1", status: "completed" });
    expect(textOf(z.object({ result: z.unknown() }).parse(result).result)).toBe(7);
  });

  test("ends a task that failed as completed with an error result", async () => {
    const { core, finish } = fakeCore();
    const { send } = serve(core);
    finish({ ...running, status: "skipped", after: "a0" });

    const { result } = await send("legacy", {
      id: 2,
      method: "tasks/get",
      params: { taskId: "a1" },
    });
    const toolResult = z
      .object({ result: z.object({ isError: z.boolean() }).loose() })
      .parse(result).result;

    expect(result).toMatchObject({ status: "completed" });
    expect(toolResult.isError).toBe(true);
    expect(textOf(toolResult)).toMatchObject({ code: "skipped", details: { after: "a0" } });
  });

  test("cancels a task and reports it as canceled afterwards", async () => {
    const { core, ops } = fakeCore();
    const { send } = serve(core);

    const cancel = await send("modern", {
      id: 2,
      method: "tasks/cancel",
      params: { taskId: "a1" },
    });
    const after = await send("modern", { id: 3, method: "tasks/get", params: { taskId: "a1" } });

    expect(cancel.result).toMatchObject({});
    expect(ops).toContainEqual(["cancel", "a1"]);
    expect(after.result).toMatchObject({ status: "cancelled" });
  });

  test("does not know a task the core does not know", async () => {
    const { core } = fakeCore();
    const { send } = serve(core);

    const { error } = await send("modern", {
      id: 2,
      method: "tasks/get",
      params: { taskId: "zz" },
    });

    expect(error?.code).toBe(-32_602);
  });

  test("refuses the task methods to a request that does not declare the extension", async () => {
    const { core } = fakeCore();
    const { send } = serve(core);

    const { error } = await send(
      "modern",
      { id: 2, method: "tasks/get", params: { taskId: "a1" } },
      { declare: false },
    );

    expect(error?.code).toBe(-32_021);
  });

  test("returns an error from before the start as a plain tool error", async () => {
    const busy: CallResult = { ok: false, error: { code: "busy", message: "16 actions wait." } };
    const { core } = fakeCore(busy);
    const { send } = serve(core);

    const { result } = await send("modern", callMoveTo());

    expect(result).toMatchObject({ isError: true });
    expect(result).not.toHaveProperty("resultType", "task");
  });

  test("leaves the other tools as they are", async () => {
    const { core } = fakeCore();
    const { send } = serve(core);

    const { result } = await send("modern", {
      id: 1,
      method: "tools/call",
      params: { name: "status", arguments: {} },
    });

    expect(textOf(result)).toEqual({ health: 20 });
  });
});

describe("an action for a client that does not take tasks", () => {
  for (const era of eras) {
    test(`answers once the action has ended (${era})`, async () => {
      const { core, finish } = fakeCore();
      const { send } = serve(core);

      const answer = send(era, callMoveTo(), { declare: false });
      await Bun.sleep(5);
      finish(completed);
      const { result } = await answer;

      expect(textOf(result)).toBe(7);
      expect(result).not.toHaveProperty("resultType", "task");
    });
  }

  test("says why an action that did not complete ended", async () => {
    const { core, finish } = fakeCore();
    const { send } = serve(core);

    const answer = send("legacy", callMoveTo(), { declare: false });
    await Bun.sleep(5);
    finish({ ...running, status: "interrupted", by: "reflex", reflex: "drowning", stopped: true });
    const { result } = await answer;

    expect(result).toMatchObject({ isError: true });
    expect(textOf(result)).toMatchObject({
      code: "interrupted",
      message: 'The action was interrupted by the reflex "drowning".',
    });
  });

  test("cancels the action when a legacy client cancels the call", async () => {
    const { core, ops } = fakeCore();
    const { send, calls } = serve(core);

    const answer = send("legacy", callMoveTo(41), { declare: false });
    await Bun.sleep(5);
    await send("legacy", { method: "notifications/cancelled", params: { requestId: 41 } });
    await answer;

    expect(ops).toContainEqual(["cancel", "a1"]);
    expect(calls.size).toBe(0);
  });

  test("cancels the action when a modern client goes away", async () => {
    const { core, ops } = fakeCore();
    const { send } = serve(core);
    const gone = new AbortController();

    const answer = send("modern", callMoveTo(), { declare: false, signal: gone.signal });
    await Bun.sleep(5);
    gone.abort();
    await answer.catch(() => null);
    await Bun.sleep(5);

    expect(ops).toContainEqual(["cancel", "a1"]);
  });
});
