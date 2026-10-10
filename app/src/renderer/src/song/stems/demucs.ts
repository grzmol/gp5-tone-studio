// Demucs inference around one fixed-length model call, ported from demucs 4 (facebookresearch/demucs, MIT):
// demucs.api's Separator normalises the track by the mean/std of its mono mix, apply_model(split=True,
// overlap=0.25, shifts=0) cuts it into `segment`-long chunks every `stride` samples, pads the last (short) chunk
// around its centre with the audio before it (TensorChunk.padded), trims the model output back (center_trim) and
// blends the chunks with a triangular transition weight. Checked against PyTorch apply_model on a 30 s mix: max
// difference 2.6e-4. shifts=0: the Separator's default single random shift (up to 0.5 s) averages nothing, so it
// is left out for reproducible output. Pure, so it is tested without the model.

/** htdemucs_6s segment (model.segment = 39/5 s at 44.1 kHz), the export's fixed input length. */
export const SEGMENT = 343_980;
export const SOURCES = 6;
export const OVERLAP = 0.25;

/** One model call: planar stereo [2 × segment] in, planar [sources × 2 × segment] out. */
export type RunSegment = (mix: Float32Array) => Promise<Float32Array>;

export interface Normalisation {
  mean: number;
  std: number;
}

/** Mean and (unbiased) standard deviation + 1e-8 of the mono mix, as demucs.api's `ref = wav.mean(0)`. */
export function mixStats(channels: Float32Array[]): Normalisation {
  const n = channels[0].length;
  const inv = 1 / channels.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) m += ch[i];
    sum += m * inv;
  }
  const mean = n ? sum / n : 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) m += ch[i];
    const d = m * inv - mean;
    sq += d * d;
  }
  const std = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  return { mean, std: std + 1e-8 };
}

/** apply_model's transition weight: a triangle peaking at 1 in the middle of the segment. */
export function transitionWeight(segment: number): Float32Array {
  const half = Math.floor(segment / 2);
  const w = new Float32Array(segment);
  for (let i = 0; i < half; i++) w[i] = i + 1;
  for (let i = half; i < segment; i++) w[i] = segment - i;
  const max = Math.max(half, segment - half);
  for (let i = 0; i < segment; i++) w[i] /= max;
  return w;
}

/** Chunk start offsets: range(0, length, stride) with stride = int((1 - overlap) * segment). */
export function chunkOffsets(length: number, segment = SEGMENT, overlap = OVERLAP): number[] {
  const stride = Math.floor((1 - overlap) * segment);
  const offsets: number[] = [];
  for (let o = 0; o < length; o += stride) offsets.push(o);
  return offsets;
}

/**
 * The model input for the chunk at `offset` (TensorChunk(mix, offset, segment).padded(segment)), normalised:
 * planar [2 × segment]. A short last chunk is centred, with real audio on its left and zeros past the end.
 * Returns the input and where the chunk starts inside it (center_trim's left cut).
 */
export function chunkInput(channels: Float32Array[], norm: Normalisation, offset: number, segment = SEGMENT): { input: Float32Array; lead: number; length: number } {
  const total = channels[0].length;
  const length = Math.min(segment, total - offset);
  const lead = Math.floor((segment - length) / 2);
  const start = offset - lead;
  const input = new Float32Array(2 * segment);
  const from = Math.max(0, start);
  const to = Math.min(total, start + segment);
  for (let c = 0; c < 2; c++) {
    const src = channels[c];
    const dst = c * segment;
    for (let i = from; i < to; i++) input[dst + i - start] = (src[i] - norm.mean) / norm.std;
  }
  return { input, lead, length };
}

export interface SeparateCallbacks {
  /** Called after each chunk with the finished fraction (0..1] */
  onProgress?: (fraction: number) => void;
  /** Checked between chunks; true stops the split with an AbortError */
  cancelled?: () => boolean;
}

/**
 * Separate stereo `channels` (44.1 kHz) into SOURCES stems with `run`: planar output [source][channel], each the
 * length of the input, back at the input's level (the normalisation undone).
 */
export async function separate(channels: Float32Array[], run: RunSegment, cb: SeparateCallbacks = {}, segment = SEGMENT): Promise<Float32Array[][]> {
  if (channels.length !== 2 || channels[1].length !== channels[0].length) throw new Error("Separation needs stereo audio with equal channels.");
  const total = channels[0].length;
  const norm = mixStats(channels);
  const weight = transitionWeight(segment);
  const out = Array.from({ length: SOURCES }, () => [new Float32Array(total), new Float32Array(total)]);
  const sumWeight = new Float32Array(total);
  const offsets = chunkOffsets(total, segment);
  for (let k = 0; k < offsets.length; k++) {
    if (cb.cancelled?.()) throw new DOMException("Separation cancelled", "AbortError");
    const offset = offsets[k];
    const { input, lead, length } = chunkInput(channels, norm, offset, segment);
    const res = await run(input);
    if (res.length !== SOURCES * 2 * segment) throw new Error(`The model returned ${res.length} samples, expected ${SOURCES * 2 * segment}.`);
    for (let s = 0; s < SOURCES; s++)
      for (let c = 0; c < 2; c++) {
        const src = (s * 2 + c) * segment + lead;
        const dst = out[s][c];
        for (let i = 0; i < length; i++) dst[offset + i] += weight[i] * res[src + i];
      }
    for (let i = 0; i < length; i++) sumWeight[offset + i] += weight[i];
    cb.onProgress?.((k + 1) / offsets.length);
  }
  for (const stem of out)
    for (const ch of stem) for (let i = 0; i < total; i++) ch[i] = (ch[i] / sumWeight[i]) * norm.std + norm.mean;
  return out;
}
