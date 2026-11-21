import { describe, expect, test } from "bun:test";

import type { EventFilterDescriptor } from "../../protocol/descriptors.ts";

import { matches } from "./filter.ts";

const minAmount: EventFilterDescriptor = { param: "minAmount", field: "amount", op: "gte" };
const maxAmount: EventFilterDescriptor = { param: "maxAmount", field: "amount", op: "lte" };
const sender: EventFilterDescriptor = { param: "sender", field: "sender", op: "eq" };
const senders: EventFilterDescriptor = { param: "senders", field: "sender", op: "in" };

describe("matches", () => {
  test("passes every event when the kind has no filters", () => {
    expect(matches([], { anything: 1 }, { amount: 3 })).toBe(true);
  });

  test("skips a filter whose argument the subscription leaves out", () => {
    expect(matches([minAmount], {}, { amount: 1 })).toBe(true);
  });

  test("compares for equality", () => {
    expect(matches([sender], { sender: "alex" }, { sender: "alex" })).toBe(true);
    expect(matches([sender], { sender: "alex" }, { sender: "steve" })).toBe(false);
  });

  test("compares numbers against a lower bound", () => {
    expect(matches([minAmount], { minAmount: 4 }, { amount: 4 })).toBe(true);
    expect(matches([minAmount], { minAmount: 4 }, { amount: 3.5 })).toBe(false);
  });

  test("compares numbers against an upper bound", () => {
    expect(matches([maxAmount], { maxAmount: 4 }, { amount: 4 })).toBe(true);
    expect(matches([maxAmount], { maxAmount: 4 }, { amount: 4.5 })).toBe(false);
  });

  test("fails a bound when either side is not a number", () => {
    expect(matches([minAmount], { minAmount: 4 }, { amount: "5" })).toBe(false);
    expect(matches([minAmount], { minAmount: "4" }, { amount: 5 })).toBe(false);
    expect(matches([minAmount], { minAmount: 4 }, {})).toBe(false);
  });

  test("looks the value up in a list", () => {
    expect(matches([senders], { senders: ["alex", "steve"] }, { sender: "steve" })).toBe(true);
    expect(matches([senders], { senders: ["alex"] }, { sender: "steve" })).toBe(false);
    expect(matches([senders], { senders: "steve" }, { sender: "steve" })).toBe(false);
  });

  test("requires every filter with an argument to pass", () => {
    const filters = [minAmount, maxAmount];

    expect(matches(filters, { minAmount: 2, maxAmount: 6 }, { amount: 4 })).toBe(true);
    expect(matches(filters, { minAmount: 2, maxAmount: 6 }, { amount: 8 })).toBe(false);
  });
});
