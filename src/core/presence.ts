// Why an attempt to be in a server ended.
export type Cause =
  // The agent asked to leave.
  | { kind: "requested" }
  // The server sent the bot away. `key` is the translation key of a vanilla reason.
  // A reason a plugin or a proxy wrote has none.
  | { kind: "kicked"; key: string | null; text: string }
  // The connection broke, or never came about, without a word from the server.
  | { kind: "lost"; detail: string };

// What a cause reads like to the agent.
export function describeCause(cause: Cause): string {
  switch (cause.kind) {
    case "requested":
      return "The agent disconnected.";
    case "kicked":
      return cause.text;
    case "lost":
      return cause.detail;
  }
}

// The kicks that pass by themselves: the server is stopping, or logging in took too long.
const passing = new Set([
  "multiplayer.disconnect.server_shutdown",
  "multiplayer.disconnect.slow_login",
  "multiplayer.disconnect.authservers_down",
  "disconnect.timeout",
  "disconnect.loginFailedInfo.serversUnavailable",
]);

// Whether to join again without asking the agent.
// Any other kick stands until the agent decides, so a server that kicks on every join is not
// joined in a loop, and a ban or a second login under the same name is not fought.
export function reconnects(cause: Cause): boolean {
  switch (cause.kind) {
    case "requested":
      return false;
    case "kicked":
      return cause.key !== null && passing.has(cause.key);
    case "lost":
      return true;
  }
}

// Doubles with each failure in a row, up to the maximum.
export function reconnectDelay(failuresInARow: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** failuresInARow, maxMs);
}

export type PresenceState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface Attempt {
  // Ends the attempt.
  hangUp(): void;
}

export interface AttemptEvents {
  joined(): void;
  ended(cause: Cause): void;
}

// Starts one attempt to join a server. `auto` is true when no agent asked for this attempt.
export type Dial<Target> = (target: Target, auto: boolean, events: AttemptEvents) => Attempt;

export type ConnectOutcome = { state: "connected" } | { state: "disconnected"; cause: Cause };

export interface PresenceOptions<Target> {
  dial: Dial<Target>;
  // The bot was in and is out, an attempt to get in failed, or the tries to get back in were
  // given up. `retryInMs` is set when a new try follows.
  onDisconnected: (cause: Cause, retryInMs: number | null) => void;
  // The server the bot is meant to be in changed. It is `undefined` for none.
  onTarget: (target: Target | undefined) => void;
  baseDelayMs: number;
  maxDelayMs: number;
  // A connection that held this long starts again from the shortest delay.
  stableAfterMs: number;
}

interface Current {
  attempt: Attempt;
  auto: boolean;
  joinedAt: number | undefined;
  outcome: PromiseWithResolvers<ConnectOutcome>;
}

// Keeps the bot in a server once the agent has asked for that.
// It joins when asked, and joins again after a drop that passes by itself.
export class Presence<Target> {
  readonly #options: PresenceOptions<Target>;
  // The server the bot is meant to be in.
  #target: Target | undefined;
  #current: Current | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #failures = 0;

  constructor(options: PresenceOptions<Target>) {
    this.#options = options;
  }

  get target(): Target | undefined {
    return this.#target;
  }

  get state(): PresenceState {
    if (this.#current === undefined) {
      return this.#retry === undefined ? "disconnected" : "reconnecting";
    }
    if (this.#current.joinedAt !== undefined) {
      return "connected";
    }
    return this.#current.auto ? "reconnecting" : "connecting";
  }

  // Joins a server on the agent's word. Resolves once the bot is in, or the attempt has failed.
  // A failed first attempt is not repeated. While the bot is meant to be in a server already,
  // the call joins that one and ignores the target given.
  connect(target: Target): Promise<ConnectOutcome> {
    return this.#join(target, false);
  }

  // Joins on behalf of an agent that asked earlier, so a failed attempt is repeated.
  resume(target: Target): Promise<ConnectOutcome> {
    return this.#join(target, true);
  }

  // Leaves at once. What the attempt reports from here on is dropped.
  disconnect(): void {
    clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#aim(undefined);
    const current = this.#current;
    if (current !== undefined) {
      this.#current = undefined;
      current.attempt.hangUp();
      this.#ended(current, { kind: "requested" });
    }
  }

  #join(target: Target, auto: boolean): Promise<ConnectOutcome> {
    if (this.#current !== undefined) {
      return this.#current.outcome.promise;
    }
    clearTimeout(this.#retry);
    this.#retry = undefined;
    // A bot that is set on a server already is only hurried along. Its tries go on if this
    // one fails, since an agent that hears of a drop may well ask while the server is still away.
    const set = this.#target;
    if (set !== undefined) {
      return this.#dial(set, true);
    }
    this.#failures = 0;
    this.#aim(target);
    return this.#dial(target, auto);
  }

  #dial(target: Target, auto: boolean): Promise<ConnectOutcome> {
    const outcome = Promise.withResolvers<ConnectOutcome>();
    // Events of an attempt that is no longer the current one are dropped.
    const events: AttemptEvents = {
      joined: () => {
        if (this.#current === current) {
          current.joinedAt = Date.now();
          outcome.resolve({ state: "connected" });
        }
      },
      ended: (cause) => {
        if (this.#current === current) {
          this.#current = undefined;
          this.#ended(current, cause);
        }
      },
    };
    const current: Current = {
      attempt: this.#options.dial(target, auto, events),
      auto,
      joinedAt: undefined,
      outcome,
    };
    this.#current = current;
    return outcome.promise;
  }

  #ended(ended: Current, cause: Cause): void {
    ended.outcome.resolve({ state: "disconnected", cause });
    const wasIn = ended.joinedAt !== undefined;
    if (wasIn && Date.now() - (ended.joinedAt ?? 0) >= this.#options.stableAfterMs) {
      this.#failures = 0;
    }

    // An attempt of the agent's own that fails is the agent's to repeat.
    const target = this.#target;
    if (target === undefined || !(wasIn || ended.auto) || !reconnects(cause)) {
      this.#aim(undefined);
      // An agent that gave up an attempt of its own knows how it ended.
      if (wasIn || cause.kind !== "requested") {
        this.#options.onDisconnected(cause, null);
      }
      return;
    }
    const delayMs = reconnectDelay(
      this.#failures,
      this.#options.baseDelayMs,
      this.#options.maxDelayMs,
    );
    this.#failures += 1;
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      void this.#dial(target, true);
    }, delayMs);
    if (wasIn) {
      this.#options.onDisconnected(cause, delayMs);
    }
  }

  #aim(target: Target | undefined): void {
    if (this.#target !== target) {
      this.#target = target;
      this.#options.onTarget(target);
    }
  }
}
