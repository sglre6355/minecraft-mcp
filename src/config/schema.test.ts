import { describe, expect, test } from "bun:test";

import { configSchema, tokenSchema } from "./schema.ts";

describe("tokenSchema", () => {
  test("accepts the characters a bearer token may carry", () => {
    expect(tokenSchema.safeParse("aZ09-._~+/==").success).toBe(true);
  });

  test("rejects an empty token", () => {
    expect(tokenSchema.safeParse("").success).toBe(false);
  });

  test("rejects a token that an Authorization header cannot carry", () => {
    expect(tokenSchema.safeParse("my secret").success).toBe(false);
    expect(tokenSchema.safeParse("pässword").success).toBe(false);
  });
});

describe("configSchema", () => {
  test("needs no setting at all", () => {
    const config = configSchema.parse({});

    expect(config).toEqual({
      minecraft: {},
      server: { host: "127.0.0.1", port: 3000 },
      chat: { trustedSenders: [], allowCommands: false },
      events: { capacity: 256, oxygenAtMost: 10, foodAtMost: 6 },
      actions: { waitMs: 10_000 },
      reflexes: {},
      delivery: ["poll-tool", "mcp-events"],
      plugins: [],
    });
  });

  test("lets a reflex be switched off by name", () => {
    const config = configSchema.parse({
      reflexes: { drowning: { enabled: false }, fleeing: {} },
    });

    expect(config.reflexes).toEqual({ drowning: { enabled: false }, fleeing: { enabled: true } });
  });

  test("leaves the server to join out of the config, since the agent names it", () => {
    expect(configSchema.safeParse({ minecraft: { host: "mc.example" } }).success).toBe(false);
    expect(configSchema.safeParse({ minecraft: { username: "bot" } }).success).toBe(false);
  });

  test("rejects a key it does not know", () => {
    expect(configSchema.safeParse({ server: { pport: 3001 } }).success).toBe(false);
  });
});
