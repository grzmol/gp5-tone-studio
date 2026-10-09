import { host } from "@/host";
import type { ClonePhase } from "./pipeline";

export interface ConvertRequest {
  namText: string;
  /** Valeton's nam_input_wav.wav (see shared/host/snaptone.ts) */
  signalWav: Uint8Array;
}

export type ConvertReply =
  | { type: "progress"; phase: ClonePhase; fraction: number }
  | { type: "done"; file: Uint8Array }
  | { type: "error"; message: string };

/** Share of the total time each phase takes (measured in Node: resample 0.8 s, render 3.9 s, clone 7 s). */
const PHASE_SPAN: Record<ClonePhase, [number, number]> = { excitation: [0, 0.07], render: [0.07, 0.4], clone: [0.4, 1] };

/**
 * Convert a NAM A1 standard model (0.5.x JSON, see shared/nam.ts prepareNam) into a 2696-byte SnapTone file,
 * in a Web Worker. `onProgress` gets an overall fraction 0..1 (the clone phase reports only its start).
 */
export async function convertToSnapTone(namText: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const signalWav = await host.snaptone.signal();
  if (!signalWav) throw new Error("Making a SnapTone needs Valeton's test signal (nam_input_wav.wav). Choose it first.");
  if (signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise<Uint8Array>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Conversion cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort);
    worker.onmessage = (e: MessageEvent<ConvertReply>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        const [from, to] = PHASE_SPAN[msg.phase];
        onProgress?.(from + (to - from) * msg.fraction);
      } else {
        finish();
        if (msg.type === "done") resolve(msg.file);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "The SnapTone converter stopped"));
    };
    worker.postMessage({ namText, signalWav } satisfies ConvertRequest, [signalWav.buffer]);
  });
}
