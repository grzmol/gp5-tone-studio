import { describe, expect, it } from "vitest";
import { matchItem, mergeRanges, rank, splitByRanges, type Searchable } from "./search";

const models: Searchable[] = [
  { primary: "Rector Dual V", secondary: ["AMP", "Hi Gain", "Mesa/Boogie Dual Rectifier (CH3, vintage)"] },
  { primary: "Rector Dual M", secondary: ["AMP", "Hi Gain", "Mesa/Boogie Dual Rectifier (CH3, modern)"] },
  { primary: "Pure Echo", secondary: ["DLY", "Delay"] },
  { primary: "Correct Comp", secondary: ["PRE", "Compressor"] },
];
const presets: Searchable[] = [
  { primary: "Shatte-GT1", slot: 63 },
  { primary: "GP-5", slot: 64 },
  { primary: "Dual Rec V", slot: 42 },
];

describe("palette search", () => {
  it("ranks name prefixes above inner matches and highlights them", () => {
    const hits = rank("rect", models, (m) => m);
    expect(hits.map((h) => h.item.primary)).toEqual(["Rector Dual V", "Rector Dual M", "Correct Comp"]);
    expect(hits[0].match.ranges).toEqual([[0, 4]]);
    expect(splitByRanges("Rector Dual V", hits[0].match.ranges)).toEqual([
      { text: "Rect", hit: true },
      { text: "or Dual V", hit: false },
    ]);
  });

  it("matches the gear a model is based on and block codes without highlighting the name", () => {
    expect(rank("mesa", models, (m) => m).map((h) => h.item.primary)).toEqual(["Rector Dual V", "Rector Dual M"]);
    const dly = rank("dly", models, (m) => m);
    expect(dly[0].item.primary).toBe("Pure Echo");
    expect(dly[0].match.ranges).toEqual([]);
  });

  it("matches slot numbers exactly, with or without a leading zero", () => {
    expect(rank("64", presets, (p) => p).map((h) => h.item.primary)).toEqual(["GP-5"]);
    expect(matchItem("06", { primary: "Clean", slot: 6 })?.score).toBeGreaterThan(900);
  });

  it("requires every word to match", () => {
    expect(rank("dual modern", models, (m) => m).map((h) => h.item.primary)).toEqual(["Rector Dual M"]);
    expect(rank("dual xyz", models, (m) => m)).toEqual([]);
  });

  it("prefers word starts over inner substrings", () => {
    const word = matchItem("dual", { primary: "Rector Dual V" })!;
    const inner = matchItem("ual", { primary: "Rector Dual V" })!;
    expect(word.score).toBeGreaterThan(inner.score);
    expect(word.ranges).toEqual([[7, 11]]);
  });

  it("falls back to an in-order subsequence of the name", () => {
    const m = matchItem("shgt", presets[0]);
    expect(m).not.toBeNull();
    expect(m!.ranges).toEqual([[0, 2], [7, 9]]);
    expect(m!.score).toBeLessThan(matchItem("shat", presets[0])!.score);
  });

  it("doesn't match scattered letters inside words", () => {
    expect(matchItem("rect", { primary: "Reconnect" })).toBeNull();
  });

  it("keeps everything for an empty query in the given order", () => {
    expect(rank("  ", presets, (p) => p).map((h) => h.item.primary)).toEqual(["Shatte-GT1", "GP-5", "Dual Rec V"]);
  });

  it("merges overlapping ranges", () => {
    expect(mergeRanges([[4, 6], [0, 2], [1, 3]])).toEqual([[0, 3], [4, 6]]);
  });
});
