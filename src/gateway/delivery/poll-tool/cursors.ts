type Positions = Readonly<Record<string, number>>;

// Holds the positions behind each cursor, so the cursor an agent copies around stays short.
export class Cursors {
  readonly #capacity: number;
  readonly #issued = new Map<string, Positions>();

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  // Reuses `previous` when it already stands for the same positions.
  issue(positions: Positions, previous?: string): string {
    const before = previous === undefined ? undefined : this.#issued.get(previous);
    if (previous !== undefined && before !== undefined && same(before, positions)) {
      return previous;
    }
    const cursor = crypto.randomUUID().slice(0, 8);
    this.#issued.set(cursor, positions);
    if (this.#issued.size > this.#capacity) {
      for (const oldest of this.#issued.keys()) {
        this.#issued.delete(oldest);
        break;
      }
    }
    return cursor;
  }

  find(cursor: string): Positions | undefined {
    return this.#issued.get(cursor);
  }
}

function same(a: Positions, b: Positions): boolean {
  const kinds = Object.keys(a);
  return kinds.length === Object.keys(b).length && kinds.every((kind) => a[kind] === b[kind]);
}
