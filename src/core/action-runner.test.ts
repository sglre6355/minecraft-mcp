import type { JsonObject, JsonValue } from "type-fest";

import { describe, expect, test } from "bun:test";

import type { ActionControl, ActionReport, StartResult } from "./action-runner.ts";
import type { Emit } from "./events/event.ts";

import { ActionRunner } from "./action-runner.ts";
import { Body } from "./body.ts";

function create(emitting: Emit | undefined = undefined) {
  const body = new Body();
  const events: Array<{ kind: string; payload: JsonObject }> = [];
  const record: Emit = (kind, payload) => {
    events.push({ kind: kind.kind, payload });
  };
  const runner = new ActionRunner({ body, emit: emitting ?? record, waitMs: 30, stopGraceMs: 30 });
  return { body, events, runner };
}

// An action whose end the test decides. It stops when told to, unless `stubborn`.
function controllable(stubborn = false) {
  const outcome = Promise.withResolvers<JsonValue>();
  const controls: Array<ActionControl> = [];
  const run = (control: ActionControl) => {
    controls.push(control);
    if (!stubborn) {
      control.signal.addEventListener("abort", () => {
        outcome.reject(new Error("stopped"));
      });
    }
    return outcome.promise;
  };
  return { run, outcome, controls };
}

function request(run: (control: ActionControl) => Promise<JsonValue>) {
  return { name: "move_to", suppressReflexes: [], run };
}

function started(result: StartResult): ActionReport {
  if (!result.started) {
    throw new Error("expected the action to start");
  }
  return result.report;
}

function kinds(events: Array<{ kind: string }>) {
  return events.map((event) => event.kind);
}

const failing: Emit = () => {
  throw new Error("cannot send");
};

describe("ActionRunner", () => {
  test("returns the output of an action that finishes within the wait", async () => {
    const { body, events, runner } = create();

    const report = started(await runner.start(request(() => Promise.resolve({ reached: true }))));

    expect(report).toMatchObject({
      name: "move_to",
      status: "completed",
      output: { reached: true },
    });
    expect(kinds(events)).toEqual(["action.started", "action.completed"]);
    expect(body.holder).toBeUndefined();
  });

  test("reports an action that throws as failed", async () => {
    const { body, events, runner } = create();

    const report = started(await runner.start(request(() => Promise.reject(new Error("no path")))));

    expect(report).toMatchObject({ status: "failed", message: "no path" });
    expect(kinds(events)).toEqual(["action.started", "action.failed"]);
    expect(body.holder).toBeUndefined();
  });

  test("reports an action that throws before it returns a promise as failed", async () => {
    const { body, runner } = create();

    const report = started(
      await runner.start(
        request(() => {
          throw new Error("bad state");
        }),
      ),
    );

    expect(report).toMatchObject({ status: "failed", message: "bad state" });
    expect(body.holder).toBeUndefined();
  });

  test("returns a running report once the wait is over, and finishes later", async () => {
    const { body, events, runner } = create();
    const action = controllable();

    const report = started(await runner.start(request(action.run)));

    expect(report).toMatchObject({ status: "running", progress: null });
    expect(body.holder).toEqual({ kind: "action", id: report.actionId });

    action.outcome.resolve("done");
    await Bun.sleep(0);

    expect(runner.report(report.actionId)).toMatchObject({ status: "completed", output: "done" });
    expect(kinds(events)).toEqual(["action.started", "action.completed"]);
    expect(body.holder).toBeUndefined();
  });

  test("refuses a second action and names the one that runs", async () => {
    const { runner } = create();
    const action = controllable();
    const first = started(await runner.start(request(action.run)));

    const second = await runner.start(request(() => Promise.resolve(null)));

    expect(second).toEqual({ started: false, heldBy: { kind: "action", id: first.actionId } });
    expect(first.status).toBe("running");
  });

  test("gives each action a different ID", async () => {
    const { runner } = create();

    const first = started(await runner.start(request(() => Promise.resolve(null))));
    const second = started(await runner.start(request(() => Promise.resolve(null))));

    expect(second.actionId).not.toBe(first.actionId);
  });

  test("stores and announces the progress of a running action", async () => {
    const { events, runner } = create();
    const action = controllable();
    const report = started(await runner.start(request(action.run)));

    action.controls[0]?.progress({ distance: 12 });

    expect(runner.report(report.actionId)).toMatchObject({
      status: "running",
      progress: { distance: 12 },
    });
    expect(events.at(-1)).toEqual({
      kind: "action.progress",
      payload: { actionId: report.actionId, name: "move_to", data: { distance: 12 } },
    });
  });

  test("ignores progress from an action that has ended", async () => {
    const { events, runner } = create();
    const action = controllable();
    const report = started(await runner.start(request(action.run)));
    action.outcome.resolve(null);
    await Bun.sleep(0);

    action.controls[0]?.progress({ distance: 1 });

    expect(runner.report(report.actionId)).toMatchObject({ status: "completed" });
    expect(kinds(events)).toEqual(["action.started", "action.completed"]);
  });

  test("cancels a running action for the agent", async () => {
    const { body, events, runner } = create();
    const action = controllable();
    const report = started(await runner.start(request(action.run)));

    const cancelled = await runner.cancel(report.actionId);

    expect(cancelled).toMatchObject({
      status: "interrupted",
      by: "agent",
      reflex: null,
      stopped: true,
    });
    expect(kinds(events)).toEqual(["action.started", "action.interrupted"]);
    expect(body.holder).toBeUndefined();
  });

  test("returns the report of an action that had already ended when cancelled", async () => {
    const { runner } = create();
    const report = started(await runner.start(request(() => Promise.resolve("done"))));

    expect(await runner.cancel(report.actionId)).toMatchObject({ status: "completed" });
  });

  test("knows nothing of an ID it never issued", async () => {
    const { runner } = create();

    expect(runner.report("nope")).toBeUndefined();
    expect(await runner.cancel("nope")).toBeUndefined();
  });

  test("reports the latest action when asked without an ID", async () => {
    const { runner } = create();

    expect(runner.report()).toBeUndefined();
    const report = started(await runner.start(request(() => Promise.resolve("done"))));
    expect(runner.report()).toEqual(report);
  });

  test("gives the body to a reflex and reports which one interrupted", async () => {
    const { body, events, runner } = create();
    const action = controllable();
    const report = started(await runner.start(request(action.run)));

    const grant = await body.acquireForReflex("drowning");

    expect(grant.granted).toBe(true);
    expect(runner.report(report.actionId)).toMatchObject({
      status: "interrupted",
      by: "reflex",
      reflex: "drowning",
      stopped: true,
    });
    expect(events.at(-1)).toMatchObject({
      kind: "action.interrupted",
      payload: { actionId: report.actionId, by: "reflex", reflex: "drowning" },
    });
  });

  test("keeps a reflex the action suppresses away from the body", async () => {
    const { body, runner } = create();
    const action = controllable();
    const report = started(
      await runner.start({
        name: "place_block",
        suppressReflexes: ["low-health"],
        run: action.run,
      }),
    );

    const grant = await body.acquireForReflex("low-health");

    expect(grant.granted).toBe(false);
    expect(runner.report(report.actionId)).toMatchObject({ status: "running" });
  });

  test("interrupts the running action when the bot dies", async () => {
    const { body, runner } = create();
    const action = controllable();
    const report = started(await runner.start(request(action.run)));

    runner.died();
    await Bun.sleep(0);

    expect(runner.report(report.actionId)).toMatchObject({ status: "interrupted", by: "death" });
    expect(body.holder).toBeUndefined();
  });

  test("interrupts the running action when the bot disconnects", async () => {
    const { body, runner } = create();
    const action = controllable();
    const report = started(await runner.start(request(action.run)));

    runner.disconnected();
    await Bun.sleep(0);

    expect(runner.report(report.actionId)).toMatchObject({
      status: "interrupted",
      by: "disconnect",
    });
    expect(body.holder).toBeUndefined();
  });

  test("lets go of the body when an action ignores the order to stop", async () => {
    const { body, events, runner } = create();
    const action = controllable(true);
    const report = started(await runner.start(request(action.run)));

    const cancelled = await runner.cancel(report.actionId);

    expect(cancelled).toMatchObject({ status: "interrupted", by: "agent", stopped: false });
    expect(body.holder).toBeUndefined();

    action.outcome.resolve("late");
    await Bun.sleep(0);

    expect(runner.report(report.actionId)).toMatchObject({ status: "interrupted" });
    expect(kinds(events)).toEqual(["action.started", "action.interrupted"]);
  });

  test("lets a reflex in even when the action ignores the order to stop", async () => {
    const { body, runner } = create();
    const action = controllable(true);
    started(await runner.start(request(action.run)));

    const grant = await body.acquireForReflex("drowning");

    expect(grant.granted).toBe(true);
    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });
  });

  test("still runs the action and frees the body when events cannot be sent", async () => {
    const { body, runner } = create(failing);

    const report = started(await runner.start(request(() => Promise.resolve("done"))));

    expect(report).toMatchObject({ status: "completed", output: "done" });
    expect(body.holder).toBeUndefined();
  });

  test("forgets the oldest reports beyond its memory", async () => {
    const { runner } = create();
    const first = started(await runner.start(request(() => Promise.resolve(null))));

    for (let count = 0; count < 32; count += 1) {
      await runner.start(request(() => Promise.resolve(null)));
    }

    expect(runner.report(first.actionId)).toBeUndefined();
  });
});
