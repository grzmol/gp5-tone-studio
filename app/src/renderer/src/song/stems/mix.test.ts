import { describe, expect, it } from "vitest";
import { defaultMix, formatTime, peaks, rms, stemGains } from "./mix";

describe("stem mixer", () => {
  it("plays every unmuted stem at its volume", () => {
    const mix = { ...defaultMix(), bass: { volume: 0.5, mute: false, solo: false }, vocals: { volume: 1, mute: true, solo: false } };
    const g = stemGains(mix);
    expect(g.bass).toBe(0.5);
    expect(g.vocals).toBe(0);
    expect(g.guitar).toBe(1);
  });

  it("plays only soloed stems, and mute wins over solo", () => {
    const mix = {
      ...defaultMix(),
      guitar: { volume: 0.8, mute: false, solo: true },
      piano: { volume: 1, mute: true, solo: true },
    };
    const g = stemGains(mix);
    expect(g).toEqual({ drums: 0, bass: 0, other: 0, vocals: 0, guitar: 0.8, piano: 0 });
  });

  it("takes the peak over channels per bucket", () => {
    const p = peaks([Float32Array.from([0.1, -0.5, 0.2, 0]), Float32Array.from([0, 0.3, -0.9, 0.05])], 2);
    expect(Array.from(p)).toEqual([0.5, 0.9].map(Math.fround));
    expect(Array.from(peaks([new Float32Array(0)], 3))).toEqual([0, 0, 0]);
  });

  it("measures RMS over all channels", () => {
    expect(rms([Float32Array.from([1, -1]), Float32Array.from([0, 0])])).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("formats times as m:ss", () => {
    expect(formatTime(83.4)).toBe("1:23");
    expect(formatTime(5)).toBe("0:05");
  });
});
