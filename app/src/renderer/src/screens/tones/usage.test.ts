/// <reference types="node" />
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUsage, slotOfFxid } from "./usage";

const DIR = join(__dirname, "../../gp5/fixtures/backup");
const presets = readdirSync(DIR)
  .sort()
  .map((f: string) => {
    const m = /^(\d+)-(.*)\.prst$/.exec(f)!;
    return { slot: Number(m[1]), name: m[2], prst: new Uint8Array(readFileSync(join(DIR, f))) };
  });

describe("slotOfFxid", () => {
  it("maps SnapTone and User IR fxids to 0-based pedal slots", () => {
    expect(slotOfFxid(0x0f000033)).toEqual({ kind: "snaptone", slot: 51 });
    expect(slotOfFxid(0x0a100002)).toEqual({ kind: "ir", slot: 2 });
    expect(slotOfFxid(0x0a000001)).toBeNull();
    expect(slotOfFxid(0x0f000050)).toBeNull();
  });
});

describe("buildUsage on the bundled backup", () => {
  const index = buildUsage(presets);
  it("finds the presets that play each user SnapTone (design/screens/tones.md data)", () => {
    expect(index.snaptone.get(51)).toEqual([{ slot: 53, name: "ALEXI-1" }]);
    expect(index.snaptone.get(52)).toEqual([{ slot: 54, name: "Grzmol" }]);
    expect(index.snaptone.get(53)).toEqual([{ slot: 51, name: "ALEXI-CUST" }]);
    expect(index.snaptone.get(54)).toEqual([{ slot: 50, name: "COWBOYS" }]);
    expect(index.snaptone.get(56)).toEqual([{ slot: 52, name: "TEENDKILL" }]);
    expect(index.snaptone.get(50)).toBeUndefined();
    expect(index.snaptone.get(26)?.map((p) => p.slot)).toEqual([55, 56, 57, 58, 59, 60, 61]);
  });
  it("counts a User IR selected in CAB even while an engaged SnapTone bypasses CAB", () => {
    expect(index.ir.get(2)).toEqual([{ slot: 50, name: "COWBOYS" }]);
  });
  it("skips presets without a slot", () => {
    expect(buildUsage([{ slot: null, name: "x", prst: presets[53].prst }]).snaptone.size).toBe(0);
  });
});
