/**
 * NAM A1 WaveNet (0.5.x layout, non-gated, Tanh) rendered with the wasm SIMD kernel in a1kernel.c, the way
 * Valeton Suite's getNamOutput runs NeuralAmpModelerCore: fast tanh, DSP::Reset prewarm (the model starts
 * in its zero-input steady state), then the signal block by block. Weight order follows NeuralAmpModelerCore
 * wavenet set_weights_: per layer array rechannel, then per layer conv (out, in, kernel) + bias, input mixin,
 * 1x1 + bias; then head (+ bias); head_scale last.
 */

export interface A1Layer {
  dilation: number;
  /** (kernel - 1) * dilation frames of history */
  look: number;
  conv: Float32Array;
  convBias: Float32Array;
  mix: Float32Array;
  l1: Float32Array;
  l1Bias: Float32Array;
}

export interface A1LayerArray {
  inSize: number;
  channels: number;
  headSize: number;
  rechannel: Float32Array;
  layers: A1Layer[];
  head: Float32Array;
  headBias: Float32Array;
}

export interface A1Model {
  arrays: A1LayerArray[];
  headScale: number;
  receptiveField: number;
  /** The model's sample rate, or null when the file has none */
  sampleRate: number | null;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse a NAM A1 WaveNet in the 0.5.x JSON layout (what shared/nam.ts prepareNam returns). */
export function parseA1(text: string): A1Model {
  const nam: unknown = JSON.parse(text);
  if (!isObject(nam) || nam.architecture !== "WaveNet" || !isObject(nam.config) || !Array.isArray(nam.weights))
    throw new Error("Not a NAM WaveNet model");
  const { layers, head } = nam.config;
  if (!Array.isArray(layers) || layers.length === 0 || head != null) throw new Error("Not a NAM A1 WaveNet");
  const weights = nam.weights as number[];
  let pos = 0;
  const take = (n: number): Float32Array => {
    if (pos + n > weights.length) throw new Error("The NAM file has fewer weights than its layers need");
    const out = Float32Array.from(weights.slice(pos, pos + n));
    pos += n;
    return out;
  };
  const arrays = layers.map((la: unknown, i): A1LayerArray => {
    if (!isObject(la) || !Array.isArray(la.dilations)) throw new Error(`Layer array ${i} is not an A1 layer array`);
    if (la.kernel_size !== 3) throw new Error(`Layer array ${i} has kernel size ${String(la.kernel_size)}; A1 uses 3`);
    if (la.gated) throw new Error(`Layer array ${i} is gated`);
    if (la.activation !== "Tanh") throw new Error(`Layer array ${i} uses ${String(la.activation)}; A1 uses Tanh`);
    if (la.condition_size !== 1) throw new Error(`Layer array ${i} is not conditioned on the mono input`);
    const C = Number(la.channels);
    const inSize = Number(la.input_size);
    const headSize = Number(la.head_size);
    const rechannel = take(C * inSize);
    const arrayLayers = (la.dilations as number[]).map((d) => ({
      dilation: d,
      look: 2 * d,
      conv: take(C * C * 3),
      convBias: take(C),
      mix: take(C),
      l1: take(C * C),
      l1Bias: take(C),
    }));
    return { inSize, channels: C, headSize, rechannel, layers: arrayLayers, head: take(headSize * C), headBias: la.head_bias ? take(headSize) : new Float32Array(headSize) };
  });
  const headScale = take(1)[0];
  if (pos !== weights.length) throw new Error(`The NAM file has ${weights.length - pos} more weights than its layers use`);
  arrays.forEach((a, i) => {
    const prev = arrays[i - 1];
    if (i === 0 ? a.inSize !== 1 : a.inSize !== prev.channels || a.channels !== prev.headSize) throw new Error("The NAM layer arrays don't chain");
  });
  if (arrays[arrays.length - 1].headSize !== 1) throw new Error("The NAM model is not mono");
  const receptiveField = 1 + arrays.reduce((s, a) => s + a.layers.reduce((t, l) => t + l.look, 0), 0);
  const sr = nam.sample_rate;
  return { arrays, headScale, receptiveField, sampleRate: typeof sr === "number" && sr > 0 ? sr : null };
}

// Struct sizes of a1kernel.c (wasm32: i32 and pointers are 4 bytes).
const LAYER_BYTES = 36; // dilation, look + 7 pointers
const ARRAY_BYTES = 32; // inSize, channels, headSize, numLayers + 4 pointers
const MODEL_BYTES = 36; // numArrays, headScale + 7 pointers
const BLOCK = 1024; // Valeton renders in 1024-frame blocks (the block size does not change the result)
const PAGE = 65536;

/**
 * Render `x` through `model` with the kernel in `wasm` (the a1kernel.wasm bytes). `onProgress` gets the
 * fraction done. Output has x.length samples.
 */
export async function renderA1(wasm: BufferSource, model: A1Model, x: Float32Array, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const memory = new WebAssembly.Memory({ initial: 64 });
  const { instance } = await WebAssembly.instantiate(wasm, { env: { memory } });
  const { a1_process: process, __heap_base: heapBase } = instance.exports;
  if (typeof process !== "function" || !(heapBase instanceof WebAssembly.Global)) throw new Error("a1kernel.wasm lacks its exports");

  let top = (Number(heapBase.value) + 15) & ~15;
  const alloc = (bytes: number): number => {
    const p = top;
    top = (top + bytes + 15) & ~15;
    if (top > memory.buffer.byteLength) memory.grow(Math.ceil((top - memory.buffer.byteLength) / PAGE));
    return p;
  };
  const put = (data: Float32Array): number => {
    const p = alloc(data.byteLength);
    new Float32Array(memory.buffer, p, data.length).set(data);
    return p;
  };
  const writeI32 = (p: number, values: number[]) => new Int32Array(memory.buffer, p, values.length).set(values);

  const maxC = Math.max(...model.arrays.map((a) => a.channels));
  const arraysPtr = alloc(ARRAY_BYTES * model.arrays.length);
  const headOutTable = alloc(4 * model.arrays.length);
  model.arrays.forEach((a, ai) => {
    const layersPtr = alloc(LAYER_BYTES * a.layers.length);
    a.layers.forEach((l, li) => {
      const fields = [l.dilation, l.look, put(l.conv), put(l.convBias), put(l.mix), put(l.l1), put(l.l1Bias), alloc(4 * a.channels * l.look), alloc(4 * a.channels * (l.look + BLOCK))];
      writeI32(layersPtr + li * LAYER_BYTES, fields);
    });
    writeI32(arraysPtr + ai * ARRAY_BYTES, [a.inSize, a.channels, a.headSize, a.layers.length, put(a.rechannel), put(a.head), put(a.headBias), layersPtr]);
    writeI32(headOutTable + ai * 4, [alloc(4 * a.headSize * BLOCK)]);
  });
  const modelPtr = alloc(MODEL_BYTES);
  const work = Array.from({ length: 5 }, () => alloc(4 * maxC * BLOCK)); // hA, hB, arrayOut, z, headSum
  const inPtr = alloc(4 * BLOCK);
  const outPtr = alloc(4 * BLOCK);
  writeI32(modelPtr, [model.arrays.length, 0, arraysPtr, ...work, headOutTable]);
  new Float32Array(memory.buffer, modelPtr + 4, 1)[0] = model.headScale;

  const run = (src: Float32Array, n: number) => {
    new Float32Array(memory.buffer, inPtr, n).set(src.subarray(0, n));
    (process as (m: number, i: number, o: number, n: number) => void)(modelPtr, inPtr, outPtr, n);
    return new Float32Array(memory.buffer, outPtr, n);
  };
  const zeros = new Float32Array(BLOCK);
  for (let done = 0; done < model.receptiveField; done += BLOCK) run(zeros, BLOCK);
  const y = new Float32Array(x.length);
  for (let s = 0; s < x.length; s += BLOCK) {
    const n = Math.min(BLOCK, x.length - s);
    y.set(run(x.subarray(s, s + n), n), s);
    if (onProgress && (s / BLOCK) % 256 === 0) onProgress(s / x.length);
  }
  onProgress?.(1);
  return y;
}
