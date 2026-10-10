/// <reference lib="webworker" />
// Separation worker: onnxruntime-web runs htdemucs_6s (WebGPU, else WebAssembly) chunk by chunk (demucs.ts).
import * as ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { SEGMENT, separate } from "./demucs";
import type { Backend, WorkerReply, WorkerRequest } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// Threads need a cross-origin isolated page (SharedArrayBuffer); otherwise the CPU path runs on one thread.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;

let session: ort.InferenceSession | null = null;
const cancelled = new Set<number>();
const post = (msg: WorkerReply, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function createSession(model: Uint8Array): Promise<{ session: ort.InferenceSession; backend: Backend }> {
  const opts = { graphOptimizationLevel: "all" } as const;
  if ("gpu" in navigator) {
    try {
      return { session: await ort.InferenceSession.create(model, { ...opts, executionProviders: ["webgpu"] }), backend: "webgpu" };
    } catch {
      // No adapter, or the GPU can't run the graph: fall back to the CPU.
    }
  }
  return { session: await ort.InferenceSession.create(model, { ...opts, executionProviders: ["wasm"] }), backend: "wasm" };
}

async function runSegment(mix: Float32Array): Promise<Float32Array> {
  const s = session!;
  const input = new ort.Tensor("float32", mix, [1, 2, SEGMENT]);
  const out = await s.run({ [s.inputNames[0]]: input });
  const stems = out[s.outputNames[0]];
  const data = (await stems.getData()) as Float32Array;
  stems.dispose();
  return data;
}

async function split(id: number, channels: Float32Array[]) {
  try {
    if (!session) throw new Error("The separation model isn't loaded.");
    const stems = await separate(channels, runSegment, {
      onProgress: (fraction) => post({ type: "progress", id, fraction }),
      cancelled: () => cancelled.has(id),
    });
    post({ type: "done", id, stems }, stems.flat().map((c) => c.buffer));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") post({ type: "cancelled", id });
    else post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  } finally {
    cancelled.delete(id);
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") cancelled.add(msg.id);
  else if (msg.type === "split") void split(msg.id, msg.channels);
  else {
    try {
      const created = await createSession(msg.model);
      session = created.session;
      post({ type: "loaded", backend: created.backend });
    } catch (err) {
      post({ type: "load-error", message: err instanceof Error ? err.message : String(err) });
    }
  }
};
