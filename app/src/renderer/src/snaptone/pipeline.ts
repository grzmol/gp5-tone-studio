/**
 * NAM A1 model -> 8840-byte SnapTone clone blob, reproducing Valeton Suite 2.1.0's namConverterCloData:
 *  1. excitation: channel 0 of Suite's nam_input_wav.wav (44.1 kHz, 16-bit, 70 s), resampled to the model rate
 *     with the library's r8brain converter and stored as 24-bit (getConvertNormalWav -> HTCache/<sr>.wav);
 *  2. NAM output: the model (fast tanh, prewarmed) on that excitation, times 0.31, stored as 16-bit (getNamOutput);
 *  3. HTKPA::startClone on the two signals as JUCE reads them back.
 * The 16/24-bit round trips are part of the recipe: the clone reacts to single LSBs.
 */
import { SIGNAL_RATE } from "@shared/host/snaptone";
import { cloneSnapTone, convertSampleRate } from "./htkpa";
import { parseA1, renderA1 } from "./wavenet";

/** getNamOutput's fixed output gain (0.31f at 0x19fc28). */
const NAM_OUTPUT_GAIN = Math.fround(0.31);
/** getNamOutput: models without a sample rate are rendered at 48 kHz. */
const DEFAULT_MODEL_RATE = 48000;
/** Rates HTKPA has excitation FIR tables for. */
const CLONE_RATES = [44100, 48000, 96000];

/**
 * Write `x` as `bits`-bit PCM and read it back, exactly like JUCE's WAV writer and reader:
 * roundToInt(clamp(x) * 0x7fffffff) >> (32 - bits), then int / 2^(bits - 1).
 */
export function pcmRoundTrip(x: Float32Array, bits: 16 | 24): Float32Array {
  const shift = 2 ** (32 - bits);
  const scale = 2 ** (bits - 1);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const c = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i];
    out[i] = Math.floor(Math.floor(c * 0x7fffffff + 0.5) / shift) / scale;
  }
  return out;
}

export type ClonePhase = "excitation" | "render" | "clone";

/**
 * Run the whole conversion. `namText` is a NAM A1 standard model in the 0.5.x layout, `excitation` channel 0 of
 * nam_input_wav.wav (shared/host/snaptone.ts readSignalWav), `kernel` the a1kernel.wasm bytes.
 */
export async function namToCloneBlob(
  namText: string,
  excitation: Int16Array,
  kernel: BufferSource,
  onProgress: (phase: ClonePhase, fraction: number) => void = () => {},
): Promise<Uint8Array> {
  const model = parseA1(namText);
  const rate = model.sampleRate ?? DEFAULT_MODEL_RATE;
  if (!CLONE_RATES.includes(rate)) throw new Error(`SnapTones can be made from 44.1, 48 or 96 kHz models; this one is ${rate / 1000} kHz`);
  onProgress("excitation", 0);
  const source = Float32Array.from(excitation, (v) => v / 32768);
  const input = pcmRoundTrip(rate === SIGNAL_RATE ? source : convertSampleRate(source, SIGNAL_RATE, rate), 24);
  const rendered = await renderA1(kernel, model, input, (f) => onProgress("render", f));
  for (let i = 0; i < rendered.length; i++) rendered[i] = Math.fround(rendered[i] * NAM_OUTPUT_GAIN);
  onProgress("clone", 0);
  return cloneSnapTone(input, pcmRoundTrip(rendered, 16), rate);
}
