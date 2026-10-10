// Song screen (renderer/src/song, screens/song): the stem separation model and saving audio files.
// The model isn't bundled: it is downloaded on first use, checked against SEPARATION_MODEL and cached
// (desktop: userData/models, src/main/ipc/song.ts; browser: Cache Storage, renderer/src/host/web/song.ts).

/**
 * Demucs htdemucs_6s (facebookresearch/demucs, MIT) as ONNX: StemSplitio/htdemucs-6s-onnx (MIT), constant-folded so
 * onnxruntime-web's WebGPU backend runs it (kramp/htdemucs-6s-webgpu-onnx, MIT). Input `mix` [1, 2, 343980]
 * (7.8 s of 44.1 kHz stereo), output `stems` [1, 6, 2, 343980] in STEM_NAMES order. STFT/iSTFT are inside the graph.
 * Pinned to a commit, so the bytes can't change under the checksum.
 */
export const SEPARATION_MODEL = {
  file: "htdemucs_6s.onnx",
  url: "https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/0c850a01007f48d94900b21b49a0d0ae1a17239f/htdemucs_6s.onnx",
  sha256: "a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a",
  bytes: 284_797_240,
} as const;

export interface ModelProgress {
  received: number;
  total: number;
}

export interface SaveFile {
  /** File name only (no folders) */
  name: string;
  bytes: Uint8Array;
}

export interface SongHostApi {
  /** The model is downloaded and checked already (no download needed) */
  hasModel(): Promise<boolean>;
  /**
   * The separation model's bytes: from the cache, else downloaded (progress via onModelProgress), checked against
   * SEPARATION_MODEL and cached. Throws HostError "network" when offline, "invalid" on a checksum mismatch.
   */
  model(): Promise<Uint8Array>;
  /** Download progress of model(); returns the unsubscribe function */
  onModelProgress(cb: (p: ModelProgress) => void): () => void;
  /**
   * Save files the user exports: one file through a Save dialog, several into a folder the user picks (the browser
   * build downloads them). Returns where they went (file or folder; the file name in the browser), null when
   * the dialog is cancelled.
   */
  saveFiles(files: SaveFile[], title: string): Promise<string | null>;
}

/** Hex SHA-256 of `bytes` (browser and Node 20+: WebCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** User-facing message for a model download that failed with `status` (HTTP) or a network error. */
export function modelDownloadError(status: number | null): string {
  if (status === null) return "Couldn't download the separation model. Check your internet connection and try again.";
  return `Couldn't download the separation model (the server answered ${status}). Try again later.`;
}

export const MODEL_CHECKSUM_ERROR = "The downloaded separation model is damaged (its checksum doesn't match). Try again.";
