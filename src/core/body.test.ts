import { describe, expect, test } from "bun:test";

import type { BodyLease } from "./body.ts";

import { Body } from "./body.ts";

function granted(grant: { granted: true; lease: BodyLease } | { granted: false }): BodyLease {
  if (!grant.granted) {
    throw new Error("expected the body to be granted");
  }
  return grant.lease;
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Bun.sleep(0);
  return done;
}

describe("Body", () => {
  test("grants a free body to an action", async () => {
    const body = new Body();

    const grant = await body.acquireForAction("a1", []);

    expect(grant.granted).toBe(true);
    expect(body.holder).toEqual({ kind: "action", id: "a1" });
  });

  test("refuses a second action while one runs", async () => {
    const body = new Body();
    const first = granted(await body.acquireForAction("a1", []));

    const second = await body.acquireForAction("a2", []);

    expect(second).toEqual({ granted: false, heldBy: { kind: "action", id: "a1" } });
    expect(first.signal.aborted).toBe(false);
  });

  test("frees the body on release", async () => {
    const body = new Body();
    const first = granted(await body.acquireForAction("a1", []));

    first.release();

    expect(body.holder).toBeUndefined();
    expect((await body.acquireForAction("a2", [])).granted).toBe(true);
  });

  test("lets a reflex interrupt an action and waits for the action to let go", async () => {
    const body = new Body();
    const action = granted(await body.acquireForAction("a1", []));

    const pending = body.acquireForReflex("drowning");

    expect(await settled(pending)).toBe(false);
    expect(action.signal.aborted).toBe(true);
    expect(action.signal.reason).toEqual({ kind: "reflex", name: "drowning" });

    action.release();
    const grant = await pending;

    expect(grant).toMatchObject({ granted: true, interrupted: { kind: "action", id: "a1" } });
    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });
  });

  test("keeps a reflex out while the action suppresses it", async () => {
    const body = new Body();
    const action = granted(await body.acquireForAction("a1", ["low-health"]));

    const grant = await body.acquireForReflex("low-health");

    expect(grant).toEqual({
      granted: false,
      reason: "suppressed",
      heldBy: { kind: "action", id: "a1" },
    });
    expect(action.signal.aborted).toBe(false);
  });

  test("lets a reflex the action did not name interrupt it", async () => {
    const body = new Body();
    const action = granted(await body.acquireForAction("a1", ["low-health"]));

    const pending = body.acquireForReflex("drowning");
    action.release();

    expect((await pending).granted).toBe(true);
  });

  test("refuses a reflex while another reflex runs", async () => {
    const body = new Body();
    const first = granted(await body.acquireForReflex("drowning"));

    const second = await body.acquireForReflex("low-health");

    expect(second).toEqual({
      granted: false,
      reason: "busy",
      heldBy: { kind: "reflex", name: "drowning" },
    });
    expect(first.signal.aborted).toBe(false);
  });

  test("refuses an action while a reflex runs", async () => {
    const body = new Body();
    const reflex = granted(await body.acquireForReflex("drowning"));

    const grant = await body.acquireForAction("a1", []);

    expect(grant).toEqual({ granted: false, heldBy: { kind: "reflex", name: "drowning" } });
    expect(reflex.signal.aborted).toBe(false);
  });

  test("lets an action that suppresses the running reflex take over", async () => {
    const body = new Body();
    const reflex = granted(await body.acquireForReflex("low-health"));

    const pending = body.acquireForAction("a1", ["low-health"]);

    expect(await settled(pending)).toBe(false);
    expect(reflex.signal.reason).toEqual({ kind: "action", id: "a1" });

    reflex.release();
    const grant = await pending;

    expect(grant).toMatchObject({
      granted: true,
      interrupted: { kind: "reflex", name: "low-health" },
    });
    expect(body.holder).toEqual({ kind: "action", id: "a1" });
  });

  test("refuses others while a takeover is waiting", async () => {
    const body = new Body();
    const action = granted(await body.acquireForAction("a1", []));
    const pending = body.acquireForReflex("drowning");

    const other = await body.acquireForAction("a2", []);

    expect(other).toEqual({ granted: false, heldBy: { kind: "reflex", name: "drowning" } });
    action.release();
    await pending;
  });

  test("keeps the body with the new holder when an interrupted holder releases late", async () => {
    const body = new Body();
    const action = granted(await body.acquireForAction("a1", []));
    const pending = body.acquireForReflex("drowning");
    action.release();
    await pending;

    action.release();

    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });
  });
});
