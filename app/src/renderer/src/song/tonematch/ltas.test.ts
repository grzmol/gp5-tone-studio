import { describe, expect, it } from "vitest";
import { BAND_CENTERS, bandEdges, interpolateDb, ltas, toMono } from "./ltas";
import { biquad, biquadPower, lowPass, whiteNoise, type Biquad } from "./test-signals";

const SR = 44100;

/** Expected band level: mean |H|² over the band, dB. */
function expectedBandDb(coeffs: Biquad, fc: number): number {
  const [lo, hi] = bandEdges(fc);
  let acc = 0;
  const steps = 200;
  for (let i = 0; i < steps; i++) acc += biquadPower(coeffs, lo + ((hi - lo) * (i + 0.5)) / steps, SR);
  return 10 * Math.log10(acc / steps);
}

describe("ltas", () => {
  it("measures the shape of low-pass filtered white noise within 1 dB (100 Hz–10 kHz)", () => {
    const coeffs = lowPass(2000, Math.SQRT1_2, SR);
    const x = biquad(whiteNoise(SR * 12, 7), coeffs);
    const result = ltas(x, SR);
    const ref = BAND_CENTERS.findIndex((fc) => Math.abs(fc - 1000) < 1);
    BAND_CENTERS.forEach((fc, i) => {
      if (fc < 100 || fc > 10000) return;
      const measured = result.db[i] - result.db[ref];
      const expected = expectedBandDb(coeffs, fc) - expectedBandDb(coeffs, 1000);
      expect(Math.abs(measured - expected), `${fc.toFixed(0)} Hz`).toBeLessThan(1);
    });
  });

  it("ignores silence: the gated average doesn't change when quiet parts are added", () => {
    const noise = whiteNoise(SR * 6, 3);
    const padded = new Float32Array(noise.length * 2);
    padded.set(noise, SR * 3); // silence before and after
    const a = ltas(noise, SR);
    const b = ltas(padded, SR);
    expect(b.activeFrames).toBeLessThan(b.totalFrames);
    BAND_CENTERS.forEach((fc, i) => {
      if (fc < 50 || fc > 15000) return;
      expect(Math.abs(a.db[i] - b.db[i])).toBeLessThan(0.5);
    });
  });

  it("returns NaN bands for a silent signal", () => {
    const result = ltas(new Float32Array(SR * 2), SR);
    expect(result.activeFrames).toBe(0);
    expect(result.db.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("averages channels to mono and interpolates on a log axis", () => {
    const mono = toMono({ sampleRate: SR, channels: [Float32Array.of(1, 0), Float32Array.of(0, 1)] });
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
    expect(interpolateDb([100, 400], [0, 12], 200)).toBeCloseTo(6, 6);
    expect(interpolateDb([100, 400], [0, 12], 50)).toBe(0);
    expect(interpolateDb([100, 400], [0, 12], 1000)).toBe(12);
  });
});
