import type { JsonObject, JsonValue } from "type-fest";

import { describe, expect, test } from "bun:test";

import type { ActionReport, ActionRequest } from "./action-runner.ts";
import type { Emit } from "./events/event.ts";
import type { BoundReflex } from "./reflex-runner.ts";

import { ActionRunner } from "./action-runner.ts";
import { Body } from "./body.ts";
import { ReflexRunner } from "./reflex-runner.ts";

function create(reflexes: Array<BoundReflex<unknown>>) {
  const body = new Body();
  const events: Array<{ kind: string; payload: JsonObject }> = [];
  const emit: Emit = (kind, payload) => {
    events.push({ kind: kind.kind, payload });
  };
  const reflexRunner = new ReflexRunner({ body, emit, stopGraceMs: 30 });
  const actionRunner = new ActionRunner({ body, stopGraceMs: 30 });
  const check = () => reflexRunner.check(reflexes);
  return { body, events, reflexRunner, actionRunner, check };
}

// A reflex that sees trouble and acts on it. The test decides when the act ends.
// It stops when told to, unless `stubborn`.
function controllable(name: string, stubborn = false) {
  const act = Promise.withResolvers<void>();
  const signals: Array<AbortSignal> = [];
  const reflex: BoundReflex<unknown> = {
    name,
    limitMs: 1000,
    observe: () => ({ air: 3 }),
    decide: () => Promise.resolve("surface"),
    execute: (signal) => {
      signals.push(signal);
      if (!stubborn) {
        signal.addEventListener("abort", () => {
          act.resolve();
        });
      }
      return act.promise;
    },
  };
  return { reflex, act, signals };
}

// An action that runs until it is told to stop.
function holding(suppressReflexes: Array<string> = []) {
  return {
    name: "hold",
    suppressReflexes,
    run: ({ signal }: { signal: AbortSignal }) =>
      new Promise<JsonValue>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("stopped"));
        });
      }),
  };
}

function kinds(events: Array<{ kind: string }>) {
  return events.map((event) => event.kind);
}

// Puts an action in the queue and waits a tick, so that it runs if the body lets it.
async function begin(runner: ActionRunner, action: ActionRequest): Promise<ActionReport> {
  const result = runner.enqueue(action);
  if (!result.accepted) {
    throw new Error("expected the action to be queued");
  }
  await Bun.sleep(0);
  return result.report;
}

function payloads(events: Array<{ kind: string; payload: JsonObject }>, kind: string) {
  return events.flatMap((event) => (event.kind === kind ? [event.payload] : []));
}

describe("ReflexRunner", () => {
  test("runs a reflex that decides to act, then gives the body back", async () => {
    const { reflex, act, signals } = controllable("drowning");
    const { body, events, check } = create([reflex]);

    const checking = check();
    await Bun.sleep(0);

    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });
    expect(signals).toHaveLength(1);
    expect(events).toEqual([
      {
        kind: "reflex.activated",
        payload: { reflex: "drowning", decision: "surface", interruptedActionId: null },
      },
    ]);

    act.resolve();
    await checking;

    expect(body.holder).toBeUndefined();
    expect(payloads(events, "reflex.ended")).toEqual([
      { reflex: "drowning", outcome: "completed", message: null, stopped: true },
    ]);
  });

  test("does not ask for a decision while all is well", async () => {
    const { reflex } = controllable("drowning");
    let decisions = 0;
    reflex.observe = () => undefined;
    reflex.decide = () => {
      decisions += 1;
      return Promise.resolve("surface");
    };
    const { events, check } = create([reflex]);

    await check();

    expect(decisions).toBe(0);
    expect(events).toEqual([]);
  });

  test("leaves a running action alone when the decision is to do nothing", async () => {
    const { reflex } = controllable("drowning");
    reflex.decide = () => Promise.resolve(undefined);
    const { body, events, actionRunner, check } = create([reflex]);
    await begin(actionRunner, holding());

    await check();

    expect(body.holder?.kind).toBe("action");
    expect(events).toEqual([]);
  });

  test("stops a running action to act, and says which one", async () => {
    const { reflex, act } = controllable("drowning");
    const { events, actionRunner, check } = create([reflex]);
    const { actionId } = await begin(actionRunner, holding());

    const checking = check();
    await Bun.sleep(0);

    expect(await actionRunner.ended(actionId)).toMatchObject({
      status: "interrupted",
      by: "reflex",
      reflex: "drowning",
      stopped: true,
    });
    expect(payloads(events, "reflex.activated")).toEqual([
      { reflex: "drowning", decision: "surface", interruptedActionId: actionId },
    ]);

    act.resolve();
    await checking;
  });

  test("stays out while an action suppresses the reflex, and acts once that action ends", async () => {
    const { reflex, act } = controllable("drowning");
    const { body, events, actionRunner, check } = create([reflex]);
    const { actionId } = await begin(actionRunner, holding(["drowning"]));

    await check();

    expect(body.holder).toEqual({ kind: "action", id: actionId });
    expect(events).toEqual([]);

    actionRunner.cancel(actionId);
    await actionRunner.ended(actionId);
    const checking = check();
    await Bun.sleep(0);

    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });

    act.resolve();
    await checking;
  });

  test("gives way to an action that suppresses the running reflex", async () => {
    const { reflex, signals } = controllable("drowning");
    const { body, events, actionRunner, check } = create([reflex]);
    const checking = check();
    await Bun.sleep(0);

    const started = await begin(actionRunner, holding(["drowning"]));
    await checking;

    expect(actionRunner.report(started.actionId)).toMatchObject({ status: "running" });
    expect(signals[0]?.aborted).toBe(true);
    expect(body.holder?.kind).toBe("action");
    expect(payloads(events, "reflex.ended")).toEqual([
      { reflex: "drowning", outcome: "overruled", message: null, stopped: true },
    ]);
  });

  test("holds back an action that does not suppress the running reflex until the reflex ends", async () => {
    const { reflex, act } = controllable("drowning");
    const { body, actionRunner, check } = create([reflex]);
    const checking = check();
    await Bun.sleep(0);

    const queued = await begin(actionRunner, holding());

    expect(actionRunner.report(queued.actionId)).toMatchObject({ status: "queued", ahead: 0 });
    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });

    act.resolve();
    await checking;
    await Bun.sleep(0);

    expect(actionRunner.report(queued.actionId)).toMatchObject({ status: "running" });
  });

  test("takes the body from a reflex that ignores the order to stop", async () => {
    const { reflex } = controllable("drowning", true);
    const { body, events, actionRunner, check } = create([reflex]);
    const checking = check();
    await Bun.sleep(0);

    const started = await begin(actionRunner, holding(["drowning"]));
    await checking;

    expect(actionRunner.report(started.actionId)).toMatchObject({ status: "running" });
    expect(body.holder?.kind).toBe("action");
    expect(payloads(events, "reflex.ended")).toEqual([
      { reflex: "drowning", outcome: "overruled", message: null, stopped: false },
    ]);
  });

  test("stops a reflex that reaches its time limit", async () => {
    const { reflex, signals } = controllable("drowning");
    reflex.limitMs = 20;
    const { body, events, check } = create([reflex]);

    await check();

    expect(signals[0]?.aborted).toBe(true);
    expect(body.holder).toBeUndefined();
    expect(payloads(events, "reflex.ended")).toEqual([
      { reflex: "drowning", outcome: "timed_out", message: null, stopped: true },
    ]);
  });

  test("stops the running reflex when the bot disconnects, and works on the next connection", async () => {
    const { reflex } = controllable("drowning");
    const { body, events, reflexRunner, check } = create([reflex]);
    const checking = check();
    await Bun.sleep(0);

    reflexRunner.disconnected();
    await checking;

    expect(body.holder).toBeUndefined();
    expect(payloads(events, "reflex.ended")).toEqual([
      { reflex: "drowning", outcome: "disconnected", message: null, stopped: true },
    ]);

    const next = Promise.withResolvers<void>();
    reflex.execute = () => next.promise;
    const again = check();
    await Bun.sleep(0);

    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });

    next.resolve();
    await again;
  });

  test("asks a reflex for one decision at a time", async () => {
    const { reflex } = controllable("drowning");
    const decision = Promise.withResolvers<string | undefined>();
    let decisions = 0;
    reflex.decide = () => {
      decisions += 1;
      return decision.promise;
    };
    const { check } = create([reflex]);

    const first = check();
    await check();

    expect(decisions).toBe(1);

    decision.resolve(undefined);
    await first;
  });

  test("drops a decision that arrives after the bot disconnected", async () => {
    const { reflex } = controllable("drowning");
    const decision = Promise.withResolvers<string | undefined>();
    reflex.decide = () => decision.promise;
    const { body, events, reflexRunner, check } = create([reflex]);
    const checking = check();

    reflexRunner.disconnected();
    decision.resolve("surface");
    await checking;

    expect(body.holder).toBeUndefined();
    expect(events).toEqual([]);
  });

  test("drops a decision that arrives after the trouble has passed", async () => {
    const { reflex } = controllable("drowning");
    const decision = Promise.withResolvers<string | undefined>();
    reflex.decide = () => decision.promise;
    const { body, events, actionRunner, check } = create([reflex]);
    await begin(actionRunner, holding());
    const checking = check();

    reflex.observe = () => undefined;
    decision.resolve("surface");
    await checking;

    expect(body.holder?.kind).toBe("action");
    expect(events).toEqual([]);
  });

  test("reports a reflex whose act fails, and gives the body back", async () => {
    const { reflex } = controllable("drowning");
    reflex.execute = () => Promise.reject(new Error("no way up"));
    const { body, events, check } = create([reflex]);

    await check();

    expect(body.holder).toBeUndefined();
    expect(payloads(events, "reflex.ended")).toEqual([
      { reflex: "drowning", outcome: "failed", message: "no way up", stopped: true },
    ]);
  });

  test("keeps the other reflexes running when one cannot observe or decide", async () => {
    const blind = controllable("blind").reflex;
    blind.observe = () => {
      throw new Error("cannot see");
    };
    const undecided = controllable("undecided").reflex;
    undecided.decide = () => Promise.reject(new Error("cannot decide"));
    const { reflex, act } = controllable("drowning");
    const { body, check } = create([blind, undecided, reflex]);

    const checking = check();
    await Bun.sleep(0);

    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });

    act.resolve();
    await checking;
  });

  test("lets one reflex act at a time", async () => {
    const drowning = controllable("drowning");
    const fleeing = controllable("fleeing");
    const { body, events, check } = create([drowning.reflex, fleeing.reflex]);

    const first = check();
    await Bun.sleep(0);

    expect(fleeing.signals).toHaveLength(0);

    drowning.reflex.observe = () => undefined;
    drowning.act.resolve();
    await first;
    const second = check();
    await Bun.sleep(0);

    expect(body.holder).toEqual({ kind: "reflex", name: "fleeing" });

    fleeing.act.resolve();
    await second;
    expect(kinds(events)).toEqual([
      "reflex.activated",
      "reflex.ended",
      "reflex.activated",
      "reflex.ended",
    ]);
  });
});
