export const USER_IR: Readonly<{ SLOTS: 20; SAMPLES: 512; DATA_BYTES: 2048; RATE: 44100; FXID_BASE: number }>;
export function isUserIrSlot(slot: number): boolean;
/** CAB-block fxid of User IR slot 0..19 (throws RangeError otherwise). */
export function userIrFxId(slot: number): number;
/** 24-bit samples at 44.1 kHz -> 2048-byte data block (first 512 samples as int32 LE, zero-padded). */
export function encodeUserIrData(samples24: Int32Array | number[]): Uint8Array;
export function encodeImportUserIr(slot: number, name: string, data: Uint8Array): Uint8Array;
export function decodeImportUserIr(payload: Uint8Array | number[]): { slot: number; name: string; data: Uint8Array } | null;
