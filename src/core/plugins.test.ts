import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { defineAction, defineEventKind, definePlugin, defineQuery } from "./plugin-api.ts";
import { buildRegistry } from "./plugins.ts";

function query(name: string) {
  return defineQuery({
    name,
    description: "",
    input: z.object({}),
    run: () => Promise.resolve(null),
  });
}

function action(name: string) {
  return defineAction({
    name,
    description: "",
    input: z.object({}),
    run: () => Promise.resolve(null),
  });
}

function source(name: string, kind: string) {
  return {
    name,
    kinds: [defineEventKind({ kind, description: "", payload: z.object({}) })],
    start: () => () => {},
  };
}

describe("buildRegistry", () => {
  test("collects the definitions of every plugin", () => {
    const registry = buildRegistry([
      definePlugin({ name: "a", queries: [query("status")] }),
      definePlugin({
        name: "b",
        actions: [action("move_to")],
        eventSources: [source("chat", "chat.message")],
      }),
    ]);

    expect([...registry.queries.keys()]).toEqual(["status"]);
    expect([...registry.actions.keys()]).toEqual(["move_to"]);
    expect(registry.eventKinds.map((kind) => kind.kind)).toEqual(["chat.message"]);
  });

  test("rejects a query that shares its name with an action", () => {
    const plugins = [
      definePlugin({ name: "a", actions: [action("look")] }),
      definePlugin({ name: "b", queries: [query("look")] }),
    ];

    expect(() => buildRegistry(plugins)).toThrow('Plugin "b" defines the tool "look"');
  });

  test("rejects a tool whose input is not an object", () => {
    const say = defineQuery({
      name: "say",
      description: "",
      input: z.string(),
      run: () => Promise.resolve(null),
    });
    const plugins = [definePlugin({ name: "a", queries: [say] })];

    expect(() => buildRegistry(plugins)).toThrow(
      'Plugin "a" defines the tool "say" with an input that is not an object',
    );
  });

  test("rejects an event kind defined twice", () => {
    const plugins = [
      definePlugin({ name: "a", eventSources: [source("one", "chat.message")] }),
      definePlugin({ name: "b", eventSources: [source("two", "chat.message")] }),
    ];

    expect(() => buildRegistry(plugins)).toThrow(
      'Plugin "b" defines the event kind "chat.message"',
    );
  });
});
