// Contract between the device layer (src/renderer/src/state/device.ts) and every screen.
// Screens read state with `useDevice(selector)` and call actions on `useDevice.getState()`.
// Block indices follow the GP-5 storage order: 0 NR, 1 PRE, 2 DST, 3 AMP, 4 CAB, 5 EQ, 6 MOD, 7 DLY, 8 RVB, 9 NS.
import type { DeviceHostStatus } from "@shared/host/device";

export type BlockCode = "NR" | "PRE" | "DST" | "AMP" | "CAB" | "EQ" | "MOD" | "DLY" | "RVB" | "NS";
export const BLOCK_CODES: readonly BlockCode[] = ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"];

export interface ParamInfo {
  name: string;
  /** algId: position in the block's 8 params */
  index: number;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Optional unit/enum info from the catalog */
  unit?: string;
  options?: string[];
}

export interface ModelInfo {
  fxid: number;
  block: BlockCode;
  /** Short device name, e.g. "Plustortion" */
  name: string;
  /** Display title, e.g. "Plustortion" or "Tone Catch 36" */
  title: string;
  /** Category, e.g. "Distortion", "Overdrive", "Hi Gain" */
  type: string;
  /** Real-world gear it models, when known */
  origin?: string;
  params: ParamInfo[];
}

export interface BlockState {
  index: number;
  code: BlockCode;
  enabled: boolean;
  fxid: number;
  /** undefined when the fxid is not in the catalog */
  model?: ModelInfo;
  /** 8 raw param values (algId order) */
  params: number[];
}

export interface PresetState {
  slot: number;
  name: string;
  blocks: BlockState[];
  /** Signal order: permutation of block indices; DST, NS, AMP, CAB, EQ stay contiguous */
  order: number[];
  volume: number;
  bpm: number;
  footswitches: { fs1: number[]; fs2: number[] };
  /** Full .prst bytes of the current (possibly edited) state */
  prst: Uint8Array;
}

export interface SlotName {
  slot: number;
  name: string;
  /** SnapTone / user IR tables only: what the pedal reports for the slot */
  kind?: "user" | "factory" | "empty";
}

/** One record of the 0x10 globals reply ([a, b] address, byte length, decoded value). */
export interface GlobalRecord {
  a: number;
  b: number;
  len: number;
  value: number;
}

/** Last failed request on a live session (shown inline on the Device screen and in the report). */
export interface RequestError {
  code: string;
  message: string;
  at: number;
}

/** One MIDI monitor line (Device screen). */
export interface MidiLogEntry {
  id: number;
  /** Wall-clock ms */
  at: number;
  dir: "out" | "in" | "bad" | "warn";
  /** Decoded description, e.g. "Select preset 63", "Acknowledged" */
  text: string;
  /** Short raw info: CC bytes in full, SysEx length */
  raw: string;
  ack: boolean;
}

/** Global settings the GP-5 reports (protocol.mjs GLOBALS); absent keys were not in the reply. */
export type GlobalName = "inputTrim" | "masterVolume" | "cabSimBypass" | "recordLevel" | "monitorLevel" | "btLevel";
export type Globals = Partial<Record<GlobalName, number>>;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";
export type DeviceMode = "webmidi" | "mock";

export type ConnectionErrorCode =
  | "unsupported" // no WebMIDI
  | "insecure" // not a secure context
  | "permission" // MIDI/SysEx permission denied
  | "no-sysex"
  | "broken-browser" // Chromium 152 SysEx bug
  | "not-found" // no GP-5 port
  | "busy" // port present but silent / held by Valeton Suite
  | "timeout"
  | "bootloader" // firmware update mode
  | "unknown";

export interface ConnectionError {
  code: ConnectionErrorCode;
  message: string;
  /** Visible MIDI port names, for diagnostics */
  ports?: string[];
}

export interface WriteOptions {
  /** Called with 0..1 while frames are sent and verified */
  onProgress?: (fraction: number) => void;
}

export interface BackupEntry {
  slot: number;
  name: string;
  prst: Uint8Array;
}

export interface RestoreOptions {
  /** Called after each slot is written and verified (done = slots finished so far) */
  onProgress?: (done: number, total: number, slot: number) => void;
  /** Stops before the next slot when aborted */
  signal?: AbortSignal;
}

/** A restore stopped: `done` slots were written and verified, `failed` was not, `notStarted` were never touched. */
export class RestoreError extends Error {
  constructor(
    message: string,
    public done: number[],
    public failed: number | null,
    public notStarted: number[],
    public cause?: unknown,
  ) {
    super(message);
    this.name = "RestoreError";
  }
}

export interface DeviceState {
  mode: DeviceMode;
  status: ConnectionStatus;
  error: ConnectionError | null;
  portName: string | null;
  /** 100 slot names (cached; shown before the device answers) */
  names: SlotName[];
  /** Active slot on the pedal */
  slot: number | null;
  /** Live state of the active preset (edits apply here and on the pedal immediately) */
  preset: PresetState | null;
  /** The preset as last read/saved, for "Compare with saved" and the unsaved-changes count */
  saved: PresetState | null;
  /** Number of differing params/blocks between preset and saved */
  unsavedChanges: number;
  globals: Globals | null;
  /** SnapTone slot names (user + factory), when read */
  snapTones: SlotName[] | null;
  /** User IR slot names (1-based display), when read */
  userIRs: SlotName[] | null;
  /** A long job (backup/write) is running; screens disable conflicting actions */
  busy: null | { kind: "backup" | "write" | "restore" | "sync"; progress: number; label: string };

  // diagnostics (Device screen)
  /** Why the last session ended: the user disconnected, or the port went away */
  disconnectReason: "user" | "lost" | null;
  /** When the current session connected (ms) */
  connectedAt: number | null;
  /** When a session last connected (persisted across launches) */
  lastConnectedAt: number | null;
  /** All records of the last 0x10 globals reply, including the ones the toolkit can't name */
  globalRecords: GlobalRecord[] | null;
  /** Last failed request on a live session; cleared by a successful sync */
  lastError: RequestError | null;
  /** OS-side checks from the host (USB, driver, Suite), refreshed on every connect attempt */
  hostStatus: DeviceHostStatus | null;
  /** Live MIDI monitor on/off (not remembered between launches) */
  monitor: boolean;
  /** Changes whenever the monitor log changes; read the lines with `getMidiLog()` */
  midiLogVersion: number;
  setMonitor(on: boolean): void;
  clearMidiLog(): void;
  /** Run the host checks again (Check again) */
  checkHost(): Promise<DeviceHostStatus | null>;
  /** Stop a connection attempt in progress */
  cancelConnect(): Promise<void>;
  clearLastError(): void;

  // connection
  connect(mode?: DeviceMode): Promise<void>;
  disconnect(): Promise<void>;
  /** Re-read names, slot and the active preset */
  sync(): Promise<void>;

  // live edits (play on the pedal immediately; coalesced per block/param)
  selectSlot(slot: number): Promise<void>;
  setParam(block: number, paramIndex: number, value: number): void;
  setBlockEnabled(block: number, on: boolean): void;
  /** Changes the model; the pedal loads the model's defaults, the store re-reads the body */
  setModel(block: number, fxid: number): Promise<void>;
  setOrder(order: number[]): void;
  setVolume(volume: number): void;
  setFootswitches(fs: { fs1: number[]; fs2: number[] }): void;
  /** Revert live state to `saved` (sends the saved preset back to the pedal) */
  discard(): Promise<void>;

  // memory writes (callers MUST confirm with the user first)
  saveToSlot(slot: number, name?: string): Promise<void>;
  rename(slot: number, name: string): Promise<void>;
  writePreset(slot: number, prst: Uint8Array, opts?: WriteOptions): Promise<void>;
  readPreset(slot: number): Promise<Uint8Array>;
  backupAll(opts?: WriteOptions): Promise<BackupEntry[]>;
  setGlobal(name: GlobalName, value: number): void;
  readSnapTones(): Promise<SlotName[]>;
  readUserIRs(): Promise<SlotName[]>;
  /**
   * Write several presets (a backup) slot by slot, each acknowledged and verified by read-back (3 attempts).
   * Callers MUST confirm with the user first. Throws RestoreError naming done / failed / not started slots.
   */
  restoreAll(entries: BackupEntry[], opts?: RestoreOptions): Promise<void>;
}
