export type BodyHolder = { kind: "action"; id: string } | { kind: "reflex"; name: string };

export interface BodyLease {
  // Aborts when another holder takes the body.
  signal: AbortSignal;
  // The holder that took the body away, once that has happened.
  readonly takenBy: BodyHolder | undefined;
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
  takenBy: BodyHolder | undefined;
  released: Promise<void>;
}

function describe(holder: BodyHolder): string {
  return holder.kind === "action" ? `the action ${holder.id}` : `the reflex "${holder.name}"`;
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
      if (lease.takenBy !== undefined) {
        return { granted: false, heldBy: lease.takenBy };
      }
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
    if (lease.takenBy !== undefined) {
      return { granted: false, reason: "busy", heldBy: lease.takenBy };
    }
    return { granted: true, lease, interrupted: current.holder };
  }

  #take(holder: BodyHolder, suppressedReflexes: ReadonlyArray<string>): BodyLease {
    const controller = new AbortController();
    const { promise, resolve } = Promise.withResolvers<void>();
    const held: Held = {
      holder,
      suppressedReflexes,
      controller,
      takenBy: undefined,
      released: promise,
    };
    this.#current = held;
    return {
      signal: controller.signal,
      get takenBy() {
        return held.takenBy;
      },
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
  // If the new holder lost the body in the meantime, the lease comes back released and taken.
  async #takeOver(
    previous: Held,
    holder: BodyHolder,
    suppressedReflexes: ReadonlyArray<string>,
  ): Promise<BodyLease> {
    const lease = this.#take(holder, suppressedReflexes);
    previous.takenBy = holder;
    previous.controller.abort(new Error(`The body was taken by ${describe(holder)}.`));
    await previous.released;
    if (lease.takenBy !== undefined) {
      lease.release();
    }
    return lease;
  }
}
