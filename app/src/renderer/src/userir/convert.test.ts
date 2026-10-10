import { describe, expect, it } from "vitest";
import { prepareUserIr } from "./convert";

/** RIFF/WAVE file around raw interleaved sample bytes. */
function wavFile(opts: { format?: number; channels?: number; rate: number; bits: number; data: Uint8Array; extraChunk?: boolean }): Uint8Array {
  const { format = 1, channels = 1, rate, bits, data, extraChunk = false } = opts;
  const junk = extraChunk ? 8 + 3 + 1 : 0; // odd-sized chunk plus its pad byte
  const out = new Uint8Array(12 + junk + 24 + 8 + data.length);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, out.length - 8, true);
  ascii(8, "WAVE");
  let o = 12;
  if (extraChunk) {
    ascii(o, "LIST");
    v.setUint32(o + 4, 3, true);
    o += junk;
  }
  ascii(o, "fmt ");
  v.setUint32(o + 4, 16, true);
  v.setUint16(o + 8, format, true);
  v.setUint16(o + 10, channels, true);
  v.setUint32(o + 12, rate, true);
  v.setUint32(o + 16, (rate * channels * bits) / 8, true);
  v.setUint16(o + 20, (channels * bits) / 8, true);
  v.setUint16(o + 22, bits, true);
  ascii(o + 24, "data");
  v.setUint32(o + 28, data.length, true);
  out.set(data, o + 32);
  return out;
}

function pcm24(samples: number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 3);
  samples.forEach((s, i) => out.set([s & 0xff, (s >> 8) & 0xff, (s >> 16) & 0xff], i * 3));
  return out;
}

const int32At = (d: Uint8Array, i: number) => new DataView(d.buffer, d.byteOffset).getInt32(i * 4, true);
const samplesOf = (d: Uint8Array) => Array.from({ length: 512 }, (_, i) => int32At(d, i));

describe("prepareUserIr", () => {
  it("passes a 24-bit 44.1 kHz mono Dirac through unchanged", () => {
    const ir = prepareUserIr(wavFile({ rate: 44100, bits: 24, data: pcm24([0x7fffff, -2, 0, 0]), extraChunk: true }));
    expect(ir.data.length).toBe(2048);
    expect(Array.from(ir.data.subarray(0, 8))).toEqual([0xff, 0xff, 0x7f, 0x00, 0xfe, 0xff, 0xff, 0xff]);
    expect(ir.data.subarray(8).every((b) => b === 0)).toBe(true);
    expect(ir).toMatchObject({ sourceRate: 44100, sourceFrames: 4, truncated: false });
  });

  it("uses channel 0 of a 16-bit 48 kHz stereo file and resamples it to 44.1 kHz", () => {
    const frames = 1024;
    const bytes = new Uint8Array(frames * 4);
    const v = new DataView(bytes.buffer);
    v.setInt16(0, 32767, true); // left: impulse
    for (let i = 0; i < frames; i++) v.setInt16(i * 4 + 2, i % 2 ? 20000 : -20000, true); // right: loud noise that must not leak in
    const ir = prepareUserIr(wavFile({ channels: 2, rate: 48000, bits: 16, data: bytes }));
    expect(ir).toMatchObject({ sourceRate: 48000, sourceFrames: 1024, truncated: true }); // 1024 * 44.1/48 = 940 > 512
    const s = samplesOf(ir.data);
    const peakAt = s.reduce((best, x, i) => (Math.abs(x) > Math.abs(s[best]) ? i : best), 0);
    expect(peakAt).toBeLessThan(4);
    // A band-limited impulse keeps most of its energy near the peak and stays below full scale.
    expect(s[peakAt]).toBeGreaterThan(0.5 * 0x800000);
    expect(s[peakAt]).toBeLessThanOrEqual(0x7fffff);
    // The right channel's noise must not leak in: the same left channel alone gives the same block.
    const mono = new Uint8Array(frames * 2);
    new DataView(mono.buffer).setInt16(0, 32767, true);
    expect(prepareUserIr(wavFile({ rate: 48000, bits: 16, data: mono })).data).toEqual(ir.data);
  });

  it("reads 32-bit float input at 44.1 kHz with JUCE's 24-bit rounding", () => {
    const f = Float32Array.from([0.5, -0.25, 2, -2]);
    const ir = prepareUserIr(wavFile({ format: 3, rate: 44100, bits: 32, data: new Uint8Array(f.buffer) }));
    expect(samplesOf(ir.data).slice(0, 5)).toEqual([0x400000, -0x200000, 0x7fffff, -0x800000, 0]);
  });

  it("keeps the first 512 samples of a longer IR and flags it as truncated", () => {
    const long = Array.from({ length: 600 }, (_, i) => i + 1);
    const ir = prepareUserIr(wavFile({ rate: 44100, bits: 24, data: pcm24(long) }));
    expect(ir.truncated).toBe(true);
    expect(int32At(ir.data, 511)).toBe(512);
  });

  it("refuses files it cannot use, with a readable message", () => {
    expect(() => prepareUserIr(new TextEncoder().encode("not a wave file at all"))).toThrow(/not a WAV file/);
    const noData = wavFile({ rate: 44100, bits: 24, data: new Uint8Array(0) });
    noData.set([0x6a, 0x75, 0x6e, 0x6b], noData.length - 8); // rename "data" to "junk"
    expect(() => prepareUserIr(noData)).toThrow(/no audio data/);
    expect(() => prepareUserIr(wavFile({ rate: 44100, bits: 24, data: new Uint8Array(0) }))).toThrow(/contains no audio/);
    expect(() => prepareUserIr(wavFile({ format: 3, rate: 44100, bits: 64, data: new Uint8Array(8) }))).toThrow(/isn't supported/);
  });
});
