export type BodyHolder = { kind: "action"; id: string } | { kind: "reflex"; name: string };

export interface BodyLease {
  // Aborts when another holder takes the body. The reason is that holder.
  signal: AbortSignal;
  release(): void;
}

export type ActionGrant =
  | { granted: true; lease: BodyLease; interrupted?: BodyHolder }
  | { granted: false; heldBy: BodyHolder };

export type ReflexGrant =
  | { granted: true; lease: BodyLease; interrupted?: BodyHolder }
  | { granted: false; reason: "suppressed" | "busy"; heldBy: BodyHolder };

interface Held {
  holder: BodyHolder;
  suppressedReflexes: ReadonlyArray<string>;
  controller: AbortController;
  released: Promise<void>;
}

// The bot has one body. Actions and reflexes take it through here, one at a time.
export class Body {
  #current: Held | undefined;

  get holder(): BodyHolder | undefined {
    return this.#current?.holder;
  }

  async acquireForAction(
    id: string,
    suppressedReflexes: ReadonlyArray<string>,
  ): Promise<ActionGrant> {
    const current = this.#current;
    const holder: BodyHolder = { kind: "action", id };
    if (current === undefined) {
      return { granted: true, lease: this.#take(holder, suppressedReflexes) };
    }
    if (current.holder.kind === "reflex" && suppressedReflexes.includes(current.holder.name)) {
      const lease = await this.#takeOver(current, holder, suppressedReflexes);
      return { granted: true, lease, interrupted: current.holder };
    }
    return { granted: false, heldBy: current.holder };
  }

  async acquireForReflex(name: string): Promise<ReflexGrant> {
    const current = this.#current;
    const holder: BodyHolder = { kind: "reflex", name };
    if (current === undefined) {
      return { granted: true, lease: this.#take(holder, []) };
    }
    if (current.holder.kind === "reflex") {
      return { granted: false, reason: "busy", heldBy: current.holder };
    }
    if (current.suppressedReflexes.includes(name)) {
      return { granted: false, reason: "suppressed", heldBy: current.holder };
    }
    const lease = await this.#takeOver(current, holder, []);
    return { granted: true, lease, interrupted: current.holder };
  }

  #take(holder: BodyHolder, suppressedReflexes: ReadonlyArray<string>): BodyLease {
    const controller = new AbortController();
    const { promise, resolve } = Promise.withResolvers<void>();
    const held: Held = { holder, suppressedReflexes, controller, released: promise };
    this.#current = held;
    return {
      signal: controller.signal,
      release: () => {
        if (this.#current === held) {
          this.#current = undefined;
        }
        resolve();
      },
    };
  }

  // The new holder owns the body at once, so later requests are judged against it.
  // Its lease is handed out only after the previous holder has let go.
  async #takeOver(
    previous: Held,
    holder: BodyHolder,
    suppressedReflexes: ReadonlyArray<string>,
  ): Promise<BodyLease> {
    const lease = this.#take(holder, suppressedReflexes);
    previous.controller.abort(holder);
    await previous.released;
    return lease;
  }
}
