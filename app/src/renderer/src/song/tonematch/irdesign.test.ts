import { describe, expect, it } from "vitest";
import { BAND_CENTERS, ltas } from "./ltas";
import { correctionCurve, designMinPhaseIr, IR_RATE, IR_TAPS, matchIr, MAX_CORRECTION_DB, responseDb, targetDb, type CorrectionCurve } from "./irdesign";
import { biquad, lowPass, whiteNoise } from "./test-signals";

/** A cabinet-like correction: presence bump at 2 kHz, low-mid dip at 500 Hz, falling top. */
const CURVE: CorrectionCurve = {
  centers: BAND_CENTERS,
  db: Float64Array.from(BAND_CENTERS, (fc) => {
    if (fc < 80 || fc > 8000) return NaN;
    const oct = (f0: number) => Math.log2(fc / f0);
    return 6 * Math.exp(-(oct(2000) ** 2) / 0.5) - 4 * Math.exp(-(oct(500) ** 2) / 0.3) - (fc > 4000 ? 8 * oct(4000) : 0);
  }),
};

/** 1/12-octave points from `lo` to `hi`. */
const grid = (lo: number, hi: number) => Array.from({ length: Math.floor(12 * Math.log2(hi / lo)) + 1 }, (_, i) => lo * 2 ** (i / 12));

describe("designMinPhaseIr", () => {
  const ir = designMinPhaseIr((f) => targetDb(CURVE, f));

  it("is IR_TAPS long and peak-normalised to -1 dBFS", () => {
    expect(ir.length).toBe(IR_TAPS);
    const peak = ir.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(20 * Math.log10(peak)).toBeCloseTo(-1, 3);
  });

  it("matches the target magnitude within 1 dB from 100 Hz to 8 kHz", () => {
    const pts = grid(100, 8000);
    const diffs = pts.map((f) => responseDb(ir, f, IR_RATE) - targetDb(CURVE, f));
    const offset = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    pts.forEach((f, i) => expect(Math.abs(diffs[i] - offset), `${f.toFixed(0)} Hz`).toBeLessThan(1));
  });

  it("is minimum phase: the energy is front-loaded", () => {
    const energy = ir.reduce((a, v) => a + v * v, 0);
    const early = ir.subarray(0, IR_TAPS / 16).reduce((a, v) => a + v * v, 0);
    expect(early / energy).toBeGreaterThan(0.95);
    const peakAt = ir.reduce((best, v, i) => (Math.abs(v) > Math.abs(ir[best]) ? i : best), 0);
    expect(peakAt).toBeLessThan(16);
    // The time-reversed IR has the same magnitude but maximum phase: its energy comes last.
    const reversed = Float32Array.from(ir).reverse();
    const lateEarly = reversed.subarray(0, IR_TAPS / 16).reduce((a, v) => a + v * v, 0);
    expect(lateEarly / energy).toBeLessThan(0.05);
  });
});

describe("correctionCurve", () => {
  const SR = 44100;
  const noise = whiteNoise(SR * 8, 21);

  it("is the normalised difference of the two spectra, limited to the match range", () => {
    const stem = ltas(biquad(noise, lowPass(3000, Math.SQRT1_2, SR)), SR);
    const rec = ltas(noise, SR);
    const curve = correctionCurve(stem, rec);
    const at = (hz: number) => curve.db[BAND_CENTERS.findIndex((fc) => Math.abs(fc - hz) / hz < 0.05)];
    expect(Math.abs(at(250))).toBeLessThan(1.5); // flat region
    expect(at(6300)).toBeLessThan(-8); // the low-pass shows up as a cut
    expect(Number.isNaN(at(40))).toBe(true); // outside 80 Hz–8 kHz
    expect(Number.isNaN(at(12500))).toBe(true);
  });

  it("limits the correction to ±15 dB", () => {
    const stem = ltas(biquad(biquad(noise, lowPass(600, 2, SR)), lowPass(600, 2, SR)), SR);
    const curve = correctionCurve(stem, ltas(noise, SR));
    expect(curve.db.every((v) => Number.isNaN(v) || Math.abs(v) <= MAX_CORRECTION_DB)).toBe(true);
    expect(Math.min(...curve.db.filter(Number.isFinite))).toBe(-MAX_CORRECTION_DB);
  });

  it("matchIr turns a stem/recording pair into an IR that applies the difference", () => {
    const stem = ltas(biquad(noise, lowPass(2500, Math.SQRT1_2, SR)), SR);
    const { ir } = matchIr(stem, ltas(noise, SR));
    expect(responseDb(ir, 6000) - responseDb(ir, 500)).toBeLessThan(-9);
  });
});
