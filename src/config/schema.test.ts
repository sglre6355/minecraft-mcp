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
  test("fills in defaults around the required fields", () => {
    const config = configSchema.parse({ minecraft: { host: "mc.example", username: "bot" } });

    expect(config).toEqual({
      minecraft: {
        host: "mc.example",
        port: 25_565,
        username: "bot",
        auth: "microsoft",
        resolveSrv: true,
      },
      server: { host: "127.0.0.1", port: 3000 },
      chat: { trustedSenders: [] },
      events: { capacity: 256, oxygenAtMost: 10, foodAtMost: 6 },
      actions: { waitMs: 10_000 },
      reflexes: {},
      delivery: ["poll-tool", "mcp-events"],
      plugins: [],
    });
  });

  test("lets a reflex be switched off by name", () => {
    const config = configSchema.parse({
      minecraft: { host: "mc.example", username: "bot" },
      reflexes: { drowning: { enabled: false }, fleeing: {} },
    });

    expect(config.reflexes).toEqual({ drowning: { enabled: false }, fleeing: { enabled: true } });
  });

  test("requires the Minecraft server and the username", () => {
    expect(configSchema.safeParse({}).success).toBe(false);
    expect(configSchema.safeParse({ minecraft: { host: "mc.example" } }).success).toBe(false);
  });

  test("rejects a key it does not know", () => {
    const result = configSchema.safeParse({
      minecraft: { host: "mc.example", username: "bot", pport: 25_566 },
    });

    expect(result.success).toBe(false);
  });
});
