// Messages between the stem engine (engine.ts, UI thread) and the separation worker (worker.ts).

/** WebGPU when the browser has a GPU adapter that runs the model, else WebAssembly on the CPU. */
export type Backend = "webgpu" | "wasm";

export type WorkerRequest =
  /** Create the ONNX session from the model bytes (transferred) */
  | { type: "load"; model: Uint8Array }
  /** Split planar stereo 44.1 kHz audio (transferred) */
  | { type: "split"; id: number; channels: Float32Array[] }
  | { type: "cancel"; id: number };

export type WorkerReply =
  | { type: "loaded"; backend: Backend }
  | { type: "load-error"; message: string }
  | { type: "progress"; id: number; fraction: number }
  /** stems[source][channel], STEM_NAMES order */
  | { type: "done"; id: number; stems: Float32Array[][] }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };
