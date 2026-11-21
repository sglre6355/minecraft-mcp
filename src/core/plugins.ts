import type { JsonObject, JsonValue } from "type-fest";

import { z } from "zod";

import type { ActionDefinition } from "./actions/action.ts";
import type { CommandDefinition } from "./commands/command.ts";
import type { EventKindDefinition, EventSourceDefinition } from "./events/event.ts";
import type { Plugin } from "./plugin-api.ts";
import type { QueryDefinition } from "./queries/query.ts";
import type { Reflex } from "./reflexes/reflex.ts";

export interface Registry {
  actions: Map<string, ActionDefinition<unknown, JsonValue, JsonObject>>;
  queries: Map<string, QueryDefinition<unknown, JsonValue>>;
  commands: Map<string, CommandDefinition<unknown, JsonValue>>;
  reflexes: Map<string, Reflex<unknown, string>>;
  eventSources: Array<EventSourceDefinition>;
  eventKinds: Array<EventKindDefinition<JsonObject>>;
}

// Actions, queries and commands share one namespace, since each becomes an MCP tool.
export function buildRegistry(plugins: Array<Plugin>): Registry {
  const registry: Registry = {
    actions: new Map(),
    queries: new Map(),
    commands: new Map(),
    reflexes: new Map(),
    eventSources: [],
    eventKinds: [],
  };
  const eventKindNames = new Set<string>();
  const requireNewTool = (plugin: Plugin, name: string) => {
    if (registry.actions.has(name) || registry.queries.has(name) || registry.commands.has(name)) {
      throw new Error(`Plugin "${plugin.name}" defines the tool "${name}", which already exists`);
    }
  };

  for (const plugin of plugins) {
    for (const action of plugin.actions ?? []) {
      requireNewTool(plugin, action.name);
      requireObjectInput(plugin, action);
      registry.actions.set(action.name, action);
    }
    for (const query of plugin.queries ?? []) {
      requireNewTool(plugin, query.name);
      requireObjectInput(plugin, query);
      registry.queries.set(query.name, query);
    }
    for (const command of plugin.commands ?? []) {
      requireNewTool(plugin, command.name);
      requireObjectInput(plugin, command);
      registry.commands.set(command.name, command);
    }
    for (const reflex of plugin.reflexes ?? []) {
      if (registry.reflexes.has(reflex.name)) {
        throw new Error(
          `Plugin "${plugin.name}" defines the reflex "${reflex.name}", which already exists`,
        );
      }
      registry.reflexes.set(reflex.name, reflex);
    }
    for (const source of plugin.eventSources ?? []) {
      for (const kind of source.kinds) {
        if (eventKindNames.has(kind.kind)) {
          throw new Error(
            `Plugin "${plugin.name}" defines the event kind "${kind.kind}", which already exists`,
          );
        }
        eventKindNames.add(kind.kind);
        registry.eventKinds.push(kind);
      }
      registry.eventSources.push(source);
    }
  }
  return registry;
}

// MCP passes tool arguments as an object.
function requireObjectInput(plugin: Plugin, tool: { name: string; input: z.ZodType }): void {
  if (z.toJSONSchema(tool.input, { io: "input" }).type !== "object") {
    throw new Error(
      `Plugin "${plugin.name}" defines the tool "${tool.name}" with an input that is not an object`,
    );
  }
}

const pluginModule = z.object({ default: z.looseObject({ name: z.string() }) });

export async function loadPlugins(paths: Array<string>): Promise<Array<Plugin>> {
  const plugins: Array<Plugin> = [];
  for (const path of paths) {
    const module: unknown = await import(path);
    const parsed = pluginModule.safeParse(module);
    if (!parsed.success) {
      throw new Error(`${path} does not export a plugin as its default export`);
    }
    plugins.push(parsed.data.default);
  }
  return plugins;
}
