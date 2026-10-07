import { describe, expect, it } from "vitest";
import { clearSteps, copySteps, moveSteps, slotsToRead, swapSteps } from "./plans";

describe("moveSteps", () => {
  it("moves one slot down and shifts the ones in between up", () => {
    expect(moveSteps([57], 60)).toEqual([
      { slot: 57, from: 58 },
      { slot: 58, from: 59 },
      { slot: 59, from: 60 },
      { slot: 60, from: 57 },
    ]);
  });
  it("moves a block up and shifts the rest down", () => {
    expect(moveSteps([10, 11], 8)).toEqual([
      { slot: 8, from: 10 },
      { slot: 9, from: 11 },
      { slot: 10, from: 8 },
      { slot: 11, from: 9 },
    ]);
  });
  it("gathers scattered slots at the target and touches only changed slots", () => {
    expect(moveSteps([57, 59], 57)).toEqual([
      { slot: 58, from: 59 },
      { slot: 59, from: 58 },
    ]);
  });
  it("is empty when nothing moves and null past slot 99", () => {
    expect(moveSteps([5, 6], 5)).toEqual([]);
    expect(moveSteps([5, 6], 99)).toBeNull();
  });
  it("is a permutation: every source lands exactly once", () => {
    const steps = moveSteps([3, 20, 41], 30)!;
    expect(new Set(steps.map((s) => s.slot)).size).toBe(steps.length);
    expect(steps.map((s) => s.from).sort()).toEqual(steps.map((s) => s.slot).sort());
  });
});

describe("copy, swap, clear", () => {
  it("copies into consecutive slots and skips copying a slot onto itself", () => {
    expect(copySteps([57, 59], 64)).toEqual([
      { slot: 64, from: 57 },
      { slot: 65, from: 59 },
    ]);
    expect(copySteps([5], 5)).toEqual([]);
    expect(copySteps([1, 2], 99)).toBeNull();
  });
  it("swaps two slots", () => {
    expect(swapSteps(57, 59)).toEqual([
      { slot: 57, from: 59 },
      { slot: 59, from: 57 },
    ]);
  });
  it("clears with blank presets and reads only real sources", () => {
    const steps = [...clearSteps([3]), ...copySteps([9, 2], 20)!];
    expect(slotsToRead(steps)).toEqual([2, 9]);
  });
});
