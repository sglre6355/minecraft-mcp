import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { Target } from "../protocol/messages.ts";
import type { Emit } from "./events/event.ts";
import type { Plugin, Reflex } from "./plugin-api.ts";

import { configSchema } from "../config/schema.ts";
import { ActionRunner } from "./action-runner.ts";
import { Body } from "./body.ts";
import { defineAction, defineCommand, definePlugin, defineQuery } from "./plugin-api.ts";
import { buildRegistry } from "./plugins.ts";
import { Presence } from "./presence.ts";
import { buildTools } from "./tools.ts";

const silent: Emit = () => {};

const drowning: Reflex<unknown, string> = {
  name: "drowning",
  limitMs: 1000,
  observe: () => undefined,
  policy: { decide: () => Promise.resolve(undefined) },
  execute: () => Promise.resolve(),
};

// The bot is absent, so a call that passes every check ends in `not_connected`.
function build(plugin: Plugin) {
  const registry = buildRegistry([plugin]);
  const runner = new ActionRunner({ body: new Body(), stopGraceMs: 10 });
  const config = configSchema.parse({});
  return buildTools({
    registry,
    runner,
    emit: silent,
    config,
    presence: unreachable(),
    bot: () => undefined,
    connectWaitMs: 20,
  });
}

// Never gets into a server. An attempt hangs until it is ended.
function unreachable() {
  return new Presence<Target>({
    dial: (_target, _auto, events) => ({
      hangUp: () => {
        events.ended({ kind: "requested" });
      },
    }),
    onDisconnected: () => {},
    onTarget: () => {},
    baseDelayMs: 10,
    maxDelayMs: 10,
    stableAfterMs: 10,
  });
}

const lookQuery = {
  description: "",
  input: z.object({}),
  run: () => Promise.resolve(null),
};

function action(name: string, input: z.ZodType) {
  return defineAction({ name, description: "", input, run: () => Promise.resolve(null) });
}

async function call(tools: ReturnType<typeof build>, name: string, input: unknown) {
  const tool = tools.get(name);
  if (tool === undefined) {
    throw new Error(`no tool named ${name}`);
  }
  return await tool.call(input);
}

describe("connect and disconnect", () => {
  const home = { host: "mc.example", username: "bot" };

  test("need a server and a name to join under", async () => {
    const tools = build(definePlugin({ name: "a" }));

    expect(await call(tools, "connect", {})).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(await call(tools, "connect", { host: "mc.example" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  test("answer while the bot is still joining", async () => {
    const tools = build(definePlugin({ name: "a" }));

    const result = await call(tools, "connect", home);

    expect(result).toEqual({ ok: true, output: { state: "connecting", username: null } });
  });

  test("refuse another server while the bot is set on one", async () => {
    const tools = build(definePlugin({ name: "a" }));
    await call(tools, "connect", home);

    const result = await call(tools, "connect", { host: "other.example", username: "bot" });

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("Call disconnect first") },
    });
  });

  test("take the same server again without a second attempt", async () => {
    const tools = build(definePlugin({ name: "a" }));
    await call(tools, "connect", home);

    const result = await call(tools, "connect", { ...home, port: 25_565 });

    expect(result).toEqual({ ok: true, output: { state: "connecting", username: null } });
  });

  test("give up the attempt on disconnect, and report the failure to whoever waits", async () => {
    const tools = build(definePlugin({ name: "a" }));
    await call(tools, "connect", home);

    const result = await call(tools, "disconnect", {});

    expect(result).toEqual({ ok: true, output: { state: "disconnected", was: "connecting" } });
  });

  test("say what to do when a tool needs the bot in a server", async () => {
    const tools = build(
      definePlugin({ name: "a", queries: [defineQuery({ ...lookQuery, name: "look" })] }),
    );

    const result = await call(tools, "look", {});

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "not_connected",
        message: expect.stringContaining("Call connect"),
        details: { state: "disconnected" },
      },
    });
  });
});

describe("a command tool", () => {
  const say = defineCommand({
    name: "say",
    description: "",
    input: z.object({ message: z.string() }),
    run: () => Promise.resolve(null),
  });

  test("is offered as its own kind", () => {
    const tools = build(definePlugin({ name: "a", commands: [say] }));

    expect(tools.get("say")?.descriptor.kind).toBe("command");
  });

  test("rejects input that does not fit", async () => {
    const tools = build(definePlugin({ name: "a", commands: [say] }));

    const result = await call(tools, "say", { message: 5 });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("needs the bot to be in the server", async () => {
    const tools = build(definePlugin({ name: "a", commands: [say] }));

    const result = await call(tools, "say", { message: "hi" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_connected" } });
  });
});

describe("buildTools", () => {
  test("offers the queries, the actions and the tools that manage actions", () => {
    const tools = build(
      definePlugin({
        name: "a",
        actions: [action("dig", z.object({}))],
        queries: [
          defineQuery({
            name: "look",
            description: "",
            input: z.object({}),
            run: () => Promise.resolve(null),
          }),
        ],
      }),
    );

    const kinds = [...tools.values()].map((tool) => [tool.descriptor.name, tool.descriptor.kind]);

    expect(kinds).toEqual([
      ["look", "query"],
      ["dig", "action"],
      ["connect", "control"],
      ["disconnect", "control"],
    ]);
  });

  test("rejects a plugin tool that takes the name of a tool that manages the connection", () => {
    const plugin = definePlugin({ name: "a", actions: [action("connect", z.object({}))] });

    expect(() => build(plugin)).toThrow('The tool name "connect" is reserved');
  });

  test("rejects an action whose input uses the key for suppressing reflexes", () => {
    const plugin = definePlugin({
      name: "a",
      actions: [action("dig", z.object({ suppressReflexes: z.boolean() }))],
    });

    expect(() => build(plugin)).toThrow(
      'The action "dig" uses the reserved input "suppressReflexes"',
    );
  });

  test("lets an action name the registered reflexes to suppress", () => {
    const tools = build(
      definePlugin({ name: "a", actions: [action("dig", z.object({}))], reflexes: [drowning] }),
    );

    const properties = tools.get("dig")?.descriptor.inputSchema.properties;

    expect(properties?.["suppressReflexes"]).toMatchObject({
      type: "array",
      items: { enum: ["drowning"] },
    });
  });

  test("leaves reflex suppression out of the schema while no reflex exists", () => {
    const tools = build(definePlugin({ name: "a", actions: [action("dig", z.object({}))] }));

    expect(tools.get("dig")?.descriptor.inputSchema.properties).toEqual({});
  });

  test("carries the progress schema of an action that declares one", () => {
    const tools = build(
      definePlugin({
        name: "a",
        actions: [
          defineAction({
            name: "dig",
            description: "",
            input: z.object({}),
            progress: z.object({ left: z.number() }),
            run: () => Promise.resolve(null),
          }),
        ],
      }),
    );

    expect(tools.get("dig")?.descriptor.progressSchema).toMatchObject({
      properties: { left: { type: "number" } },
    });
  });
});

describe("an action tool", () => {
  const tools = build(
    definePlugin({
      name: "a",
      actions: [action("dig", z.strictObject({ depth: z.number() }))],
      reflexes: [drowning],
    }),
  );

  test("takes the reflexes to suppress out before it checks the action's own input", async () => {
    const result = await call(tools, "dig", { depth: 2, suppressReflexes: ["drowning"] });

    expect(result).toMatchObject({ ok: false, error: { code: "not_connected" } });
  });

  test("rejects a reflex name that is not registered", async () => {
    const result = await call(tools, "dig", { depth: 2, suppressReflexes: ["hunger"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: 'No reflex is named "hunger".' },
    });
  });

  test("rejects input the action's schema does not accept", async () => {
    const result = await call(tools, "dig", { depth: "deep" });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("rejects input that is not an object", async () => {
    const result = await call(tools, "dig", "deep");

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
