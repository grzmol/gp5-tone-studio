// NAM capture editing: local copies of `.nam` files and their versions (recipes). Owner: Capture editor.
// Storage (Electron, under userData):
//   tones/<tone_id>/<model_id>.nam          TONE3000 download (owned by Tones; read-only here)
//   tones/<tone_id>/versions/<model_id>/    this domain: v<N>.json recipes, v<N>.nam exports, draft.json
//   captures/<ref>/original.nam + versions/ local `.nam` files opened from disk (ref = "file-<sha256 prefix>")
// The original file is never modified. A version is a small recipe on top of it (design/screens/capture-editor.md).

/** Metadata fields a person can edit. Strings: "" = not set. Numbers: null = not set. */
export interface CaptureMetadata {
  name: string;
  modeled_by: string;
  gear_make: string;
  gear_model: string;
  gear_type: string;
  tone_type: string;
  input_level_dbu: number | null;
  output_level_dbu: number | null;
}

/** "Shape before GP-5": pre → capture → post. Flat = every value at its neutral position. */
export interface Shaping {
  /** Input drive, dB (±12) */
  driveDb: number;
  /** Low cut, Hz (20 = off … 300) */
  lowCutHz: number;
  /** Tight, % (0–100): low-mid cut before the capture */
  tightPct: number;
  bassDb: number;
  midDb: number;
  trebleDb: number;
  /** High cut, Hz (2000 … 20000 = off) */
  highCutHz: number;
}

export type CaptureSize = "both" | "full" | "lite";

export interface CaptureRecipe {
  metadata: CaptureMetadata;
  /** Output trim in dB (±24), on top of the loudness match */
  trimDb: number;
  /** Match loudness target in dB (e.g. −18), null = off */
  loudnessTarget: number | null;
  /** A2 sizes kept in the exported file */
  size: CaptureSize;
  shaping: Shaping;
}

export interface CaptureVersion {
  /** 1, 2, 3 … (the original is version 0 and is not stored) */
  n: number;
  createdAt: string;
  /** sha256 of the original file this recipe applies to */
  base: string;
  recipe: CaptureRecipe;
  /** One line: what changed compared with the version before */
  summary: string;
  /** Set when this version was made by restoring an older one */
  restoredFrom?: number;
}

export interface CaptureDraft {
  /** Version the draft started from (0 = original) */
  from: number;
  recipe: CaptureRecipe;
  savedAt: string;
}

export interface CaptureSource {
  /** Tone id (TONE3000) or "file-<hash>" for a file opened from disk */
  ref: string;
  kind: "tone" | "file";
  /** TONE3000 model id for tones, null for files */
  modelId: number | null;
  fileName: string;
  sha256: string;
  /** The original `.nam` text, exactly as downloaded/opened */
  text: string;
}

export interface CaptureState {
  source: CaptureSource;
  versions: CaptureVersion[];
  draft: CaptureDraft | null;
}

/** Which capture a call is about: the ref plus, for tones, the model. */
export interface CaptureKey {
  ref: string;
  modelId: number | null;
}

export interface CaptureApi {
  /** Copy a `.nam` file from disk into the capture store (Electron: absolute path). Returns its ref. */
  importFile(path: string): Promise<string>;
  /** Store `.nam` text (dropped files in the browser). Returns its ref. */
  importText(fileName: string, text: string): Promise<string>;
  /**
   * Open a capture: the original, its versions and the unsaved draft. For tones, `modelId` picks a
   * downloaded model; when omitted the A2 model (or the only one) is used.
   */
  open(ref: string, modelId?: number | null): Promise<CaptureState>;
  /** Close the current draft as the next version. `file` is the lossless A2 export of the recipe. */
  saveVersion(key: CaptureKey, input: { recipe: CaptureRecipe; summary: string; restoredFrom?: number; file: string }): Promise<CaptureVersion>;
  deleteVersion(key: CaptureKey, n: number): Promise<void>;
  /** Autosave of the working state (null clears it). */
  saveDraft(key: CaptureKey, draft: CaptureDraft | null): Promise<void>;
  /** Show the capture's folder (original + versions) in the file manager. Desktop only. */
  showFiles(key: CaptureKey): Promise<void>;
  /** Save a `.nam` export. Electron: Save dialog (null when cancelled). Browser: download. */
  exportFile(suggestedName: string, text: string): Promise<string | null>;
  /** Write a file for Valeton Suite into the hand-off folder; returns its path. Desktop only. */
  saveForSuite(fileName: string, text: string): Promise<string>;
}
