import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { Emit } from "./events/event.ts";
import type { Plugin, Reflex } from "./plugin-api.ts";

import { ActionRunner } from "./action-runner.ts";
import { Body } from "./body.ts";
import { defineAction, definePlugin, defineQuery } from "./plugin-api.ts";
import { buildRegistry } from "./plugins.ts";
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
  const runner = new ActionRunner({ body: new Body(), emit: silent, waitMs: 10, stopGraceMs: 10 });
  return buildTools({ registry, runner, emit: silent, bot: () => undefined });
}

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
      ["action_status", "query"],
      ["cancel_action", "control"],
    ]);
  });

  test("rejects a plugin tool that takes the name of a tool that manages actions", () => {
    const plugin = definePlugin({ name: "a", actions: [action("cancel_action", z.object({}))] });

    expect(() => build(plugin)).toThrow('The tool name "cancel_action" is reserved');
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

describe("the tools that manage actions", () => {
  const tools = build(definePlugin({ name: "a" }));

  test("say so when no action has run", async () => {
    const result = await call(tools, "action_status", {});

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unknown_action", message: "No action has run yet." },
    });
  });

  test("say so when asked about an ID that was never issued", async () => {
    const status = await call(tools, "action_status", { actionId: "nope" });
    const cancel = await call(tools, "cancel_action", { actionId: "nope" });

    expect(status).toMatchObject({ ok: false, error: { code: "unknown_action" } });
    expect(cancel).toMatchObject({ ok: false, error: { code: "unknown_action" } });
  });

  test("reject a cancel without an ID", async () => {
    const result = await call(tools, "cancel_action", {});

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
