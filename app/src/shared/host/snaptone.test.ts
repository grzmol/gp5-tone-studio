import { describe, expect, it } from "vitest";
import { readSignalWav, SIGNAL_FRAMES, SIGNAL_RATE } from "./snaptone";

/** A PCM WAV whose sample i of channel c is (i * 7 + c * 1000) mod 2^15, with an optional chunk before "data". */
function wav({ rate = SIGNAL_RATE, bits = 16, channels = 2, frames = SIGNAL_FRAMES, extraChunk = false } = {}): Uint8Array {
  const bytesPer = bits / 8;
  const dataSize = frames * channels * bytesPer;
  const extra = extraChunk ? 8 + 5 + 1 : 0; // odd-sized chunk plus its pad byte
  const out = new Uint8Array(44 + extra + dataSize);
  const view = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * bytesPer, true);
  view.setUint16(32, channels * bytesPer, true);
  view.setUint16(34, bits, true);
  let off = 36;
  if (extraChunk) {
    tag(off, "LIST");
    view.setUint32(off + 4, 5, true);
    off += extra;
  }
  tag(off, "data");
  view.setUint32(off + 4, dataSize, true);
  if (bits === 16) for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) view.setInt16(off + 8 + (i * channels + c) * 2, (i * 7 + c * 1000) % 32768, true);
  return out;
}

describe("readSignalWav", () => {
  it("returns channel 0 of a 16-bit 44.1 kHz stereo WAV, past other chunks", () => {
    const samples = readSignalWav(wav({ extraChunk: true }));
    expect(samples.length).toBe(SIGNAL_FRAMES);
    expect(Array.from(samples.subarray(0, 4))).toEqual([0, 7, 14, 21]);
    expect(samples[SIGNAL_FRAMES - 1]).toBe(((SIGNAL_FRAMES - 1) * 7) % 32768);
  });

  it("reads a mono file", () => {
    expect(readSignalWav(wav({ channels: 1 }))[3]).toBe(21);
  });

  it("rejects files that aren't Valeton's test signal", () => {
    expect(() => readSignalWav(new TextEncoder().encode("not a wav file at all"))).toThrow("isn't a WAV");
    expect(() => readSignalWav(wav({ rate: 48000 }))).toThrow("44.1 kHz");
    expect(() => readSignalWav(wav({ bits: 24 }))).toThrow("16-bit");
    expect(() => readSignalWav(wav({ frames: SIGNAL_FRAMES - 1 }))).toThrow("shorter");
  });
});
