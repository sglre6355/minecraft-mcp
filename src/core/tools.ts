import type { Bot } from "mineflayer";
import type { JsonObject, JsonValue } from "type-fest";

import { z } from "zod";

import type { Config } from "../config/schema.ts";
import type { JsonSchema, ToolDescriptor } from "../protocol/descriptors.ts";
import type { CallResult, Target } from "../protocol/messages.ts";
import type { ActionRunner } from "./action-runner.ts";
import type { ActionDefinition } from "./actions/action.ts";
import type { CommandDefinition } from "./commands/command.ts";
import type { Emit } from "./events/event.ts";
import type { Registry } from "./plugins.ts";
import type { Presence, PresenceState } from "./presence.ts";
import type { QueryDefinition } from "./queries/query.ts";

import { log } from "../log.ts";
import { describeCause } from "./presence.ts";
import { within } from "./wait.ts";

export interface Tool {
  descriptor: ToolDescriptor;
  call(input: unknown): Promise<CallResult>;
}

export interface ToolParts {
  registry: Registry;
  runner: ActionRunner;
  emit: Emit;
  config: Config;
  presence: Presence<Target>;
  // The bot while it is in a Minecraft server.
  bot: () => Bot | undefined;
  // `connect` responds after this much time, even if the bot is still joining.
  connectWaitMs: number;
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
  const fixed = [connectTool(parts), disconnectTool(parts.presence)];
  for (const tool of fixed) {
    if (tools.has(tool.descriptor.name)) {
      throw new Error(`The tool name "${tool.descriptor.name}" is reserved`);
    }
    tools.set(tool.descriptor.name, tool);
  }
  return tools;
}

const whyNotConnected = {
  disconnected: "The bot is in no Minecraft server. Call connect to join one.",
  connecting: "The bot is still joining the server.",
  reconnecting: "The bot lost its connection and is trying to get back in.",
  connected: "The bot is joining the world.",
};

function notConnected(state: PresenceState): CallResult {
  return {
    ok: false,
    error: { code: "not_connected", message: whyNotConnected[state], details: { state } },
  };
}

const connectInput = z.strictObject({
  host: z.string().min(1).describe("The address of the Minecraft server."),
  port: z.int().min(1).max(65_535).default(25_565),
  username: z
    .string()
    .min(1)
    .describe(
      "With offline sign-in, the name the bot joins under. With Microsoft sign-in, a label for the saved sign-in. The account a person signs in with decides the name in the game, and the same label uses that sign-in again without asking.",
    ),
  auth: z
    .enum(["offline", "microsoft"])
    .default("microsoft")
    .describe("How to sign in. A server in offline mode takes any name without sign-in."),
  version: z
    .string()
    .min(1)
    .optional()
    .describe("The Minecraft version, such as 1.19.4. Detected from the server when omitted."),
  resolveSrv: z
    .boolean()
    .default(true)
    .describe(
      "Follow the DNS SRV record of the host to find the real address. Turn it off to connect straight to host and port.",
    ),
});

function connectTool({ presence, bot, connectWaitMs }: ToolParts): Tool {
  return {
    descriptor: {
      kind: "control",
      name: "connect",
      description:
        "Join a Minecraft server. The bot is in no server until this is called. After a drop that passes by itself, such as a server restart, the bot joins the same server again without being asked. After a kick it stays out.",
      inputSchema: z.toJSONSchema(connectInput, { io: "input" }),
    },
    async call(input) {
      const parsed = connectInput.safeParse(input);
      if (!parsed.success) {
        return invalidInput(z.prettifyError(parsed.error));
      }
      const target: Target = { ...parsed.data, version: parsed.data.version ?? null };
      const set = presence.target;
      if (set !== undefined && !Bun.deepEquals(set, target)) {
        return {
          ok: false,
          error: {
            code: "failed",
            message: `The bot is set to be in ${set.host}:${set.port} as ${set.username}. Call disconnect first.`,
            details: { state: presence.state },
          },
        };
      }

      const outcome = await within(presence.connect(target), connectWaitMs);
      if (outcome === undefined || outcome.state === "connected") {
        // The name in the game, which Microsoft sign-in takes from the account.
        return { ok: true, output: { state: presence.state, username: bot()?.username ?? null } };
      }
      return {
        ok: false,
        error: {
          code: "failed",
          message: `Could not join ${target.host}:${target.port}. ${describeCause(outcome.cause)}`,
        },
      };
    },
  };
}

const disconnectInput = z.object({});

function disconnectTool(presence: Presence<Target>): Tool {
  return {
    descriptor: {
      kind: "control",
      name: "disconnect",
      description:
        "Leave the Minecraft server, or stop trying to get back into it. The bot stays out until connect is called.",
      inputSchema: z.toJSONSchema(disconnectInput, { io: "input" }),
    },
    call() {
      const was = presence.state;
      presence.disconnect();
      return Promise.resolve({ ok: true, output: { state: presence.state, was } });
    },
  };
}

function invalidInput(message: string): CallResult {
  return { ok: false, error: { code: "invalid_input", message } };
}

function queryTool(query: QueryDefinition<unknown, JsonValue>, { bot, presence }: ToolParts): Tool {
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
        return notConnected(presence.state);
      }
      return { ok: true, output: await query.run({ bot: current }, parsed.data) };
    },
  };
}

function commandTool(
  command: CommandDefinition<unknown, JsonValue>,
  { bot, config, presence }: ToolParts,
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
        return notConnected(presence.state);
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
  { registry, runner, emit, bot, presence }: ToolParts,
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
      if (bot() === undefined) {
        return notConnected(presence.state);
      }

      // The action may wait in the queue, so it uses the current bot when it starts.
      const result = runner.enqueue({
        name: action.name,
        suppressReflexes,
        run: ({ signal, progress }) => {
          const current = bot();
          if (current === undefined) {
            throw new Error(whyNotConnected[presence.state]);
          }
          return action.run(
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
          );
        },
      });
      if (!result.accepted) {
        return {
          ok: false,
          error: {
            code: "busy",
            message: `${result.waiting} actions are already waiting. Wait for some of them to end.`,
          },
        };
      }
      return { ok: true, output: result.report };
    },
  };
}
