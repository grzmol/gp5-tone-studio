import { describe, expect, it } from "vitest";
import { chunkInput, chunkOffsets, mixStats, separate, SOURCES, transitionWeight, type RunSegment } from "./demucs";

const SEG = 400;
const GUITAR = 4;

/** A "model" that puts the whole (normalised) input in the guitar stem and silence elsewhere. */
const guitarOnly: RunSegment = async (mix) => {
  const out = new Float32Array(SOURCES * 2 * SEG);
  out.set(mix, GUITAR * 2 * SEG);
  return out;
};

function signal(length: number, phase: number, dc: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => dc + 0.5 * Math.sin(i * 0.05 + phase) + 0.2 * Math.sin(i * 0.31));
}

describe("demucs apply_model port", () => {
  it("builds the triangular transition weight peaking at 1", () => {
    expect(Array.from(transitionWeight(10))).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1].map((x) => Math.fround(x / 5)));
  });

  it("starts a chunk every 3/4 segment", () => {
    expect(chunkOffsets(1000, SEG)).toEqual([0, 300, 600, 900]);
    expect(chunkOffsets(343_980 * 2)).toEqual([0, 257_985, 515_970]);
  });

  it("normalises by the mean and unbiased std of the mono mix", () => {
    const { mean, std } = mixStats([Float32Array.from([1, 3]), Float32Array.from([3, 5])]);
    expect(mean).toBe(3);
    expect(std).toBeCloseTo(Math.SQRT2, 6);
  });

  it("centres a short last chunk on real audio before it, zeros after the end", () => {
    const ch = Float32Array.from({ length: 500 }, (_, i) => i + 1);
    const { input, lead, length } = chunkInput([ch, ch], { mean: 0, std: 1 }, 300, SEG);
    expect(length).toBe(200);
    expect(lead).toBe(100);
    expect(input[0]).toBe(201); // sample 200: 100 samples of context before the chunk
    expect(input[lead]).toBe(301);
    expect(input[lead + length - 1]).toBe(500);
    expect(input[lead + length]).toBe(0);
  });

  it.each([1000, 913, 250])("overlap-adds chunks back sample-exact (length %i)", async (length) => {
    const channels = [signal(length, 0, 0.1), signal(length, 1, 0.1)];
    const stems = await separate(channels, guitarOnly, {}, SEG);
    const { mean } = mixStats(channels);
    expect(stems).toHaveLength(SOURCES);
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < length; i++) expect(stems[GUITAR][c][i]).toBeCloseTo(channels[c][i], 5);
      // Demucs adds the mean back to every source.
      for (const s of [0, 1, 2, 3, 5]) expect(stems[s][c][length >> 1]).toBeCloseTo(mean, 6);
    }
  });

  it("reports progress per chunk and stops when cancelled", async () => {
    const channels = [signal(1000, 0, 0), signal(1000, 1, 0)];
    const seen: number[] = [];
    await separate(channels, guitarOnly, { onProgress: (f) => seen.push(f) }, SEG);
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    let calls = 0;
    const counting: RunSegment = (mix) => {
      calls++;
      return guitarOnly(mix);
    };
    await expect(separate(channels, counting, { cancelled: () => calls >= 2 }, SEG)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(2);
  });

  it("rejects a model output of the wrong size", async () => {
    const bad: RunSegment = async () => new Float32Array(10);
    await expect(separate([signal(100, 0, 0), signal(100, 1, 0)], bad, {}, SEG)).rejects.toThrow(/expected 4800/);
  });
});
