/**
 * Host side of the freestanding wasm kernels (a1kernel.c, a2kernel.c): a bump allocator over the imported memory
 * and the block loop Valeton Suite's getNamOutput runs (DSP::Reset prewarm, then 1024-frame blocks).
 */

/** Valeton renders in 1024-frame blocks */
export const BLOCK = 1024;
const PAGE = 65536;

export interface KernelHeap {
  memory: WebAssembly.Memory;
  alloc(bytes: number): number;
  /** Copy `data` into the heap; returns its address */
  put(data: Float32Array): number;
  writeI32(p: number, values: number[]): void;
  writeF32(p: number, values: number[]): void;
}

export type KernelProcess = (model: number, input: number, output: number, frames: number) => void;

/** Instantiate a kernel module and return its `entry` export with a fresh heap. */
export async function loadKernel(wasm: BufferSource, entry: string): Promise<{ heap: KernelHeap; process: KernelProcess }> {
  const memory = new WebAssembly.Memory({ initial: 64 });
  const { instance } = await WebAssembly.instantiate(wasm, { env: { memory } });
  const { [entry]: process, __heap_base: heapBase } = instance.exports;
  if (typeof process !== "function" || !(heapBase instanceof WebAssembly.Global)) throw new Error(`The SnapTone kernel lacks ${entry}`);

  let top = (Number(heapBase.value) + 15) & ~15;
  const alloc = (bytes: number): number => {
    const p = top;
    top = (top + bytes + 15) & ~15;
    if (top > memory.buffer.byteLength) memory.grow(Math.ceil((top - memory.buffer.byteLength) / PAGE));
    return p;
  };
  const heap: KernelHeap = {
    memory,
    alloc,
    put(data) {
      const p = alloc(data.byteLength);
      new Float32Array(memory.buffer, p, data.length).set(data);
      return p;
    },
    writeI32: (p, values) => new Int32Array(memory.buffer, p, values.length).set(values),
    writeF32: (p, values) => new Float32Array(memory.buffer, p, values.length).set(values),
  };
  return { heap, process: process as KernelProcess };
}

/**
 * Render `x` through the model at `modelPtr`: zero blocks until `prewarm` frames have run (the model starts in its
 * zero-input steady state, like DSP::Reset), then the signal block by block. `onProgress` gets the fraction done.
 */
export function renderBlocks(heap: KernelHeap, process: KernelProcess, modelPtr: number, x: Float32Array, prewarm: number, onProgress?: (fraction: number) => void): Float32Array {
  const inPtr = heap.alloc(4 * BLOCK);
  const outPtr = heap.alloc(4 * BLOCK);
  const run = (src: Float32Array, n: number) => {
    new Float32Array(heap.memory.buffer, inPtr, n).set(src.subarray(0, n));
    process(modelPtr, inPtr, outPtr, n);
    return new Float32Array(heap.memory.buffer, outPtr, n);
  };
  const zeros = new Float32Array(BLOCK);
  for (let done = 0; done < prewarm; done += BLOCK) run(zeros, BLOCK);
  const y = new Float32Array(x.length);
  for (let s = 0; s < x.length; s += BLOCK) {
    const n = Math.min(BLOCK, x.length - s);
    y.set(run(x.subarray(s, s + n), n), s);
    if (onProgress && (s / BLOCK) % 256 === 0) onProgress(s / x.length);
  }
  onProgress?.(1);
  return y;
}
