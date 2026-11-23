import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";

import {
  CLIENT_CAPABILITIES_META_KEY,
  MissingRequiredClientCapabilityError,
  ProtocolError,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ActionOperation, CallError, CallResult } from "../protocol/messages.ts";

import { log } from "../log.ts";

// The Tasks extension, SEP-2663. A client that declares it on a call gets every action as a
// task. Any other client gets the response once the action has ended.
// https://modelcontextprotocol.io/seps/2663-tasks-extension
export const tasksExtension = "io.modelcontextprotocol/tasks";

// How often a client should ask about a task, in milliseconds.
const pollIntervalMs = 500;

export interface ActionCore {
  call(tool: string, input: unknown): Promise<CallResult>;
  action(op: ActionOperation, actionId: string): Promise<CallResult>;
}

const identity = {
  actionId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUpdatedAt: z.string(),
};

// What the core reports about an action.
const actionReport = z.discriminatedUnion("status", [
  z.object({ ...identity, status: z.literal("queued"), ahead: z.int() }),
  z.object({
    ...identity,
    status: z.literal("running"),
    progress: z.record(z.string(), z.json()).nullable(),
  }),
  z.object({ ...identity, status: z.literal("completed"), output: z.json() }),
  z.object({ ...identity, status: z.literal("failed"), message: z.string() }),
  z.object({
    ...identity,
    status: z.literal("interrupted"),
    by: z.enum(["reflex", "death", "disconnect"]),
    reflex: z.string().nullable(),
    stopped: z.boolean(),
  }),
  z.object({ ...identity, status: z.literal("canceled"), stopped: z.boolean() }),
  z.object({ ...identity, status: z.literal("skipped"), after: z.string() }),
]);

type ActionReport = z.infer<typeof actionReport>;

// Calls waiting for their actions to end, keyed by each call's JSON-RPC ID. A client using the
// 2025 revisions cancels a call with a notification sent as a separate request.
export class BlockingCalls {
  readonly #actions = new Map<string, string>();

  get size(): number {
    return this.#actions.size;
  }

  add(requestId: string, actionId: string): void {
    this.#actions.set(requestId, actionId);
  }

  remove(requestId: string): void {
    this.#actions.delete(requestId);
  }

  actionOf(requestId: string): string | undefined {
    return this.#actions.get(requestId);
  }
}

export function toToolResult(result: CallResult): CallToolResult {
  if (!result.ok) {
    return failure(result.error);
  }
  return { content: [{ type: "text", text: JSON.stringify(result.output) }] };
}

function failure(error: CallError): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
}

// The response to the call that started the action, as it would appear once the action has
// ended.
function endOf(report: ActionReport): CallToolResult {
  switch (report.status) {
    case "queued":
    case "running":
    case "completed":
      return toToolResult({
        ok: true,
        output: report.status === "completed" ? report.output : report,
      });
    case "failed":
      return failure({ code: "failed", message: report.message });
    case "interrupted": {
      const by = report.reflex === null ? report.by : `the reflex "${report.reflex}"`;
      return failure({
        code: "interrupted",
        message: `The action was interrupted by ${by}.`,
        details: { by: report.by, reflex: report.reflex, stopped: report.stopped },
      });
    }
    case "canceled":
      return failure({
        code: "canceled",
        message: "The action was canceled.",
        details: { stopped: report.stopped },
      });
    case "skipped":
      return failure({
        code: "skipped",
        message: `The action did not run because the preceding action ${report.after} did not complete.`,
        details: { after: report.after },
      });
  }
}

// The task representing an action, as returned by `tasks/get`.
function taskOf(report: ActionReport) {
  const task = {
    taskId: report.actionId,
    createdAt: report.createdAt,
    lastUpdatedAt: report.lastUpdatedAt,
    ttlMs: null,
    pollIntervalMs,
  };
  switch (report.status) {
    case "queued":
      return {
        ...task,
        status: "working",
        statusMessage: `Waiting for ${report.ahead} ${report.ahead === 1 ? "action" : "actions"} to end first.`,
      };
    case "running":
      return {
        ...task,
        status: "working",
        ...(report.progress !== null && { statusMessage: JSON.stringify(report.progress) }),
      };
    case "canceled":
      return { ...task, status: "cancelled" };
    default:
      return { ...task, status: "completed", result: endOf(report) };
  }
}

const envelope = z.looseObject({
  [CLIENT_CAPABILITIES_META_KEY]: z
    .looseObject({ extensions: z.record(z.string(), z.unknown()).optional() })
    .optional(),
});

// Whether the request declares the Tasks extension. The check runs for each request, as the
// extension requires.
function takesTasks(context: ServerContext): boolean {
  const declared = envelope.safeParse(context.mcpReq.envelope);
  return (
    declared.success &&
    declared.data[CLIENT_CAPABILITIES_META_KEY]?.extensions?.[tasksExtension] !== undefined
  );
}

function report(result: CallResult): ActionReport | CallError {
  if (!result.ok) {
    return result.error;
  }
  const parsed = actionReport.safeParse(result.output);
  return parsed.success
    ? parsed.data
    : { code: "failed", message: "The core sent an action report in the wrong format." };
}

function isReport(value: ActionReport | CallError): value is ActionReport {
  return "actionId" in value;
}

// Starts an action and responds with a task or once the action has ended.
export async function callAction(
  core: ActionCore,
  calls: BlockingCalls,
  name: string,
  input: unknown,
  context: ServerContext,
  request: Request | undefined,
): Promise<CallToolResult> {
  const started = report(await core.call(name, input));
  if (!isReport(started)) {
    return failure(started);
  }
  const { actionId } = started;
  if (takesTasks(context)) {
    log("info", "gateway", "action returned as a task", { name, actionId });
    return { content: [], resultType: "task", ...taskOf(started) };
  }

  log("info", "gateway", "action result returned after completion", { name, actionId });
  const requestId = String(context.mcpReq.id);
  calls.add(requestId, actionId);
  const gone = AbortSignal.any([
    context.mcpReq.signal,
    ...(request === undefined ? [] : [request.signal]),
  ]);
  const cancel = () => {
    void core.action("cancel", actionId);
  };
  if (gone.aborted) {
    cancel();
  }
  gone.addEventListener("abort", cancel, { once: true });
  try {
    const ended = report(await core.action("wait", actionId));
    return isReport(ended) ? endOf(ended) : failure(ended);
  } finally {
    gone.removeEventListener("abort", cancel);
    calls.remove(requestId);
  }
}

const taskParams = z.looseObject({ taskId: z.string() });
const cancelParams = z.looseObject({ requestId: z.union([z.string(), z.number()]) });

function requireTasks(context: ServerContext): void {
  if (!takesTasks(context)) {
    throw new MissingRequiredClientCapabilityError({
      requiredCapabilities: { extensions: { [tasksExtension]: {} } },
    });
  }
}

async function known(core: ActionCore, op: ActionOperation, taskId: string) {
  const found = report(await core.action(op, taskId));
  if (!isReport(found)) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      found.code === "unknown_action" ? "Task not found" : found.message,
    );
  }
  return found;
}

// Registers `tasks/get` and `tasks/cancel` for all clients. On the 2025 protocol route, also
// handles `notifications/cancelled` to cancel pending calls.
export function attachTasks(
  server: McpServer,
  core: ActionCore,
  calls: BlockingCalls,
  era: "legacy" | "modern",
): void {
  const protocol = server.server;
  protocol.registerCapabilities({ extensions: { [tasksExtension]: {} } });

  protocol.setRequestHandler("tasks/get", { params: taskParams }, async (params, context) => {
    requireTasks(context);
    return taskOf(await known(core, "get", params.taskId));
  });

  protocol.setRequestHandler("tasks/cancel", { params: taskParams }, async (params, context) => {
    requireTasks(context);
    await known(core, "cancel", params.taskId);
    return {};
  });

  if (era === "legacy") {
    protocol.setNotificationHandler(
      "notifications/cancelled",
      { params: cancelParams },
      (params) => {
        const actionId = calls.actionOf(String(params.requestId));
        if (actionId !== undefined) {
          void core.action("cancel", actionId);
        }
      },
    );
  }
}
