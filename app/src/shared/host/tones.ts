// TONE3000 (OAuth 2.0 + PKCE, bounded lists, model downloads) and the Valeton Suite hand-off. Owner: Tones.
// Main process: src/main/ipc/tones.ts (+ src/main/tone3000/*). Tokens never leave main.
// API reference: https://www.tone3000.com/api (v1). Free tier: Select/Load Tone flows + created/favorited/downloaded/trending/latest only.

export type T3kGear = "amp" | "amp-cab" | "pedal" | "outboard" | "cab" | "space" | "experimental";
export type T3kFormat = "nam" | "ir" | "aida-x" | "aa-snapshot" | "proteus";
export type T3kSize = "standard" | "lite" | "feather" | "nano" | "custom";
/** "1" = A1, "2" = A2, "custom"; null for non-NAM models (IRs). */
export type T3kArchitecture = "1" | "2" | "custom";

export interface T3kUser {
  id: number;
  username: string;
  /** Only set for verified creators; fall back to username. */
  display_name: string | null;
  avatar_url: string | null;
  url: string;
}

export interface T3kTone {
  id: number;
  title: string;
  description: string | null;
  gear: T3kGear;
  images: string[] | null;
  format: T3kFormat;
  license: string;
  sizes: T3kSize[];
  makes: { id: number; name: string }[];
  models_count: number;
  a1_models_count: number;
  a2_models_count: number;
  custom_models_count: number;
  irs_count: number;
  downloads_count: number;
  favorites_count: number;
  is_public: boolean | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  url: string;
  user: T3kUser;
}

export interface T3kModel {
  id: number;
  name: string;
  size: T3kSize;
  tone_id: number;
  architecture_version: T3kArchitecture | null;
  model_url: string;
  updated_at: string;
}

export type ToneListKind = "favorited" | "created" | "downloaded" | "trending" | "latest";

export interface TonePage {
  tones: T3kTone[];
  page: number;
  totalPages: number;
  /** Total items in the list (trending/latest: the number returned) */
  total: number;
  /** When this page was fetched from TONE3000 (ms); older than now = served from the 10-minute cache */
  fetchedAt: number;
}

export interface AccountState {
  /** "expired": the refresh token was rejected; the user must sign in again */
  status: "signed-out" | "signed-in" | "expired";
  user: T3kUser | null;
  /** A TONE3000 publishable key (client_id) is configured for this build */
  configured: boolean;
  /** The partnership splash has been shown and continued once */
  splashSeen: boolean;
}

/** Authorize-URL options for the embedded flow. */
export interface FlowRequest {
  prompt?: "select_tone" | "load_tone";
  /** Required for load_tone */
  toneId?: number;
  format?: "nam" | "ir";
  /** Underscore-separated gear list, e.g. "amp_amp-cab_pedal" */
  gears?: string;
  architecture?: "1" | "2" | "custom";
}

/** Where the TONE3000 view goes, in CSS pixels relative to the window content. */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FlowResult =
  | { status: "connected"; user: T3kUser | null; toneId: number | null }
  | { status: "canceled" }
  | { status: "error"; message: string };

/** Verdict of a local NAM file check (send step 2). */
export interface NamCheck {
  /** Version found in the downloaded file, e.g. "0.5.4" or "0.7.0" */
  version: string;
  /** The A1 file was converted from 0.7.x to the 0.5.x layout (A2 files are never changed) */
  reshaped: boolean;
  /** NAM architecture family Tone Studio renders the SnapTone from */
  arch: "A1" | "A2";
  /** A1: standard, lite, feather or nano; A2: the rendered (last) submodel, standard (8 channels) or nano (3) */
  size: string;
}

export interface SendRequest {
  toneId: number;
  modelId: number;
  /** Pedal name, at most 10 characters; becomes the hand-off file name */
  name: string;
  /**
   * An edited .nam (capture editor) to prepare instead of the downloaded file. The model is still downloaded
   * once so the tone record lists it; the hand-off file is made from this text.
   */
  text?: string;
}

/** A WAV IR dropped from the OS: either its absolute path (desktop) or its bytes. */
export interface LocalIrRequest {
  path: string | null;
  bytes: Uint8Array | null;
  /** Pedal name, at most 10 characters; becomes the hand-off file name */
  name: string;
}

export interface SendResult {
  /** Absolute path of the prepared file in the hand-off folder */
  path: string;
  fileName: string;
  /** Bytes downloaded from TONE3000 */
  bytes: number;
  /** null for IRs */
  check: NamCheck | null;
  record: ToneRecord;
}

/** A checked NAM model (A1 or A2) ready for the in-app SnapTone converter. */
export interface SnapToneSource {
  /** The model as shared/nam.ts prepareNam returns it: A1 in the 0.5.x JSON layout, A2 unchanged */
  text: string;
  /** Bytes downloaded from TONE3000 */
  bytes: number;
  check: NamCheck;
  record: ToneRecord;
}

export type SendStep = "download" | "check" | "save";

export type TonesEvent =
  | { type: "progress"; toneId: number; modelId: number; step: SendStep; received: number; total: number | null }
  | { type: "suite"; running: boolean };

/** Local tone record, `tones/<tone_id>/meta.json`. */
export interface ToneRecord {
  tone_id: number;
  title: string;
  gear: T3kGear;
  format: T3kFormat;
  creator: { username: string; avatar_url: string | null };
  image_url: string | null;
  license: string;
  url: string;
  models: { id: number; name: string; size: T3kSize; architecture: T3kArchitecture | null; file: string; bytes: number }[];
  gp5: {
    verdict: "ready" | "reshape" | "not-loadable" | "ir";
    /** Pending hand-off: the prepared file and the slot table read before Suite opened (to diff after) */
    pending?: { kind: "snaptone" | "ir"; fileName: string; path: string; proposedSlot: number | null; before: string[] | null; at: string };
    snaptoneSlot?: number;
    irSlot?: number;
    /** Slot name at link time, re-confirmed on each slot read */
    slotName?: string;
    linkedAt?: string;
  };
  savedAt: string;
}

export interface HandoffFolder {
  dir: string;
  files: { name: string; path: string; size: number; mtime: number }[];
}

export interface TonesApi {
  account(): Promise<AccountState>;
  markSplashSeen(): Promise<void>;
  /** Run a TONE3000 flow in the embedded view; resolves when it ends (redirect, cancel or error). */
  beginFlow(req: FlowRequest, bounds: ViewBounds): Promise<FlowResult>;
  setFlowBounds(bounds: ViewBounds): Promise<void>;
  cancelFlow(): Promise<void>;
  signOut(): Promise<void>;

  /** Bounded list (cached 10 minutes unless `refresh`). Pages are 20 tones; trending/latest have one page. */
  list(kind: ToneListKind, page: number, refresh?: boolean): Promise<TonePage>;
  tone(id: number): Promise<T3kTone>;
  /** All models of a tone, A1 + A2 + custom */
  models(toneId: number): Promise<T3kModel[]>;
  /** Cached image as a data: URL (null when it can't be fetched) */
  image(url: string): Promise<string | null>;

  /** Download a model to `tones/<toneId>/` (Bearer, streamed; progress via onEvent) and record it in meta.json. */
  downloadModel(toneId: number, modelId: number): Promise<{ path: string; bytes: number; record: ToneRecord }>;
  /** Send steps 1–3: download, check (+ reshape 0.7 → 0.5.x), save to the hand-off folder. */
  prepareForSuite(req: SendRequest): Promise<SendResult>;
  /** SnapTone send steps 1–2: download and check (+ reshape); returns the model for the in-app converter. */
  prepareSnapTone(req: SendRequest): Promise<SnapToneSource>;
  /** A dropped WAV IR: check it and copy it to the hand-off folder (no TONE3000 link). */
  prepareLocalIr(req: LocalIrRequest): Promise<{ path: string; fileName: string }>;
  /** Remember the slot table before Suite opens, for the link step. */
  setPending(toneId: number, pending: ToneRecord["gp5"]["pending"] | null): Promise<ToneRecord>;
  /** Link a tone to a pedal slot (null unlinks). Local metadata only; nothing is written to the pedal. */
  link(toneId: number, link: { kind: "snaptone" | "ir"; slot: number; slotName: string } | null): Promise<ToneRecord>;
  /** Every local tone record */
  local(): Promise<ToneRecord[]>;
  handoff(): Promise<HandoffFolder>;
  /** Launch Valeton Suite from the configured path; `suite` events report when it exits (where it can be watched). */
  openSuite(): Promise<{ watched: boolean }>;
  /** Native file picker for the Valeton Suite app; returns the chosen path (null if cancelled). */
  pickSuite(): Promise<string | null>;
  onEvent(cb: (event: TonesEvent) => void): () => void;
}
