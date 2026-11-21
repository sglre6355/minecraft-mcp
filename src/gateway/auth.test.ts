import { describe, expect, test } from "bun:test";

import { createAuthGate } from "./auth.ts";

function request(authorization?: string) {
  const headers = authorization === undefined ? undefined : { authorization };
  return new Request("http://localhost/mcp", { method: "POST", headers });
}

describe("createAuthGate", () => {
  const gate = createAuthGate("secret");

  test("admits a request that carries the token", async () => {
    const result = await gate(request("Bearer secret"));

    expect(result.ok).toBe(true);
  });

  test("answers 401 to a wrong token", async () => {
    const result = await gate(request("Bearer wrong"));

    expect(result).toMatchObject({ ok: false, response: { status: 401 } });
  });

  test("answers 401 to a request without a token", async () => {
    const result = await gate(request());

    expect(result).toMatchObject({ ok: false, response: { status: 401 } });
  });
});
