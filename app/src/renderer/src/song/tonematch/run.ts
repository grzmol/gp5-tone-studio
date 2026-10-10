// Runs the guitar stem analysis in a Web Worker.
import type { PcmAudio } from "@/song/types";
import type { GuitarAnalysis } from "./analyse";
import { toMono } from "./ltas";

export interface AnalyseRequest {
  samples: Float32Array;
  sampleRate: number;
}

export type AnalyseReply = { type: "progress"; fraction: number } | { type: "done"; result: GuitarAnalysis } | { type: "error"; message: string };

/** Analyse a stem (mixed to mono, copied: the stem itself stays with the player). Rejects with AbortError on `signal`. */
export function analyseStem(stem: PcmAudio, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<GuitarAnalysis> {
  const mono = toMono(stem);
  const samples = stem.channels.length === 1 ? mono.slice() : mono;
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise<GuitarAnalysis>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Analysis cancelled", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    worker.onmessage = (e: MessageEvent<AnalyseReply>) => {
      const msg = e.data;
      if (msg.type === "progress") return onProgress?.(msg.fraction);
      finish();
      if (msg.type === "done") resolve(msg.result);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "The analysis stopped"));
    };
    worker.postMessage({ samples, sampleRate: stem.sampleRate } satisfies AnalyseRequest, [samples.buffer]);
  });
}
