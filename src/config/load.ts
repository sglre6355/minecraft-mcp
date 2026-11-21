import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { Config } from "./schema.ts";

import { configSchema, tokenSchema } from "./schema.ts";

export const tokenVariable = "MINECRAFT_MCP_TOKEN";

export interface Loaded {
  config: Config;
  token: string;
}

// Secrets come from the environment. Everything else comes from the TOML file.
export async function loadConfig(
  path: string,
  env: Record<string, string | undefined>,
): Promise<Loaded> {
  const token = env[tokenVariable];
  if (token === undefined || token === "") {
    throw new Error(`Set ${tokenVariable} to the token that agents must present.`);
  }
  if (!tokenSchema.safeParse(token).success) {
    throw new Error(
      `${tokenVariable} may contain only letters, digits and the characters -._~+/ with = at the end. An Authorization header cannot carry anything else.`,
    );
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`The config file ${path} does not exist.`);
  }
  const parsed = configSchema.safeParse(parseToml(path, await file.text()));
  if (!parsed.success) {
    throw new Error(`The config file ${path} is invalid.\n${z.prettifyError(parsed.error)}`);
  }

  // Paths in the file are relative to the file.
  const base = dirname(resolve(path));
  const config = parsed.data;
  config.plugins = config.plugins.map((plugin) => resolve(base, plugin));
  if (config.minecraft.profilesDirectory !== undefined) {
    config.minecraft.profilesDirectory = resolve(base, config.minecraft.profilesDirectory);
  }
  return { config, token };
}

function parseToml(path: string, text: string): object {
  try {
    return Bun.TOML.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The config file ${path} is not valid TOML.\n${detail}`, { cause: error });
  }
}
