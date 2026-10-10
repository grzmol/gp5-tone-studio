import { describe, expect, it } from "vitest";
import { toStereo } from "./decode";
import { encodeWav } from "./wav";

const ascii = (b: Uint8Array, o: number) => String.fromCharCode(...b.subarray(o, o + 4));

describe("encodeWav", () => {
  it("writes a 16-bit stereo PCM header and interleaved, clipped samples", () => {
    const wav = encodeWav({ sampleRate: 44100, channels: [Float32Array.from([0, 1, 2]), Float32Array.from([-1, 0.5, -2])] }, 16);
    const v = new DataView(wav.buffer);
    expect(ascii(wav, 0)).toBe("RIFF");
    expect(ascii(wav, 8)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(12);
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    const samples = Array.from({ length: 6 }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, -32768, 32767, 16384, 32767, -32768]);
  });

  it("writes 24-bit little-endian mono", () => {
    const wav = encodeWav({ sampleRate: 48000, channels: [Float32Array.from([0.5, -0.5])] }, 24);
    expect(wav.length).toBe(44 + 6);
    const s24 = (o: number) => ((wav[o] | (wav[o + 1] << 8) | (wav[o + 2] << 16)) << 8) >> 8;
    expect(s24(44)).toBe(4194304);
    expect(s24(47)).toBe(-4194304);
  });
});

describe("toStereo", () => {
  it("doubles mono, keeps stereo and takes the front pair of multichannel audio", () => {
    const a = Float32Array.from([1]);
    const b = Float32Array.from([2]);
    const c = Float32Array.from([3]);
    const mono = toStereo([a]);
    expect(mono[0]).toBe(a);
    expect(Array.from(mono[1])).toEqual([1]);
    expect(mono[1]).not.toBe(a);
    expect(toStereo([a, b, c])).toEqual([a, b]);
    expect(() => toStereo([])).toThrow();
  });
});
