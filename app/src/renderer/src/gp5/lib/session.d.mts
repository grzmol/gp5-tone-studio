// Type declarations for session.mjs (the JS stays the tested source of truth; keep these in sync).
export interface Gp5Transport {
  name: string;
  send(bytes: Uint8Array | number[]): void;
  onMessage(cb: (bytes: Uint8Array) => void): void;
  close(): void | Promise<void>;
}

export interface Gp5Timing {
  interMessageMs: number;
  settleMs: number;
  editSettleMs: number;
  readTimeoutMs: number;
  ackTimeoutMs: number;
  postSelectMs: number;
  snapToneAckTimeoutMs: number;
  snapToneResends: number;
  readRetries: number;
}
export const DEFAULT_TIMING: Readonly<Gp5Timing>;

export type Gp5ErrorCode = "timeout" | "length" | "verify" | "unsafe" | "closed";
export class Gp5Error extends Error {
  constructor(code: Gp5ErrorCode, message: string);
  code: Gp5ErrorCode;
}

export interface PresetNameRecord {
  slot: number;
  id: number;
  name: string;
}
export interface SlotTableRecord {
  index: number;
  name: string;
  kind: "user" | "factory" | "empty";
  flag: number;
}
export type GlobalName = "inputTrim" | "masterVolume" | "cabSimBypass" | "recordLevel" | "monitorLevel" | "btLevel";
export type GlobalsRecord = { records: { a: number; b: number; len: number; value: number }[] } & Partial<Record<GlobalName, number>>;
export interface DecodedMessage {
  type: "ack" | "slot" | "param" | "block" | "model" | "presetChanged" | "reply" | "unknown";
  slot?: number;
  block?: number;
  index?: number;
  value?: number;
  enabled?: boolean;
  fxid?: number;
  raw: Uint8Array;
}
export interface BackupRecord {
  slot: number;
  name: string;
  prst: Uint8Array;
}
export interface WriteResult {
  frames: number;
  acked: number;
  attempts: number;
  verified: boolean;
}
export interface SnapToneUploadResult {
  frames: number;
  /** The name as stored on the pedal (Suite's name rule applied) */
  name: string;
  slot: number;
}
export interface UserIrUploadResult {
  frames: number;
  /** The name as stored on the pedal (Suite's name rule applied) */
  name: string;
  slot: number;
}
export interface SyncSnapshot {
  names: PresetNameRecord[];
  slot: number;
  prst: Uint8Array;
  globals: GlobalsRecord | null;
}

/** Events: "message" (unsolicited, `.message: DecodedMessage`), "midi" (short messages, `.data`), "badframe" (`.data`). */
export class Gp5Session extends EventTarget {
  constructor(transport: Gp5Transport, opts?: { timing?: Partial<Gp5Timing>; log?: (dir: string, bytes: Uint8Array, decoded?: unknown) => void });
  get transportName(): string;
  exclusive<T>(fn: () => Promise<T>, settleMs?: number): Promise<T>;
  read(sel: number, opts?: { timeoutMs?: number; retries?: number }): Promise<Uint8Array>;
  command(payload: number[], opts?: { timeoutMs?: number }): Promise<unknown>;
  sendShort(bytes: number[]): Promise<void>;
  close(): Promise<void>;

  readPresetNames(): Promise<PresetNameRecord[]>;
  readCurrentSlot(): Promise<number>;
  readCurrentBody(): Promise<Uint8Array>;
  readSnapTones(): Promise<SlotTableRecord[]>;
  readUserIRs(): Promise<SlotTableRecord[]>;
  readGlobals(): Promise<GlobalsRecord>;

  selectPreset(slot: number, opts?: { method?: "auto" | "cc" | "sysex" }): Promise<number>;
  readPreset(slot: number, opts?: { names?: { name: string }[] }): Promise<Uint8Array>;
  backupAll(opts?: { onProgress?: (done: number, total: number, entry: BackupRecord) => void; slots?: number[] }): Promise<BackupRecord[]>;

  setBlockEnabled(block: number | string, on: boolean): Promise<unknown>;
  setModel(block: number | string, fxid: number): Promise<unknown>;
  setParam(block: number | string, paramIndex: number, value: number): Promise<unknown>;
  setPatchVolume(vol: number): Promise<unknown>;
  setGlobal(name: GlobalName, value: number): Promise<unknown>;
  setTuner(on: boolean): Promise<void>;

  savePreset(slot: number, name: string, opts: { confirm: true }): Promise<unknown>;
  renamePreset(slot: number, name: string, opts: { confirm: true }): Promise<unknown>;
  writePreset(
    slot: number,
    prst: Uint8Array,
    opts: { confirm: true; verify?: boolean; onProgress?: (done: number, total: number) => void; attempts?: number },
  ): Promise<WriteResult>;
  /** Upload a 2696-byte SnapTone file into user SnapTone slot 50..79; verified via the 0x24 table. */
  uploadSnapTone(
    slot: number,
    name: string,
    file: Uint8Array,
    opts: { confirm: true; onProgress?: (done: number, total: number) => void },
  ): Promise<SnapToneUploadResult>;
  /** Upload a 2048-byte User IR data block into User IR slot 0..19; verified via the 0x20 table. */
  uploadUserIr(
    slot: number,
    name: string,
    data: Uint8Array,
    opts: { confirm: true; onProgress?: (done: number, total: number) => void },
  ): Promise<UserIrUploadResult>;
  syncState(): Promise<SyncSnapshot>;
}

export const BLOCKS: readonly ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"];
export function toHex(bytes: ArrayLike<number>, sep?: string): string;
