/**
 * NAM model -> 8840-byte SnapTone clone blob, reproducing Valeton Suite 2.1.0's namConverterCloData:
 *  1. excitation: channel 0 of Suite's nam_input_wav.wav (44.1 kHz, 16-bit, 70 s), resampled to the model rate
 *     with the library's r8brain converter and stored as 24-bit (getConvertNormalWav -> HTCache/<sr>.wav);
 *  2. NAM output: the model (fast tanh, prewarmed) on that excitation, times 0.31, stored as 16-bit (getNamOutput).
 *     A1 renders with a1kernel.wasm; A2 renders its container's last (full-size) submodel with a2kernel.wasm,
 *     because Suite never sets a slimmable size;
 *  3. HTKPA::startClone on the two signals as JUCE reads them back.
 * The 16/24-bit round trips are part of the recipe: the clone reacts to single LSBs.
 */
import { SIGNAL_RATE } from "@shared/host/snaptone";
import { DEFAULT_MODEL_RATE, prepareNam } from "@shared/nam";
import { parseA2, renderA2 } from "./a2";
import { cloneSnapTone, convertSampleRate } from "./htkpa";
import { parseA1, renderA1 } from "./wavenet";

/** getNamOutput's fixed output gain (0.31f at 0x19fc28). */
const NAM_OUTPUT_GAIN = Math.fround(0.31);

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

/** The wasm kernel for a model family (a1kernel.wasm or a2kernel.wasm bytes). */
export type KernelSource = (arch: "A1" | "A2") => BufferSource | Promise<BufferSource>;

/**
 * Run the whole conversion. `namText` is a NAM A1 or A2 model (checked and, for A1 0.7.x, reshaped by
 * shared/nam.ts prepareNam), `excitation` channel 0 of nam_input_wav.wav (shared/host/snaptone.ts readSignalWav).
 */
export async function namToCloneBlob(
  namText: string,
  excitation: Int16Array,
  kernel: KernelSource,
  onProgress: (phase: ClonePhase, fraction: number) => void = () => {},
): Promise<Uint8Array> {
  const { json, check } = prepareNam(namText);
  const model = check.arch === "A2" ? { arch: "A2" as const, a2: parseA2(json) } : { arch: "A1" as const, a1: parseA1(json) };
  const rate = (model.arch === "A2" ? model.a2.sampleRate : model.a1.sampleRate) ?? DEFAULT_MODEL_RATE;
  onProgress("excitation", 0);
  const source = Float32Array.from(excitation, (v) => v / 32768);
  const input = pcmRoundTrip(rate === SIGNAL_RATE ? source : convertSampleRate(source, SIGNAL_RATE, rate), 24);
  const wasm = await kernel(model.arch);
  const progress = (f: number) => onProgress("render", f);
  const rendered = model.arch === "A2" ? await renderA2(wasm, model.a2, input, progress) : await renderA1(wasm, model.a1, input, progress);
  for (let i = 0; i < rendered.length; i++) rendered[i] = Math.fround(rendered[i] * NAM_OUTPUT_GAIN);
  onProgress("clone", 0);
  return cloneSnapTone(input, pcmRoundTrip(rendered, 16), rate);
}
