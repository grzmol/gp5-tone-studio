/**
 * NAM A2 rendered with the wasm SIMD kernel in a2kernel.c, the way Valeton Suite 2.1.0's getNamOutput runs it:
 * NeuralAmpModelerCore loads the SlimmableContainer, nobody calls SetSlimmableSize, so its last (full-size)
 * submodel renders, through the A2 fast path (A2FastModel<3|8>, a2_fast.cpp at commit baf1bf8). DSP::Reset
 * prewarms for Σ (K − 1)·d + 15 frames; then the signal goes through in 1024-frame blocks.
 * Weight order (A2FastModel::_load_weights): rechannel (C), then per layer conv (out, in, kernel) + bias,
 * input mixin (C), layer1x1 (out, in) + bias; then the head conv (in, 16 taps), head bias, head_scale last.
 */
import { A2_DILATIONS, A2_HEAD_TAPS, A2_KERNEL_SIZES, selectA2 } from "@shared/nam";
import { BLOCK, loadKernel, renderBlocks } from "./kernel";

export interface A2Layer {
  kernel: number;
  dilation: number;
  /** [kernel][out][in] */
  conv: Float32Array;
  convBias: Float32Array;
  mix: Float32Array;
  /** [out][in] */
  l1: Float32Array;
  l1Bias: Float32Array;
}

export interface A2Model {
  channels: number;
  rechannel: Float32Array;
  layers: A2Layer[];
  /** [tap][in], oldest tap first */
  head: Float32Array;
  headBias: number;
  headScale: number;
  /** Frames DSP::Reset runs before the signal (A2FastModel::GetPrewarmSamples) */
  prewarm: number;
  /** The model's sample rate, or null when the file has none */
  sampleRate: number | null;
}

/** Parse a NAM A2 file (SlimmableContainer or a bare A2 WaveNet) into the submodel Suite renders. */
export function parseA2(text: string): A2Model {
  const { model, channels: C, sampleRate } = selectA2(JSON.parse(text) as Record<string, unknown>);
  const weights = model.weights as number[];
  let pos = 0;
  const take = (n: number): Float32Array => {
    const out = Float32Array.from(weights.slice(pos, pos + n));
    pos += n;
    return out;
  };
  const rechannel = take(C);
  const layers = A2_KERNEL_SIZES.map((K, li): A2Layer => {
    const fileConv = take(C * C * K); // [out][in][kernel]
    const conv = new Float32Array(K * C * C);
    for (let o = 0; o < C; o++) for (let i = 0; i < C; i++) for (let k = 0; k < K; k++) conv[(k * C + o) * C + i] = fileConv[(o * C + i) * K + k];
    return { kernel: K, dilation: A2_DILATIONS[li], conv, convBias: take(C), mix: take(C), l1: take(C * C), l1Bias: take(C) };
  });
  const fileHead = take(C * A2_HEAD_TAPS); // [in][tap]
  const head = new Float32Array(A2_HEAD_TAPS * C);
  for (let i = 0; i < C; i++) for (let k = 0; k < A2_HEAD_TAPS; k++) head[k * C + i] = fileHead[i * A2_HEAD_TAPS + k];
  const [headBias, headScale] = take(2);
  const prewarm = layers.reduce((s, l) => s + (l.kernel - 1) * l.dilation, 0) + A2_HEAD_TAPS - 1;
  return { channels: C, rechannel, layers, head, headBias, headScale, prewarm, sampleRate };
}

// Struct sizes of a2kernel.c (wasm32: i32, float and pointers are 4 bytes).
const LAYER_BYTES = 36; // kernel, dilation, look + 6 pointers
const MODEL_BYTES = 44; // channels, numLayers, maxBlock, headScale, headBias + 6 pointers

/**
 * Render `x` through `model` with the kernel in `wasm` (the a2kernel.wasm bytes). `onProgress` gets the
 * fraction done. Output has x.length samples.
 */
export async function renderA2(wasm: BufferSource, model: A2Model, x: Float32Array, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const { heap, process } = await loadKernel(wasm, "a2_process");
  const { alloc, put, writeI32 } = heap;
  const C = model.channels;
  const layersPtr = alloc(LAYER_BYTES * model.layers.length);
  model.layers.forEach((l, li) => {
    const look = (l.kernel - 1) * l.dilation;
    writeI32(layersPtr + li * LAYER_BYTES, [l.kernel, l.dilation, look, put(l.conv), put(l.convBias), put(l.mix), put(l.l1), put(l.l1Bias), alloc(4 * C * (look + BLOCK))]);
  });
  const modelPtr = alloc(MODEL_BYTES);
  const tail = [put(model.rechannel), put(model.head), layersPtr, alloc(4 * C * BLOCK), alloc(4 * C * BLOCK), alloc(4 * C * (A2_HEAD_TAPS - 1 + BLOCK))];
  writeI32(modelPtr, [C, model.layers.length, BLOCK, 0, 0, ...tail]);
  heap.writeF32(modelPtr + 12, [model.headScale, model.headBias]);
  return renderBlocks(heap, process, modelPtr, x, model.prewarm, onProgress);
}
