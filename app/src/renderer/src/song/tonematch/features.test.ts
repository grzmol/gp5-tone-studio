import { describe, expect, it } from "vitest";
import { estimateDelay, repeatPower } from "./delay";
import { estimateGain } from "./gain";
import { estimateReverb } from "./reverb";
import { addEcho, hardClip, mutedNotesWithReverb, plucks } from "./test-signals";

const SR = 44100;

describe("estimateGain", () => {
  it("separates clean picked notes from the same notes hard-clipped", () => {
    const clean = plucks({ seconds: 12, sampleRate: SR, seed: 11, gap: 0.5, decay: 0.4 });
    const clipped = hardClip(clean, 40, 0.5);
    const a = estimateGain(clean, SR);
    const b = estimateGain(clipped, SR);
    expect(a.gainClass).toBe("clean");
    expect(b.gainClass).toBe("high");
    expect(b.score - a.score).toBeGreaterThan(0.4);
    expect(b.crestDb).toBeLessThan(a.crestDb);
    expect(b.hfRatioDb).toBeGreaterThan(a.hfRatioDb);
  });
});

describe("estimateDelay", () => {
  const dry = plucks({ seconds: 40, sampleRate: SR, seed: 5, gap: 0.6, decay: 0.06 });

  it("recovers a known echo time and feedback", () => {
    const wet = addEcho(dry, SR, 0.375, 0.45, 0.5);
    const d = estimateDelay(wet, SR);
    expect(d.detected).toBe(true);
    expect(Math.abs(d.timeMs - 375)).toBeLessThan(6);
    expect(Math.abs(d.feedback - 0.45)).toBeLessThan(0.12);
    expect(Math.abs(d.level - 0.5)).toBeLessThan(0.2);
  });

  it("recovers a slapback with no feedback", () => {
    const wet = addEcho(dry, SR, 0.11, 0, 0.6);
    const d = estimateDelay(wet, SR);
    expect(d.detected).toBe(true);
    expect(Math.abs(d.timeMs - 110)).toBeLessThan(6);
    expect(d.feedback).toBeLessThan(0.15);
  });

  it("finds no echo in dry playing", () => {
    expect(estimateDelay(dry, SR).detected).toBe(false);
  });

  it("solves the repeat power from ρ(T) and the per-repeat power ratio", () => {
    // Forward model: ρ(T) = (q + q²·p·a) / (1 + q²·a), a = 1 / (1 − p²)
    const [q, p] = [0.25, 0.16];
    const a = 1 / (1 - p * p);
    const rho = (q + q * q * p * a) / (1 + q * q * a);
    expect(repeatPower(rho, p)).toBeCloseTo(q, 6);
  });
});

describe("estimateReverb", () => {
  const base = { seconds: 30, sampleRate: SR, seed: 9, gap: 1.6, hold: 0.5 };

  it("measures the decay and level of the tails after muted notes", () => {
    const r = estimateReverb(mutedNotesWithReverb({ ...base, rt60: 1.2, wetDb: -12 }), SR);
    expect(r.detected).toBe(true);
    expect(r.rt60).toBeGreaterThan(0.9);
    expect(r.rt60).toBeLessThan(1.5);
    expect(Math.abs(r.levelDb + 12)).toBeLessThan(4);
  });

  it("tells a short room from a long hall", () => {
    const room = estimateReverb(mutedNotesWithReverb({ ...base, rt60: 0.5, wetDb: -12 }), SR);
    const hall = estimateReverb(mutedNotesWithReverb({ ...base, rt60: 2.5, wetDb: -12 }), SR);
    expect(room.rt60).toBeLessThan(0.75);
    expect(hall.rt60).toBeGreaterThan(1.8);
  });

  it("finds no reverb when notes stop dead", () => {
    const r = estimateReverb(mutedNotesWithReverb({ ...base, rt60: 1, wetDb: -80 }), SR);
    expect(r.detected).toBe(false);
    expect(r.dryOffsets).toBeGreaterThan(5);
  });
});
