import { describe, expect, test } from "bun:test";

import { callsForDecision, rule } from "./drowning.ts";

describe("rule", () => {
  test("surfaces once the air is low", async () => {
    expect(await rule.decide({ oxygen: 6 })).toBe("surface");
    expect(await rule.decide({ oxygen: 0 })).toBe("surface");
  });

  test("does nothing while plenty of air is left", async () => {
    expect(await rule.decide({ oxygen: 19 })).toBeUndefined();
    expect(await rule.decide({ oxygen: 7 })).toBeUndefined();
  });
});

describe("callsForDecision", () => {
  test("asks while the air runs down and the reflex has not acted", () => {
    expect(callsForDecision(19, undefined)).toBe(true);
    expect(callsForDecision(6, undefined)).toBe(true);
    expect(callsForDecision(0, undefined)).toBe(true);
  });

  test("stays quiet at full air", () => {
    expect(callsForDecision(20, undefined)).toBe(false);
  });

  test("stays quiet after the reflex has acted, while some air is left", () => {
    expect(callsForDecision(5, 6)).toBe(false);
    expect(callsForDecision(1, 6)).toBe(false);
  });

  test("asks once more when the air is gone", () => {
    expect(callsForDecision(0, 6)).toBe(true);
  });

  test("stays quiet after the reflex has acted on air that was gone", () => {
    expect(callsForDecision(0, 0)).toBe(false);
  });
});
