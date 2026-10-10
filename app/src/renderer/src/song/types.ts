// Song: a user's audio file split into stems (Stem Splitter) and analysed for a GP-5 preset (Tone Match).
// The store (song/store.ts, `useSong`) owns the loaded song and its stems; Tone Match only reads them.

/** Demucs htdemucs_6s sources, in the model's output order. */
export const STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** Planar PCM: one Float32Array per channel, all the same length. */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

/** The decoded song, resampled to the separation rate (44.1 kHz stereo). */
export interface SongSource {
  /** File name as dropped or picked, shown in the UI */
  name: string;
  audio: PcmAudio;
}

export type SplitStatus =
  | { kind: "idle" }
  | { kind: "decoding" }
  /** First use: the separation model is being downloaded and verified */
  | { kind: "model"; fraction: number }
  | { kind: "splitting"; fraction: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export interface SongState {
  source: SongSource | null;
  /** Present once a split finished for `source`; cleared when another song loads */
  stems: Record<StemName, PcmAudio> | null;
  status: SplitStatus;
  /** Decode a file (wav, mp3, flac, m4a/aac, ogg) into `source`; clears stems */
  load(file: File): Promise<void>;
  /** Split `source` into stems (downloads the model on first use); cancels a running split when called again */
  split(): Promise<void>;
  cancel(): void;
  reset(): void;
}
