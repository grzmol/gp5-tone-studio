import { describe, expect, it } from "vitest";
import { groupOf, groupsOf, moveBlock, moveToGroup, nudge } from "./order";
import { MERGE_MS, invert, pushEdit, type Edit } from "./history";

// 0 NR, 1 PRE, 2 DST, 3 AMP, 4 CAB, 5 EQ, 6 MOD, 7 DLY, 8 RVB, 9 NS
const DEFAULT = [0, 1, 2, 9, 3, 4, 5, 6, 7, 8];

describe("groupsOf", () => {
  it("splits around AMP and CAB", () => {
    expect(groupsOf(DEFAULT)).toEqual({ before: [0, 1, 2, 9], amp: [3, 4], after: [5, 6, 7, 8] });
  });
  it("puts movable blocks with the side they sit on", () => {
    const order = [7, 0, 2, 9, 3, 4, 5, 1, 6, 8];
    expect(groupsOf(order)).toEqual({ before: [7, 0, 2, 9], amp: [3, 4], after: [5, 1, 6, 8] });
    expect(groupOf(order, 7)).toBe("before");
    expect(groupOf(order, 1)).toBe("after");
    expect(groupOf(order, 4)).toBe("amp");
  });
});

describe("moveBlock", () => {
  it("moves a movable block next to another", () => {
    expect(moveBlock(DEFAULT, 0, 1, "after")).toEqual([1, 0, 2, 9, 3, 4, 5, 6, 7, 8]);
    expect(moveBlock(DEFAULT, 8, 6, "before")).toEqual([0, 1, 2, 9, 3, 4, 5, 8, 6, 7]);
    expect(moveBlock(DEFAULT, 7, 0, "before")).toEqual([7, 0, 1, 2, 9, 3, 4, 5, 6, 8]);
  });
  it("never splits the core", () => {
    expect(moveBlock(DEFAULT, 0, 2, "after")).toBeNull(); // between DST and NS
    expect(moveBlock(DEFAULT, 6, 3, "before")).toBeNull(); // between NS and AMP
    expect(moveBlock(DEFAULT, 6, 4, "after")).toBeNull(); // between CAB and EQ
  });
  it("allows the core edges", () => {
    expect(moveBlock(DEFAULT, 6, 2, "before")).toEqual([0, 1, 6, 2, 9, 3, 4, 5, 7, 8]);
    expect(moveBlock(DEFAULT, 0, 5, "after")).toEqual([1, 2, 9, 3, 4, 5, 0, 6, 7, 8]);
  });
  it("refuses fixed blocks, self drops and no-op moves", () => {
    expect(moveBlock(DEFAULT, 2, 0, "before")).toBeNull();
    expect(moveBlock(DEFAULT, 9, 0, "before")).toBeNull();
    expect(moveBlock(DEFAULT, 0, 0, "after")).toBeNull();
    expect(moveBlock(DEFAULT, 0, 1, "before")).toBeNull();
  });
  it("refuses to work on an invalid order", () => {
    expect(moveBlock([0, 1, 2, 3, 9, 4, 5, 6, 7, 8], 0, 1, "after")).toBeNull();
  });
});

describe("moveToGroup", () => {
  it("drops just ahead of the core or at the chain end", () => {
    expect(moveToGroup(DEFAULT, 7, "before")).toEqual([0, 1, 7, 2, 9, 3, 4, 5, 6, 8]);
    expect(moveToGroup(DEFAULT, 0, "after")).toEqual([1, 2, 9, 3, 4, 5, 6, 7, 8, 0]);
  });
  it("never drops into the amp group or moves fixed blocks", () => {
    expect(moveToGroup(DEFAULT, 0, "amp")).toBeNull();
    expect(moveToGroup(DEFAULT, 5, "before")).toBeNull();
  });
  it("returns null when the block is already there", () => {
    expect(moveToGroup(DEFAULT, 8, "after")).toBeNull();
  });
});

describe("nudge", () => {
  it("steps one position", () => {
    expect(nudge(DEFAULT, 0, 1)).toEqual([1, 0, 2, 9, 3, 4, 5, 6, 7, 8]);
    expect(nudge(DEFAULT, 7, -1)).toEqual([0, 1, 2, 9, 3, 4, 5, 7, 6, 8]);
  });
  it("jumps over the core as a unit", () => {
    expect(nudge([0, 1, 2, 9, 3, 4, 5, 6, 7, 8], 1, 1)).toEqual([0, 2, 9, 3, 4, 5, 1, 6, 7, 8]);
    expect(nudge(DEFAULT, 6, -1)).toEqual([0, 1, 6, 2, 9, 3, 4, 5, 7, 8]);
  });
  it("stops at the ends and refuses fixed blocks", () => {
    expect(nudge(DEFAULT, 0, -1)).toBeNull();
    expect(nudge(DEFAULT, 8, 1)).toBeNull();
    expect(nudge(DEFAULT, 3, 1)).toBeNull();
  });
});

describe("undo history", () => {
  const param = (to: number, at: number, index = 0, from = 0): Edit => ({ kind: "param", block: 2, index, from, to, at });

  it("merges a gesture on the same param into one step", () => {
    let past = pushEdit([], param(10, 0, 0, 5));
    past = pushEdit(past, param(20, 300));
    past = pushEdit(past, param(30, 600));
    expect(past).toEqual([{ kind: "param", block: 2, index: 0, from: 5, to: 30, at: 600 }]);
  });
  it("starts a new step after a pause or on another param", () => {
    let past = pushEdit([], param(10, 0));
    past = pushEdit(past, param(20, MERGE_MS + 1));
    past = pushEdit(past, param(30, MERGE_MS + 2, 1));
    expect(past).toHaveLength(3);
  });
  it("inverts by swapping from and to", () => {
    expect(invert({ kind: "enabled", block: 1, from: true, to: false })).toEqual({ kind: "enabled", block: 1, from: false, to: true });
    expect(invert({ kind: "order", from: [1], to: [2] })).toEqual({ kind: "order", from: [2], to: [1] });
  });
});
