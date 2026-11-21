import type { Bot } from "mineflayer";
import type { JsonObject, JsonValue } from "type-fest";

import { z } from "zod";

import type { Config } from "../config/schema.ts";
import type { JsonSchema, ToolDescriptor } from "../protocol/descriptors.ts";
import type { CallResult } from "../protocol/messages.ts";
import type { ActionReport, ActionRunner } from "./action-runner.ts";
import type { ActionDefinition } from "./actions/action.ts";
import type { BodyHolder } from "./body.ts";
import type { CommandDefinition } from "./commands/command.ts";
import type { Emit } from "./events/event.ts";
import type { Registry } from "./plugins.ts";
import type { QueryDefinition } from "./queries/query.ts";

import { log } from "../log.ts";

export interface Tool {
  descriptor: ToolDescriptor;
  call(input: unknown): Promise<CallResult>;
}

export interface ToolParts {
  registry: Registry;
  runner: ActionRunner;
  emit: Emit;
  config: Config;
  // The bot while it is in the Minecraft server.
  bot: () => Bot | undefined;
}

// Every tool the agent can call, by name.
export function buildTools(parts: ToolParts): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  for (const query of parts.registry.queries.values()) {
    tools.set(query.name, queryTool(query, parts));
  }
  for (const command of parts.registry.commands.values()) {
    tools.set(command.name, commandTool(command, parts));
  }
  for (const action of parts.registry.actions.values()) {
    tools.set(action.name, actionTool(action, parts));
  }
  for (const tool of [actionStatus(parts.runner), cancelAction(parts.runner)]) {
    if (tools.has(tool.descriptor.name)) {
      throw new Error(`The tool name "${tool.descriptor.name}" is reserved`);
    }
    tools.set(tool.descriptor.name, tool);
  }
  return tools;
}

const notConnected: CallResult = {
  ok: false,
  error: { code: "not_connected", message: "The bot is not in the Minecraft server." },
};

function invalidInput(message: string): CallResult {
  return { ok: false, error: { code: "invalid_input", message } };
}

function queryTool(query: QueryDefinition<unknown, JsonValue>, { bot }: ToolParts): Tool {
  return {
    descriptor: {
      kind: "query",
      name: query.name,
      description: query.description,
      inputSchema: z.toJSONSchema(query.input, { io: "input" }),
    },
    async call(input) {
      const parsed = await query.input.safeParseAsync(input);
      if (!parsed.success) {
        return invalidInput(z.prettifyError(parsed.error));
      }
      const current = bot();
      if (current === undefined) {
        return notConnected;
      }
      return { ok: true, output: await query.run({ bot: current }, parsed.data) };
    },
  };
}

function commandTool(
  command: CommandDefinition<unknown, JsonValue>,
  { bot, config }: ToolParts,
): Tool {
  return {
    descriptor: {
      kind: "command",
      name: command.name,
      description: command.description,
      inputSchema: z.toJSONSchema(command.input, { io: "input" }),
    },
    async call(input) {
      const parsed = await command.input.safeParseAsync(input);
      if (!parsed.success) {
        return invalidInput(z.prettifyError(parsed.error));
      }
      const current = bot();
      if (current === undefined) {
        return notConnected;
      }
      return { ok: true, output: await command.run({ bot: current, config }, parsed.data) };
    },
  };
}

// Every action accepts this key next to its own input.
const suppressionKey = "suppressReflexes";
const suppression = z.looseObject({ [suppressionKey]: z.array(z.string()).default([]) });

function actionTool(
  action: ActionDefinition<unknown, JsonValue, JsonObject>,
  { registry, runner, emit, bot }: ToolParts,
): Tool {
  const reflexes = [...registry.reflexes.keys()];
  const inputSchema = z.toJSONSchema(action.input, { io: "input" });
  if (inputSchema.properties !== undefined && suppressionKey in inputSchema.properties) {
    throw new Error(`The action "${action.name}" uses the reserved input "${suppressionKey}"`);
  }
  if (reflexes.length > 0) {
    const suppressionSchema: JsonSchema = {
      type: "array",
      items: { type: "string", enum: reflexes },
      description:
        "Reflexes to hold back while this action runs. Name one only to overrule it on purpose.",
    };
    inputSchema.properties = { ...inputSchema.properties, [suppressionKey]: suppressionSchema };
  }

  const descriptor: ToolDescriptor = {
    kind: "action",
    name: action.name,
    description: action.description,
    inputSchema,
  };
  if (action.progress !== undefined) {
    descriptor.progressSchema = z.toJSONSchema(action.progress);
  }

  return {
    descriptor,
    async call(input) {
      const envelope = suppression.safeParse(input);
      if (!envelope.success) {
        return invalidInput(z.prettifyError(envelope.error));
      }
      const { [suppressionKey]: suppressReflexes, ...rest } = envelope.data;
      const unknown = suppressReflexes.filter((name) => !registry.reflexes.has(name));
      if (unknown.length > 0) {
        return invalidInput(`No reflex is named ${unknown.map((name) => `"${name}"`).join(", ")}.`);
      }
      const parsed = await action.input.safeParseAsync(rest);
      if (!parsed.success) {
        return invalidInput(z.prettifyError(parsed.error));
      }
      const current = bot();
      if (current === undefined) {
        return notConnected;
      }

      const result = await runner.start({
        name: action.name,
        suppressReflexes,
        run: ({ signal, progress }) =>
          action.run(
            {
              bot: current,
              signal,
              emit,
              progress: (data) => {
                const checked = action.progress?.safeParse(data);
                if (checked?.success === false) {
                  // Actions often report from a timer, where a throw would take the core down.
                  log("error", "tools", `${action.name} reported progress in the wrong shape`, {
                    detail: z.prettifyError(checked.error),
                  });
                  return;
                }
                progress(checked?.data ?? data);
              },
            },
            parsed.data,
          ),
      });
      return result.started ? reported(result.report) : busy(result.heldBy, runner);
    },
  };
}

function reported(report: ActionReport): CallResult {
  switch (report.status) {
    case "running":
    case "completed":
      return { ok: true, output: report };
    case "failed":
      return { ok: false, error: { code: "failed", message: report.message, details: report } };
    case "interrupted": {
      const by = report.reflex === null ? report.by : `the reflex "${report.reflex}"`;
      return {
        ok: false,
        error: {
          code: "interrupted",
          message: `The action was interrupted by ${by}.`,
          details: report,
        },
      };
    }
  }
}

function busy(heldBy: BodyHolder, runner: ActionRunner): CallResult {
  if (heldBy.kind === "reflex") {
    return {
      ok: false,
      error: {
        code: "busy",
        message: `The reflex "${heldBy.name}" has the body. Wait for it to end, or name it in ${suppressionKey} to take the body from it.`,
        details: { reflex: heldBy.name },
      },
    };
  }
  const name = runner.report(heldBy.id)?.name ?? null;
  return {
    ok: false,
    error: {
      code: "busy",
      message: `The action ${heldBy.id} has the body. Wait for it, or stop it with cancel_action.`,
      details: { actionId: heldBy.id, name },
    },
  };
}

function unknownAction(actionId: string | undefined): CallResult {
  return {
    ok: false,
    error: {
      code: "unknown_action",
      message:
        actionId === undefined ? "No action has run yet." : `No action has the ID "${actionId}".`,
    },
  };
}

const statusInput = z.object({
  actionId: z.string().optional().describe("Defaults to the latest action."),
});

function actionStatus(runner: ActionRunner): Tool {
  return {
    descriptor: {
      kind: "query",
      name: "action_status",
      description:
        "Report whether an action is running, completed, failed or interrupted, with its progress or output.",
      inputSchema: z.toJSONSchema(statusInput, { io: "input" }),
    },
    call(input) {
      const parsed = statusInput.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(invalidInput(z.prettifyError(parsed.error)));
      }
      const report = runner.report(parsed.data.actionId);
      return Promise.resolve(
        report === undefined ? unknownAction(parsed.data.actionId) : { ok: true, output: report },
      );
    },
  };
}

const cancelInput = z.object({ actionId: z.string() });

function cancelAction(runner: ActionRunner): Tool {
  return {
    descriptor: {
      kind: "control",
      name: "cancel_action",
      description: "Stop a running action and report how it ended.",
      inputSchema: z.toJSONSchema(cancelInput, { io: "input" }),
    },
    async call(input) {
      const parsed = cancelInput.safeParse(input);
      if (!parsed.success) {
        return invalidInput(z.prettifyError(parsed.error));
      }
      const report = await runner.cancel(parsed.data.actionId);
      return report === undefined
        ? unknownAction(parsed.data.actionId)
        : { ok: true, output: report };
    },
  };
}
