import { afterEach, describe, expect, test } from "bun:test";

import type { EventOccurrence } from "../protocol/events.ts";

import { configSchema } from "../config/schema.ts";
import { restartDelay, Supervisor } from "./supervisor.ts";

const workerUrl = new URL("./supervisor.fixture.ts", import.meta.url);

let supervisor: Supervisor | undefined;

afterEach(() => {
  supervisor?.stop();
  supervisor = undefined;
});

function create(host = "localhost") {
  const events: Array<EventOccurrence> = [];
  supervisor = new Supervisor({
    workerUrl,
    config: configSchema.parse({ minecraft: { host, username: "bot" } }),
    onEvent: (event) => events.push(event),
    pingIntervalMs: 20,
    missedPingLimit: 10,
    restartDelayMs: 10,
  });
  return { supervisor, events };
}

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("the condition did not hold in time");
    }
    await Bun.sleep(10);
  }
}

describe("Supervisor", () => {
  test("starts the core and takes its tool descriptors", async () => {
    const { supervisor } = create();

    await supervisor.start();

    expect(supervisor.tools.map((tool) => tool.name)).toEqual(["echo"]);
    expect(supervisor.eventKinds.map((kind) => kind.kind)).toEqual(["core.restarted"]);
  });

  test("passes a call to the core and returns its result", async () => {
    const { supervisor } = create();
    await supervisor.start();

    const result = await supervisor.call("echo", { text: "hi" });

    expect(result).toEqual({ ok: true, output: '{"text":"hi"}' });
  });

  test("hands core events to the listener", async () => {
    const { supervisor, events } = create();
    await supervisor.start();

    await supervisor.call("emit", {});

    expect(events).toEqual([{ kind: "test.event", occurredAt: new Date(0), payload: {} }]);
  });

  test("recreates a core that hangs", async () => {
    const { supervisor, events } = create();
    await supervisor.start();

    const result = await supervisor.call("hang", {});

    expect(result).toMatchObject({ ok: false, error: { code: "core_unavailable" } });
    expect(events).toMatchObject([{ kind: "core.restarted", payload: { reason: "unresponsive" } }]);
    await until(async () => (await supervisor.call("echo", 1)).ok);
  });

  test("recreates a core that crashes", async () => {
    const { supervisor, events } = create();
    await supervisor.start();

    const result = await supervisor.call("crash", {});

    expect(result).toMatchObject({ ok: false, error: { code: "core_unavailable" } });
    expect(events).toMatchObject([{ kind: "core.restarted", payload: { reason: "crashed" } }]);
    await until(async () => (await supervisor.call("echo", 1)).ok);
  });

  test("refuses calls while the core is down", async () => {
    const { supervisor } = create();
    await supervisor.start();
    supervisor.stop();

    const result = await supervisor.call("echo", {});

    expect(result).toMatchObject({ ok: false, error: { code: "core_unavailable" } });
  });

  test("fails to start when the core cannot start", async () => {
    const { supervisor } = create("fail-to-start");

    const outcome = await supervisor.start().then(() => "started", String);

    expect(outcome).toContain("The core failed to start");
  });

  test("fails to start when stopped before the core is ready", async () => {
    const { supervisor } = create();
    const started = supervisor.start();

    supervisor.stop();
    const outcome = await started.then(() => "started", String);

    expect(outcome).toContain("stopped before the core was ready");
  });

  test("keeps a core whose replies waited while the main thread was blocked", async () => {
    const { supervisor, events } = create();
    await supervisor.start();

    Bun.sleepSync(400);
    await Bun.sleep(100);

    expect(events).toEqual([]);
    expect(await supervisor.call("echo", 1)).toMatchObject({ ok: true });
  });

  test("keeps recreating a core that crashes right after it starts", async () => {
    const { supervisor, events } = create("crash-after-ready");
    await supervisor.start();

    await until(() => events.length >= 3);

    expect(events.every((event) => event.kind === "core.restarted")).toBe(true);
  });
});

describe("restartDelay", () => {
  test("starts at the base delay", () => {
    expect(restartDelay(0, 1000, 60_000)).toBe(1000);
  });

  test("doubles with each failure in a row", () => {
    expect(restartDelay(1, 1000, 60_000)).toBe(2000);
    expect(restartDelay(3, 1000, 60_000)).toBe(8000);
  });

  test("stops growing at the maximum", () => {
    expect(restartDelay(6, 1000, 60_000)).toBe(60_000);
    expect(restartDelay(2000, 1000, 60_000)).toBe(60_000);
  });
});
