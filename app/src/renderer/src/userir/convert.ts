// WAV -> GP-5 User IR data block, as Valeton Suite 2.1.0 prepares an IR (see .claude/skills/gp5-reverse-engineering/
// userir.md §1): channel 0, r8brain resample to 44.1 kHz, JUCE 24-bit rounding, first 512 samples. Two Suite quirks
// are fixed on purpose: chunks are walked instead of read at fixed offsets, and stereo 24-bit/44.1 kHz files use
// channel 0 instead of being sent interleaved. Clean mono files give the same bytes as Suite.

import { USER_IR, encodeUserIrData } from "@/gp5/lib/userir.mjs";
import { convertSampleRate } from "@/snaptone/htkpa";

export interface UserIrFile {
  /** 2048-byte data block for Gp5Session.uploadUserIr */
  data: Uint8Array;
  sourceRate: number;
  sourceFrames: number;
  /** The IR was longer than the 512 samples (11.6 ms at 44.1 kHz) the pedal keeps */
  truncated: boolean;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

interface WavFormat {
  format: number;
  channels: number;
  rate: number;
  bits: number;
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Walk the RIFF chunks for `fmt ` and `data`. */
function readChunks(wav: Uint8Array): { fmt: WavFormat; data: Uint8Array } {
  if (wav.length < 12 || fourcc(wav, 0) !== "RIFF" || fourcc(wav, 8) !== "WAVE") throw new Error("This file is not a WAV file.");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let fmt: WavFormat | null = null;
  let data: Uint8Array | null = null;
  for (let o = 12; o + 8 <= wav.length; ) {
    const id = fourcc(wav, o);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt " && size >= 16) {
      let format = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format tag at the start of its sub-format GUID.
      if (format === FORMAT_EXTENSIBLE && size >= 40) format = view.getUint16(body + 24, true);
      fmt = { format, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      // Streaming writers may leave the size unset; take what the file holds.
      data = wav.subarray(body, Math.min(body + size, wav.length));
    }
    o = body + size + (size & 1); // chunks are padded to an even length
  }
  if (!fmt) throw new Error("This WAV file has no format chunk.");
  if (!data) throw new Error("This WAV file has no audio data.");
  return { fmt, data };
}

/** Sample reader for one supported encoding, returning -1..1 (JUCE: int / 2^(bits - 1)), or null if unsupported. */
function sampleReader({ format, bits }: WavFormat, view: DataView): ((o: number) => number) | null {
  if (format === FORMAT_FLOAT && bits === 32) return (o) => view.getFloat32(o, true);
  if (format !== FORMAT_PCM) return null;
  switch (bits) {
    case 8:
      return (o) => (view.getUint8(o) - 128) / 128;
    case 16:
      return (o) => view.getInt16(o, true) / 0x8000;
    case 24:
      return (o) => ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 0x800000);
    case 32:
      return (o) => view.getInt32(o, true) / 0x80000000;
  }
  return null;
}

/** JUCE's float -> 24-bit writer: roundToInt(clamp(x, -1, 1) * 0x7fffffff) >> 8 (as pcmRoundTrip(x, 24)). */
function to24(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return Math.floor(Math.floor(c * 0x7fffffff + 0.5) / 256);
}

/** Parse a WAV file and turn it into the 2048-byte User IR block the GP-5 takes. Throws a user-facing Error. */
export function prepareUserIr(wav: Uint8Array): UserIrFile {
  const { fmt, data } = readChunks(wav);
  if (fmt.channels < 1 || fmt.rate < 1) throw new Error("This WAV file has an invalid format header.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const read = sampleReader(fmt, view);
  if (!read) throw new Error(`This WAV encoding isn't supported (format ${fmt.format}, ${fmt.bits}-bit). Use 16-, 24- or 32-bit PCM or 32-bit float.`);
  const frameBytes = (fmt.bits / 8) * fmt.channels;
  const sourceFrames = Math.floor(data.length / frameBytes);
  if (sourceFrames === 0) throw new Error("This WAV file contains no audio.");

  // Zero-filled: shorter IRs are padded with silence, as Suite does.
  const samples24 = new Int32Array(USER_IR.SAMPLES);
  let frames44 = sourceFrames;
  if (fmt.rate === USER_IR.RATE && fmt.format === FORMAT_PCM && fmt.bits === 24) {
    // Suite's direct path: the 24-bit values go to the pedal untouched.
    const n = Math.min(sourceFrames, USER_IR.SAMPLES);
    for (let i = 0; i < n; i++) samples24[i] = Math.round(read(i * frameBytes) * 0x800000);
  } else {
    let ch0: Float32Array = new Float32Array(sourceFrames);
    for (let i = 0; i < sourceFrames; i++) ch0[i] = read(i * frameBytes);
    if (fmt.rate !== USER_IR.RATE) ch0 = convertSampleRate(ch0, fmt.rate, USER_IR.RATE);
    frames44 = ch0.length;
    if (frames44 === 0) throw new Error("This IR is too short to use.");
    const n = Math.min(frames44, USER_IR.SAMPLES);
    for (let i = 0; i < n; i++) samples24[i] = to24(ch0[i]);
  }
  return { data: encodeUserIrData(samples24), sourceRate: fmt.rate, sourceFrames, truncated: frames44 > USER_IR.SAMPLES };
}
