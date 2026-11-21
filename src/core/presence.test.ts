import { describe, expect, test } from "bun:test";

import type { AttemptEvents, Cause } from "./presence.ts";

import { Presence, reconnectDelay, reconnects } from "./presence.ts";

const lost: Cause = { kind: "lost", detail: "socketClosed" };
const kicked = (key: string | null): Cause => ({ kind: "kicked", key, text: "" });

describe("reconnects", () => {
  test("joins again after a connection that broke without a kick", () => {
    expect(reconnects(lost)).toBe(true);
    expect(reconnects({ kind: "lost", detail: "connect ECONNREFUSED 127.0.0.1:25565" })).toBe(true);
  });

  test("joins again when the server stops or logging in fails for a passing reason", () => {
    expect(reconnects(kicked("multiplayer.disconnect.server_shutdown"))).toBe(true);
    expect(reconnects(kicked("multiplayer.disconnect.slow_login"))).toBe(true);
    expect(reconnects(kicked("multiplayer.disconnect.authservers_down"))).toBe(true);
    expect(reconnects(kicked("disconnect.timeout"))).toBe(true);
  });

  test("stays out when someone decided the bot should be out", () => {
    expect(reconnects(kicked("multiplayer.disconnect.kicked"))).toBe(false);
    expect(reconnects(kicked("multiplayer.disconnect.banned"))).toBe(false);
    expect(reconnects(kicked("multiplayer.disconnect.banned.reason"))).toBe(false);
    expect(reconnects(kicked("multiplayer.disconnect.not_whitelisted"))).toBe(false);
    expect(reconnects(kicked("multiplayer.disconnect.duplicate_login"))).toBe(false);
  });

  test("stays out after a kick for what the bot did", () => {
    expect(reconnects(kicked("disconnect.spam"))).toBe(false);
    expect(reconnects(kicked("multiplayer.disconnect.flying"))).toBe(false);
    expect(reconnects(kicked("multiplayer.disconnect.illegal_characters"))).toBe(false);
  });

  test("stays out after a kick with a reason it does not know", () => {
    expect(reconnects(kicked(null))).toBe(false);
    expect(reconnects(kicked("some.plugin.reason"))).toBe(false);
  });

  test("stays out when the agent asked to leave", () => {
    expect(reconnects({ kind: "requested" })).toBe(false);
  });
});

describe("reconnectDelay", () => {
  test("doubles with each failure in a row, up to the maximum", () => {
    expect(reconnectDelay(0, 1000, 60_000)).toBe(1000);
    expect(reconnectDelay(1, 1000, 60_000)).toBe(2000);
    expect(reconnectDelay(5, 1000, 60_000)).toBe(32_000);
    expect(reconnectDelay(6, 1000, 60_000)).toBe(60_000);
    expect(reconnectDelay(30, 1000, 60_000)).toBe(60_000);
  });
});

interface Dialled {
  target: string;
  auto: boolean;
  events: AttemptEvents;
  hungUp: boolean;
}

const baseDelayMs = 10;

function create(stableAfterMs = 1000) {
  const dialled: Array<Dialled> = [];
  const disconnections: Array<{ cause: Cause; retryInMs: number | null }> = [];
  const targets: Array<string | undefined> = [];
  const presence = new Presence<string>({
    dial: (target, auto, events) => {
      const attempt: Dialled = { target, auto, events, hungUp: false };
      dialled.push(attempt);
      return {
        hangUp: () => {
          attempt.hungUp = true;
          events.ended({ kind: "requested" });
        },
      };
    },
    onDisconnected: (cause, retryInMs) => {
      disconnections.push({ cause, retryInMs });
    },
    onTarget: (target) => {
      targets.push(target);
    },
    baseDelayMs,
    maxDelayMs: 40,
    stableAfterMs,
  });
  // The attempt dialled last.
  const latest = () => {
    const attempt = dialled.at(-1);
    if (attempt === undefined) {
      throw new Error("nothing was dialled");
    }
    return attempt.events;
  };
  return { presence, dialled, disconnections, targets, latest };
}

describe("Presence", () => {
  test("joins when asked and reports being in", async () => {
    const { presence, dialled, targets, latest } = create();

    const connecting = presence.connect("home");

    expect(presence.state).toBe("connecting");
    expect(dialled).toMatchObject([{ target: "home", auto: false }]);

    latest().joined();

    expect(await connecting).toEqual({ state: "connected" });
    expect(presence.state).toBe("connected");
    expect(targets).toEqual(["home"]);
  });

  test("does not repeat an attempt of the agent's own that fails", async () => {
    const { presence, dialled, disconnections, targets, latest } = create();
    const connecting = presence.connect("home");

    latest().ended(lost);
    await Bun.sleep(baseDelayMs * 3);

    expect(await connecting).toEqual({ state: "disconnected", cause: lost });
    expect(presence.state).toBe("disconnected");
    expect(dialled).toHaveLength(1);
    expect(disconnections).toEqual([{ cause: lost, retryInMs: null }]);
    expect(targets).toEqual(["home", undefined]);
  });

  test("says nothing when the agent gives up an attempt of its own", async () => {
    const { presence, disconnections } = create();
    const connecting = presence.connect("home");

    presence.disconnect();

    expect(await connecting).toEqual({ state: "disconnected", cause: { kind: "requested" } });
    expect(disconnections).toEqual([]);
  });

  test("dials once when asked twice", async () => {
    const { presence, dialled, latest } = create();

    const first = presence.connect("home");
    const second = presence.connect("home");
    latest().joined();
    const third = presence.connect("home");

    expect(await Promise.all([first, second, third])).toEqual([
      { state: "connected" },
      { state: "connected" },
      { state: "connected" },
    ]);
    expect(dialled).toHaveLength(1);
  });

  test("joins again after a drop that passes by itself", async () => {
    const { presence, dialled, disconnections, latest } = create();
    void presence.connect("home");
    latest().joined();

    latest().ended(lost);

    expect(presence.state).toBe("reconnecting");
    expect(disconnections).toEqual([{ cause: lost, retryInMs: baseDelayMs }]);

    await Bun.sleep(baseDelayMs * 2);

    expect(dialled).toMatchObject([{ auto: false }, { target: "home", auto: true }]);

    latest().joined();

    expect(presence.state).toBe("connected");
  });

  test("stays out after a kick that stands", async () => {
    const { presence, dialled, disconnections, targets, latest } = create();
    void presence.connect("home");
    latest().joined();
    const cause = kicked("multiplayer.disconnect.kicked");

    latest().ended(cause);
    await Bun.sleep(baseDelayMs * 3);

    expect(presence.state).toBe("disconnected");
    expect(dialled).toHaveLength(1);
    expect(disconnections).toEqual([{ cause, retryInMs: null }]);
    expect(targets).toEqual(["home", undefined]);
  });

  test("keeps trying while the server refuses, and reports the drop once", async () => {
    const { presence, dialled, disconnections, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);

    await Bun.sleep(baseDelayMs * 2);
    latest().ended({ kind: "lost", detail: "ECONNREFUSED" });
    await Bun.sleep(baseDelayMs * 3);
    latest().ended({ kind: "lost", detail: "ECONNREFUSED" });
    await Bun.sleep(baseDelayMs * 5);

    expect(dialled).toHaveLength(4);
    expect(presence.state).toBe("reconnecting");
    expect(disconnections).toHaveLength(1);
  });

  test("gives up, and says so, when a try to get back in is kicked for good", async () => {
    const { presence, disconnections, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);
    await Bun.sleep(baseDelayMs * 2);
    const banned = kicked("multiplayer.disconnect.banned.reason");

    latest().ended(banned);
    await Bun.sleep(baseDelayMs * 3);

    expect(presence.state).toBe("disconnected");
    expect(disconnections).toEqual([
      { cause: lost, retryInMs: baseDelayMs },
      { cause: banned, retryInMs: null },
    ]);
  });

  test("waits longer after each drop, and starts over after a connection that held", async () => {
    const { presence, disconnections, latest } = create(30);
    void presence.connect("home");
    latest().joined();

    latest().ended(lost);
    await Bun.sleep(baseDelayMs * 2);
    latest().joined();
    latest().ended(lost);
    await Bun.sleep(baseDelayMs * 3);
    latest().joined();
    await Bun.sleep(40);
    latest().ended(lost);

    expect(disconnections.map((entry) => entry.retryInMs)).toEqual([
      baseDelayMs,
      baseDelayMs * 2,
      baseDelayMs,
    ]);
    presence.disconnect();
  });

  test("leaves when asked, and does not come back", async () => {
    const { presence, dialled, disconnections, targets, latest } = create();
    void presence.connect("home");
    latest().joined();

    presence.disconnect();
    await Bun.sleep(baseDelayMs * 3);

    expect(dialled).toMatchObject([{ hungUp: true }]);
    expect(presence.state).toBe("disconnected");
    expect(disconnections).toEqual([{ cause: { kind: "requested" }, retryInMs: null }]);
    expect(targets).toEqual(["home", undefined]);
  });

  test("stops waiting to join again when asked to leave", async () => {
    const { presence, dialled, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);

    presence.disconnect();
    await Bun.sleep(baseDelayMs * 3);

    expect(presence.state).toBe("disconnected");
    expect(dialled).toHaveLength(1);
  });

  test("joins at once when the agent asks during the wait", async () => {
    const { presence, dialled, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);

    void presence.connect("elsewhere");
    await Bun.sleep(baseDelayMs * 3);

    expect(dialled).toMatchObject([{ target: "home" }, { target: "home" }]);
  });

  test("keeps trying when the agent asks during an outage and the server is still away", async () => {
    const { presence, dialled, disconnections, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);

    const hurried = presence.connect("home");
    latest().ended({ kind: "lost", detail: "ECONNREFUSED" });
    await Bun.sleep(baseDelayMs * 3);

    expect(await hurried).toMatchObject({ state: "disconnected" });
    expect(presence.state).toBe("reconnecting");
    expect(dialled).toHaveLength(3);
    expect(disconnections).toHaveLength(1);
    presence.disconnect();
  });

  test("keeps trying when the agent asks while a try is under way", async () => {
    const { presence, dialled, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);
    await Bun.sleep(baseDelayMs * 2);

    void presence.connect("home");
    latest().ended({ kind: "lost", detail: "ECONNREFUSED" });
    await Bun.sleep(baseDelayMs * 3);

    expect(presence.state).toBe("reconnecting");
    expect(dialled).toHaveLength(3);
    presence.disconnect();
  });

  test("starts from the shortest wait in a new session", async () => {
    const { presence, disconnections, latest } = create();
    void presence.connect("home");
    latest().joined();
    latest().ended(lost);
    await Bun.sleep(baseDelayMs * 2);
    latest().joined();
    latest().ended(lost);
    presence.disconnect();

    void presence.connect("home");
    latest().joined();
    latest().ended(lost);

    expect(disconnections.at(-1)).toEqual({ cause: lost, retryInMs: baseDelayMs });
    presence.disconnect();
  });

  test("ignores what an attempt it has left behind reports", async () => {
    const { presence, dialled, latest } = create();
    void presence.connect("home");
    const old = latest();
    old.joined();
    presence.disconnect();
    const connecting = presence.connect("home");

    old.ended(lost);
    old.joined();

    expect(presence.state).toBe("connecting");
    expect(dialled).toHaveLength(2);

    latest().joined();
    expect(await connecting).toEqual({ state: "connected" });
  });

  test("repeats a failed attempt when it joins for an agent that asked earlier", async () => {
    const { presence, dialled, latest } = create();

    void presence.resume("home");
    latest().ended({ kind: "lost", detail: "ECONNREFUSED" });
    await Bun.sleep(baseDelayMs * 2);

    expect(dialled).toMatchObject([{ auto: true }, { auto: true }]);
    presence.disconnect();
  });
});
