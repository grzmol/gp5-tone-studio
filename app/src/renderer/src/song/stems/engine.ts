import { host } from "@/host";
import type { PcmAudio } from "../types";
import type { Backend, WorkerReply, WorkerRequest } from "./protocol";

// UI-thread side of the separation worker. The worker (and the model in it) stays loaded between splits and is
// shut down after IDLE_MS without work, since the session holds about a gigabyte.

export type SeparationProgress = { stage: "model"; fraction: number } | { stage: "split"; fraction: number };

export interface Separation {
  /** stems[source][channel] in STEM_NAMES order, 44.1 kHz */
  stems: Float32Array[][];
  backend: Backend;
  /** Wall time of the split itself (model loading excluded) */
  seconds: number;
}

const IDLE_MS = 120_000;

interface Loaded {
  worker: Worker;
  backend: Backend;
}

let loading: Promise<Loaded> | null = null;
let idleTimer: number | undefined;
let active = 0;
let nextId = 1;

const aborted = () => new DOMException("Separation cancelled", "AbortError");
const send = (worker: Worker, msg: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

function shutDown() {
  const pending = loading;
  loading = null;
  void pending?.then((l) => l.worker.terminate(), () => {});
}

async function fetchModel(onProgress: (p: SeparationProgress) => void): Promise<Uint8Array> {
  const off = host.song.onModelProgress((p) => onProgress({ stage: "model", fraction: p.total ? p.received / p.total : 0 }));
  try {
    return await host.song.model();
  } finally {
    off();
  }
}

async function load(onProgress: (p: SeparationProgress) => void): Promise<Loaded> {
  const model = await fetchModel(onProgress);
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise<Loaded>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.type === "loaded") resolve({ worker, backend: e.data.backend });
      else if (e.data.type === "load-error") {
        worker.terminate();
        reject(new Error(`Couldn't start the separation model: ${e.data.message}`));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "The separation worker stopped"));
    };
    send(worker, { type: "load", model }, [model.buffer]);
  });
}

function ensureLoaded(onProgress: (p: SeparationProgress) => void): Promise<Loaded> {
  loading ??= load(onProgress).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

function runSplit({ worker, backend }: Loaded, audio: PcmAudio, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<Separation> {
  const id = nextId++;
  const started = performance.now();
  return new Promise<Separation>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      worker.removeEventListener("message", onMessage);
      worker.onerror = null;
    };
    const abort = () => {
      send(worker, { type: "cancel", id });
      finish();
      reject(aborted());
    };
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      if (!("id" in msg) || msg.id !== id) return;
      if (msg.type === "progress") return onProgress({ stage: "split", fraction: msg.fraction });
      finish();
      if (msg.type === "done") resolve({ stems: msg.stems, backend, seconds: (performance.now() - started) / 1000 });
      else if (msg.type === "cancelled") reject(aborted());
      else reject(new Error(msg.message));
    };
    signal.addEventListener("abort", abort);
    worker.addEventListener("message", onMessage);
    worker.onerror = (e) => {
      finish();
      shutDown();
      reject(new Error(e.message || "The separation worker stopped"));
    };
    // The worker takes copies: the source stays playable while it splits.
    const channels = audio.channels.map((c) => c.slice());
    send(worker, { type: "split", id, channels }, channels.map((c) => c.buffer));
  });
}

/** Split 44.1 kHz stereo `audio` into the six stems in the worker; downloads the model on first use. */
export async function separateStems(audio: PcmAudio, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<Separation> {
  clearTimeout(idleTimer);
  active++;
  try {
    const loaded = await ensureLoaded(onProgress);
    if (signal.aborted) throw aborted();
    onProgress({ stage: "split", fraction: 0 });
    return await runSplit(loaded, audio, onProgress, signal);
  } finally {
    if (--active === 0) idleTimer = window.setTimeout(shutDown, IDLE_MS);
  }
}
