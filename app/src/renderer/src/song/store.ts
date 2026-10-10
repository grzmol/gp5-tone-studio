import { create, type StoreApi, type UseBoundStore } from "zustand";
import { decodeSong } from "./decode";
import { separateStems, type Separation, type SeparationProgress } from "./stems/engine";
import type { Backend } from "./stems/protocol";
import { STEM_NAMES, type PcmAudio, type SongState, type StemName } from "./types";

// The loaded song and its stems (contract: types.ts). One job at a time: loading another song or splitting
// again aborts the running split; results of a superseded job are dropped.

export interface SongDeps {
  decode(file: File): Promise<PcmAudio>;
  separate(audio: PcmAudio, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<Separation>;
}

export interface SongStore extends SongState {
  /** How the last split ran (shown under the player) */
  lastSplit: { backend: Backend; seconds: number } | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function createSongStore(deps: SongDeps): UseBoundStore<StoreApi<SongStore>> {
  let job: AbortController | null = null;
  const begin = () => {
    job?.abort();
    job = new AbortController();
    return job;
  };

  return create<SongStore>((set, get) => ({
    source: null,
    stems: null,
    status: { kind: "idle" },
    lastSplit: null,

    async load(file) {
      const ctrl = begin();
      set({ source: null, stems: null, lastSplit: null, status: { kind: "decoding" } });
      try {
        const audio = await deps.decode(file);
        if (ctrl.signal.aborted) return;
        set({ source: { name: file.name, audio }, status: { kind: "idle" } });
      } catch (e) {
        if (!ctrl.signal.aborted) set({ status: { kind: "error", message: message(e) } });
      } finally {
        if (job === ctrl) job = null;
      }
    },

    async split() {
      const source = get().source;
      if (!source) return;
      const ctrl = begin();
      set({ stems: null, lastSplit: null, status: { kind: "splitting", fraction: 0 } });
      const onProgress = (p: SeparationProgress) => {
        if (ctrl.signal.aborted) return;
        set({ status: p.stage === "model" ? { kind: "model", fraction: p.fraction } : { kind: "splitting", fraction: p.fraction } });
      };
      try {
        const res = await deps.separate(source.audio, onProgress, ctrl.signal);
        if (ctrl.signal.aborted || get().source !== source) return;
        const stems = Object.fromEntries(STEM_NAMES.map((name, i) => [name, { sampleRate: source.audio.sampleRate, channels: res.stems[i] }])) as Record<StemName, PcmAudio>;
        set({ stems, lastSplit: { backend: res.backend, seconds: res.seconds }, status: { kind: "done" } });
      } catch (e) {
        if (!ctrl.signal.aborted && !isAbort(e)) set({ status: { kind: "error", message: message(e) } });
      } finally {
        if (job === ctrl) job = null;
      }
    },

    cancel() {
      if (!job) return;
      job.abort();
      job = null;
      set({ status: { kind: "idle" } });
    },

    reset() {
      job?.abort();
      job = null;
      set({ source: null, stems: null, lastSplit: null, status: { kind: "idle" } });
    },
  }));
}

export const useSong = createSongStore({ decode: decodeSong, separate: separateStems });
