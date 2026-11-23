import { describe, expect, test } from "bun:test";

import type { Pile } from "./arrange.ts";

import { arrange, misfit, press } from "./arrange.ts";

const wool = (count: number): Pile => ({ kind: "wool", count, size: 64 });
const stone = (count: number): Pile => ({ kind: "stone", count, size: 64 });
const sword = (): Pile => ({ kind: "sword", count: 1, size: 1 });

// What is left of a total after some counts are taken from it.
const rest = (counts: Array<number>, total: number) =>
  total - counts.reduce((sum, count) => sum + count, 0);

// The slots after the clicks, with what is left on the cursor.
function after(now: Array<Pile | null>, want: Array<Pile | null>) {
  const slots = now.map((pile) => (pile === null ? null : { ...pile }));
  const clicks = arrange(now, want);
  let cursor: Pile | null = null;
  for (const click of clicks) {
    cursor = press(slots, cursor, click);
  }
  return { slots, cursor, clicks: clicks.length };
}

describe("press", () => {
  test("picks up the whole stack with an empty hand", () => {
    const slots: Array<Pile | null> = [wool(10)];

    expect(press(slots, null, { slot: 0, button: "left" })).toEqual(wool(10));
    expect(slots).toEqual([null]);
  });

  test("puts a stack into an empty slot whole with a left click, and one item with a right", () => {
    const left: Array<Pile | null> = [null];
    const right: Array<Pile | null> = [null];

    expect(press(left, wool(10), { slot: 0, button: "left" })).toBeNull();
    expect(left).toEqual([wool(10)]);
    expect(press(right, wool(10), { slot: 0, button: "right" })).toEqual(wool(9));
    expect(right).toEqual([wool(1)]);
  });

  test("fills a stack of the same kind and keeps what does not fit", () => {
    const slots = [wool(60)];

    expect(press(slots, wool(10), { slot: 0, button: "left" })).toEqual(wool(6));
    expect(slots).toEqual([wool(64)]);
  });

  test("changes places with a stack of another kind", () => {
    const slots = [stone(5)];

    expect(press(slots, wool(10), { slot: 0, button: "left" })).toEqual(stone(5));
    expect(slots).toEqual([wool(10)]);
  });
});

const called = (kind: string) => kind;

describe("misfit", () => {
  test("is nothing for a layout that holds the same as the slots", () => {
    expect(misfit([wool(10), stone(5)], [stone(5), wool(10)], called)).toBeUndefined();
    expect(misfit([wool(30), wool(30)], [wool(60), null], called)).toBeUndefined();
  });

  test("names a kind of which the layout holds more or less", () => {
    expect(misfit([wool(10), stone(5)], [wool(12), stone(5)], called)).toBe(
      "The layout must hold what the container holds, no more and no less. It has 12 wool where the container holds 10.",
    );
    expect(misfit([wool(10)], [null], called)).toContain("0 wool where the container holds 10");
  });

  test("names a slot that the layout overfills", () => {
    expect(misfit([sword(), sword()], [{ ...sword(), count: 2 }, null], called)).toBe(
      "One slot holds at most 1 sword, and the layout puts 2 into one.",
    );
  });
});

describe("arrange", () => {
  test("clicks nothing when the slots are in the layout already", () => {
    expect(arrange([wool(10), null, stone(5)], [wool(10), null, stone(5)])).toEqual([]);
  });

  test("moves a stack to an empty slot", () => {
    const { slots, cursor, clicks } = after([wool(10), null], [null, wool(10)]);

    expect(slots).toEqual([null, wool(10)]);
    expect(cursor).toBeNull();
    expect(clicks).toBe(2);
  });

  test("swaps two stacks without a free slot", () => {
    const { slots, cursor } = after([wool(10), stone(5)], [stone(5), wool(10)]);

    expect(slots).toEqual([stone(5), wool(10)]);
    expect(cursor).toBeNull();
  });

  test("turns three stacks round without a free slot", () => {
    const now = [wool(10), stone(5), sword()];
    const want = [sword(), wool(10), stone(5)];

    expect(after(now, want).slots).toEqual(want);
  });

  test("joins two stacks of a kind into one", () => {
    const { slots, cursor } = after([wool(30), stone(5), wool(20)], [wool(50), stone(5), null]);

    expect(slots).toEqual([wool(50), stone(5), null]);
    expect(cursor).toBeNull();
  });

  test("splits a stack over two slots", () => {
    expect(after([wool(40), null], [wool(25), wool(15)]).slots).toEqual([wool(25), wool(15)]);
  });

  test("moves part of a stack onto a slot that holds another kind", () => {
    const now = [wool(40), stone(5), null];
    const want = [wool(10), wool(30), stone(5)];

    expect(after(now, want).slots).toEqual(want);
  });

  test("sorts a full row that is mixed up", () => {
    const now = [
      stone(64),
      wool(64),
      stone(10),
      wool(3),
      sword(),
      stone(1),
      wool(64),
      sword(),
      wool(1),
    ];
    const want = [wool(64), wool(64), wool(4), stone(64), stone(11), sword(), sword(), null, null];
    const result = after(now, want);

    expect(result.slots).toEqual(want);
    expect(result.cursor).toBeNull();
  });

  test("reaches any layout of the same items", () => {
    // Shuffles and regroups a fixed set of stacks in many ways, with a fixed seed.
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    // 150 wool in three or four stacks, 90 stone in two or three, and two swords, each in a
    // slot picked at random.
    const spread = () => {
      const free = Array.from({ length: 12 }, (_, slot) => slot);
      const piles: Array<Pile | null> = free.map(() => null);
      const put = (pile: Pile) => {
        const [slot] = free.splice(random(free.length), 1);
        if (slot !== undefined) {
          piles[slot] = pile;
        }
      };
      const some = (from: number, to: number) => from + random(to - from + 1);
      const wools =
        random(2) === 0 ? [some(43, 53), some(43, 53)] : [some(29, 43), some(29, 43), some(29, 43)];
      const stones = random(2) === 0 ? [some(26, 64)] : [some(13, 40), some(13, 40)];
      for (const count of [...wools, rest(wools, 150)]) {
        put(wool(count));
      }
      for (const count of [...stones, rest(stones, 90)]) {
        put(stone(count));
      }
      put(sword());
      put(sword());
      return piles;
    };
    for (let round = 0; round < 200; round += 1) {
      const now = spread();
      const want = spread();
      const result = after(now, want);

      expect(result.slots).toEqual(want);
      expect(result.cursor).toBeNull();
    }
  });
});
