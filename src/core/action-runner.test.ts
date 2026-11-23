import type { JsonValue } from "type-fest";

import { describe, expect, test } from "bun:test";

import type { ActionControl, ActionReport, Enqueued } from "./action-runner.ts";

import { ActionRunner } from "./action-runner.ts";
import { Body } from "./body.ts";

function create() {
  const body = new Body();
  const runner = new ActionRunner({ body, stopGraceMs: 30 });
  return { body, runner };
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

function request(run: (control: ActionControl) => Promise<JsonValue>, name = "move_to") {
  return { name, suppressReflexes: [], run };
}

function accepted(result: Enqueued): ActionReport {
  if (!result.accepted) {
    throw new Error("expected the action to be queued");
  }
  return result.report;
}

// The report once the action has ended.
async function end(runner: ActionRunner, report: ActionReport): Promise<ActionReport> {
  const ended = runner.ended(report.actionId);
  if (ended === undefined) {
    throw new Error("expected the runner to know the action");
  }
  return ended;
}

describe("ActionRunner", () => {
  test("starts an action at once when nothing else runs", () => {
    const { body, runner } = create();
    const action = controllable();

    const report = accepted(runner.enqueue(request(action.run)));

    expect(report).toMatchObject({ name: "move_to", status: "running", progress: null });
    expect(body.holder).toEqual({ kind: "action", id: report.actionId });
  });

  test("reports the output of an action that completes", async () => {
    const { body, runner } = create();

    const report = accepted(runner.enqueue(request(() => Promise.resolve({ reached: true }))));

    expect(await end(runner, report)).toMatchObject({
      status: "completed",
      output: { reached: true },
    });
    expect(body.holder).toBeUndefined();
  });

  test("reports an action that throws as failed", async () => {
    const { body, runner } = create();

    const report = accepted(runner.enqueue(request(() => Promise.reject(new Error("no path")))));

    expect(await end(runner, report)).toMatchObject({ status: "failed", message: "no path" });
    expect(body.holder).toBeUndefined();
  });

  test("reports an action that throws before it returns a promise as failed", async () => {
    const { runner } = create();

    const report = accepted(
      runner.enqueue(
        request(() => {
          throw new Error("bad state");
        }),
      ),
    );

    expect(await end(runner, report)).toMatchObject({ status: "failed", message: "bad state" });
  });

  test("gives each action a different ID", () => {
    const { runner } = create();

    const first = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    const second = accepted(runner.enqueue(request(() => Promise.resolve(null))));

    expect(second.actionId).not.toBe(first.actionId);
  });

  test("keeps when an action was created and last changed", async () => {
    const { runner } = create();
    const action = controllable();
    const report = accepted(runner.enqueue(request(action.run)));

    await Bun.sleep(5);
    action.controls[0]?.progress({ distance: 3 });
    const later = runner.report(report.actionId);

    expect(Date.parse(report.createdAt)).not.toBeNaN();
    expect(later?.createdAt).toBe(report.createdAt);
    expect(Date.parse(later?.lastUpdatedAt ?? "")).toBeGreaterThan(Date.parse(report.createdAt));
  });

  test("queues an action behind the one that runs and starts it after", async () => {
    const { body, runner } = create();
    const first = controllable();
    const running = accepted(runner.enqueue(request(first.run)));

    const waiting = accepted(runner.enqueue(request(() => Promise.resolve("second"), "equip")));

    expect(waiting).toMatchObject({
      name: "equip",
      status: "queued",
      ahead: [{ actionId: running.actionId, name: "move_to" }],
    });
    expect(body.holder).toEqual({ kind: "action", id: running.actionId });

    first.outcome.resolve("first");

    expect(await end(runner, waiting)).toMatchObject({ status: "completed", output: "second" });
    expect(runner.report(running.actionId)).toMatchObject({ status: "completed" });
  });

  test("lists the actions ahead of a queued one in the order they will run", () => {
    const { runner } = create();
    const first = accepted(runner.enqueue(request(controllable().run)));
    const second = accepted(runner.enqueue(request(controllable().run, "smelt")));

    const third = accepted(runner.enqueue(request(controllable().run)));

    expect(third).toMatchObject({
      status: "queued",
      ahead: [
        { actionId: first.actionId, name: "move_to" },
        { actionId: second.actionId, name: "smelt" },
      ],
    });
  });

  test("skips every queued action when the one before it fails", async () => {
    const { body, runner } = create();
    const first = controllable();
    const failing = accepted(runner.enqueue(request(first.run)));
    const second = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    const third = accepted(runner.enqueue(request(() => Promise.resolve(null))));

    first.outcome.reject(new Error("no path"));

    expect(await end(runner, second)).toMatchObject({
      status: "skipped",
      after: { actionId: failing.actionId, name: "move_to" },
    });
    expect(await end(runner, third)).toMatchObject({
      status: "skipped",
      after: { actionId: failing.actionId, name: "move_to" },
    });
    expect(body.holder).toBeUndefined();
  });

  test("runs a new action after a failure skipped the queue", async () => {
    const { runner } = create();
    accepted(runner.enqueue(request(() => Promise.reject(new Error("no path")))));
    const skipped = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    await end(runner, skipped);

    const fresh = accepted(runner.enqueue(request(() => Promise.resolve("fresh"))));

    expect(await end(runner, fresh)).toMatchObject({ status: "completed", output: "fresh" });
  });

  test("refuses an action when the queue is full", () => {
    const { runner } = create();
    for (let count = 0; count < 17; count += 1) {
      accepted(runner.enqueue(request(controllable().run)));
    }

    expect(runner.enqueue(request(controllable().run))).toEqual({ accepted: false, waiting: 16 });
  });

  test("stores the progress of a running action", async () => {
    const { runner } = create();
    const action = controllable();
    const report = accepted(runner.enqueue(request(action.run)));
    await Bun.sleep(0);

    action.controls[0]?.progress({ distance: 12 });

    expect(runner.report(report.actionId)).toMatchObject({
      status: "running",
      progress: { distance: 12 },
    });
  });

  test("ignores progress from an action that has ended", async () => {
    const { runner } = create();
    const action = controllable();
    const report = accepted(runner.enqueue(request(action.run)));
    action.outcome.resolve(null);
    await end(runner, report);

    action.controls[0]?.progress({ distance: 1 });

    expect(runner.report(report.actionId)).toMatchObject({ status: "completed" });
  });

  test("cancels a running action and skips the ones behind it", async () => {
    const { body, runner } = create();
    const action = controllable();
    const report = accepted(runner.enqueue(request(action.run)));
    const behind = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    await Bun.sleep(0);

    runner.cancel(report.actionId);

    expect(await end(runner, report)).toMatchObject({ status: "canceled", stopped: true });
    expect(await end(runner, behind)).toMatchObject({
      status: "skipped",
      after: { actionId: report.actionId },
    });
    expect(body.holder).toBeUndefined();
  });

  test("cancels a queued action without touching the one that runs", async () => {
    const { runner } = create();
    const action = controllable();
    const running = accepted(runner.enqueue(request(action.run)));
    const queued = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    const last = accepted(runner.enqueue(request(() => Promise.resolve("last"))));

    runner.cancel(queued.actionId);

    expect(await end(runner, queued)).toMatchObject({ status: "canceled", stopped: true });
    expect(runner.report(running.actionId)).toMatchObject({ status: "running" });
    expect(runner.report(last.actionId)).toMatchObject({
      status: "queued",
      ahead: [{ actionId: running.actionId }],
    });

    action.outcome.resolve(null);
    expect(await end(runner, last)).toMatchObject({ status: "completed", output: "last" });
  });

  test("leaves an action that had already ended as it was", async () => {
    const { runner } = create();
    const report = accepted(runner.enqueue(request(() => Promise.resolve("done"))));
    await end(runner, report);

    expect(runner.cancel(report.actionId)).toMatchObject({ status: "completed" });
  });

  test("knows nothing of an ID it never issued", () => {
    const { runner } = create();

    expect(runner.report("nope")).toBeUndefined();
    expect(runner.ended("nope")).toBeUndefined();
    expect(runner.cancel("nope")).toBeUndefined();
  });

  test("gives the body to a reflex and skips the queue behind the interrupted action", async () => {
    const { body, runner } = create();
    const action = controllable();
    const report = accepted(runner.enqueue(request(action.run)));
    const behind = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    await Bun.sleep(0);

    const grant = await body.acquireForReflex("drowning");

    expect(grant.granted).toBe(true);
    expect(await end(runner, report)).toMatchObject({
      status: "interrupted",
      by: "reflex",
      reflex: "drowning",
      stopped: true,
    });
    expect(await end(runner, behind)).toMatchObject({
      status: "skipped",
      after: { actionId: report.actionId },
    });
  });

  test("waits for a reflex that holds the body before it starts an action", async () => {
    const { body, runner } = create();
    const grant = await body.acquireForReflex("drowning");
    if (!grant.granted) {
      throw new Error("expected the reflex to get the body");
    }

    const report = accepted(runner.enqueue(request(() => Promise.resolve("after"))));
    await Bun.sleep(5);

    expect(runner.report(report.actionId)).toMatchObject({ status: "queued", ahead: [] });

    grant.lease.release();

    expect(await end(runner, report)).toMatchObject({ status: "completed", output: "after" });
  });

  test("takes the body from a reflex the action suppresses", async () => {
    const { body, runner } = create();
    const grant = await body.acquireForReflex("drowning");
    if (!grant.granted) {
      throw new Error("expected the reflex to get the body");
    }

    const report = accepted(
      runner.enqueue({ name: "move_to", suppressReflexes: ["drowning"], run: controllable().run }),
    );
    await Bun.sleep(0);

    expect(grant.lease.signal.aborted).toBe(true);
    grant.lease.release();
    await Bun.sleep(0);
    expect(runner.report(report.actionId)).toMatchObject({ status: "running" });
  });

  test("keeps a reflex the action suppresses away from the body", async () => {
    const { body, runner } = create();
    const report = accepted(
      runner.enqueue({
        name: "place_block",
        suppressReflexes: ["low-health"],
        run: controllable().run,
      }),
    );

    const grant = await body.acquireForReflex("low-health");

    expect(grant.granted).toBe(false);
    expect(runner.report(report.actionId)).toMatchObject({ status: "running" });
  });

  test("interrupts the running action and skips the queue when the bot dies", async () => {
    const { body, runner } = create();
    const report = accepted(runner.enqueue(request(controllable().run)));
    const behind = accepted(runner.enqueue(request(() => Promise.resolve(null))));

    runner.died();

    expect(await end(runner, report)).toMatchObject({ status: "interrupted", by: "death" });
    expect(await end(runner, behind)).toMatchObject({
      status: "skipped",
      after: { actionId: report.actionId },
    });
    expect(body.holder).toBeUndefined();
  });

  test("interrupts the running action when the bot disconnects", async () => {
    const { body, runner } = create();
    const report = accepted(runner.enqueue(request(controllable().run)));

    runner.disconnected();

    expect(await end(runner, report)).toMatchObject({ status: "interrupted", by: "disconnect" });
    expect(body.holder).toBeUndefined();
  });

  test("lets go of the body when an action ignores the order to stop", async () => {
    const { body, runner } = create();
    const action = controllable(true);
    const report = accepted(runner.enqueue(request(action.run)));
    await Bun.sleep(0);

    runner.cancel(report.actionId);

    expect(await end(runner, report)).toMatchObject({ status: "canceled", stopped: false });
    expect(body.holder).toBeUndefined();

    action.outcome.resolve("late");
    await Bun.sleep(0);

    expect(runner.report(report.actionId)).toMatchObject({ status: "canceled" });
  });

  test("lets a reflex in even when the action ignores the order to stop", async () => {
    const { body, runner } = create();
    accepted(runner.enqueue(request(controllable(true).run)));

    const grant = await body.acquireForReflex("drowning");

    expect(grant.granted).toBe(true);
    expect(body.holder).toEqual({ kind: "reflex", name: "drowning" });
  });

  test("forgets the oldest reports beyond its memory", async () => {
    const { runner } = create();
    const first = accepted(runner.enqueue(request(() => Promise.resolve(null))));
    await end(runner, first);

    for (let count = 0; count < 64; count += 1) {
      await end(runner, accepted(runner.enqueue(request(() => Promise.resolve(null)))));
    }

    expect(runner.report(first.actionId)).toBeUndefined();
  });
});
