// SnapTone (NS block capture) upload format of the Valeton GP-5. Pure, isomorphic ESM, zero dependencies.
//
// Valeton Suite 2.1.0 converts a NAM model into an 8840-byte "VTSI" clone blob (native HTKPA, see
// ../../gp5-reverse-engineering), cuts it down to a 2696-byte SnapTone file and sends that file in ONE command:
//   [0x11, 0x25, nId u32 = 0, fxId u32, name[16], node[16] = 0, fPara f32[8] = 0, file[2696]]  = 2770 B, 146 frames.
// Evidence (Suite 2.1.0 Dart, Android arm64 build): ToneCatchUtils.convertCatchFileType0Ver0 0x7b7350,
// ToneCatchFile.toBytes 0x7b6a44, ToneCatchCrcUtils.crc16 0x7b7a50, ImportTcHelper.importSCIndex 0x7ba504..0x7ba648
// (name), PresetUtils.getFixId 0x7ba9b4 (fxId), PresetModel.importTC 0x7b6020 (payload). Frame count matches a
// Suite capture on the GP-50 (total 0x92).
//
// File layout (little-endian): 0x00 "VTSI" | 0x04 u32 size | 0x08 u16 CRC-16/MODBUS over [0x0C, size) stored
// big-endian | 0x12 type, 0x13 version (both 0) | 0x14 u32 extend length | 0x18..0x77 f64/f32 filter data |
// 0x78 arr1 {offset, count} | 0x80 arr2 {offset, count} | 0x88 extend (float32 arrays).

import { CMD, KIND, u32le } from "./protocol.mjs";

export const SNAPTONE = Object.freeze({
  MAGIC: 0x49535456, // "VTSI" as u32 LE
  CLONE_SIZE: 0x2288, // 8840-byte blob from the clone algorithm
  EXTEND_OFFSET: 0x88,
  EXTEND_SIZE: 0xa00, // the GP-5 keeps 2560 bytes of float data
  FILE_SIZE: 0x88 + 0xa00, // 2696
  ARR2_MAX: 0x200, // second float array (impulse response) capped at 512 taps
  FXID_BASE: 0x0f000000, // NS block fxid of SnapTone slot 0; slot n = FXID_BASE + n
  FIRST_USER_SLOT: 50,
  LAST_USER_SLOT: 79,
  NAME_MAX: 10,
  NAME_FIELD: 16,
});

const NODE_FIELD = 16;
const FPARA_FIELD = 32;
/** Suite's Reg.dataFileNameReg, applied per character: printable ASCII except `$`. */
const NAME_CHAR = /^[a-zA-Z0-9~!@#%.&^*,?_+/\-'"();:<=>[\]\\`{}| ]$/;

const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF). crc16Modbus("123456789") === 0x4B37. */
export function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** The CRC as stored at offset 8 of a SnapTone file / clone blob (big-endian on disk). */
const storedCrc = (b) => (b[8] << 8) | b[9];
const writeCrc = (b, size) => {
  const crc = crc16Modbus(b.subarray(12, size));
  b[8] = crc >> 8;
  b[9] = crc & 0xff;
};

/** Validate a clone blob the way Suite's checkTcFile does. Returns null when it is usable, else the reason. */
export function checkCloneBlob(blob) {
  const b = toBytes(blob);
  if (b.length <= SNAPTONE.EXTEND_OFFSET + SNAPTONE.EXTEND_SIZE) return `clone data is too short (${b.length} bytes)`;
  if (readU32(b, 0) !== SNAPTONE.MAGIC) return "clone data does not start with VTSI";
  const size = readU32(b, 4);
  if (size > b.length || size < 12) return `clone size field ${size} does not fit ${b.length} bytes`;
  if (readU32(b, 0x14) <= SNAPTONE.EXTEND_SIZE) return "clone extend data is too short";
  if (b[0x12] !== 0 || b[0x13] !== 0) return "clone data is not type 0, version 0";
  if (crc16Modbus(b.subarray(12, size)) !== storedCrc(b)) return "clone CRC-16 mismatch";
  return null;
}

/** Validate a 2696-byte SnapTone file (the upload unit). Returns null when it is valid, else the reason. */
export function checkSnapToneFile(file) {
  const b = toBytes(file);
  if (b.length !== SNAPTONE.FILE_SIZE) return `a SnapTone file is ${SNAPTONE.FILE_SIZE} bytes, got ${b.length}`;
  if (readU32(b, 0) !== SNAPTONE.MAGIC) return "SnapTone file does not start with VTSI";
  if (readU32(b, 4) !== SNAPTONE.FILE_SIZE || readU32(b, 0x14) !== SNAPTONE.EXTEND_SIZE) return "SnapTone file header has the wrong sizes";
  if (b[0x12] !== 0 || b[0x13] !== 0) return "SnapTone file is not type 0, version 0";
  if (crc16Modbus(b.subarray(12)) !== storedCrc(b)) return "SnapTone file CRC-16 mismatch";
  return null;
}

/**
 * 8840-byte clone blob -> 2696-byte SnapTone file, as Suite's convertCatchFileType0Ver0 + toBytes:
 * keep the header and the first 2560 bytes of float data, patch size / extend length / arr2 count, redo the CRC.
 * f64 fields that are all 0xFF bytes become -1.0 (Suite's parser maps that bit pattern to -1).
 */
export function cloneToSnapToneFile(blob) {
  const b = toBytes(blob);
  const err = checkCloneBlob(b);
  if (err) throw new Error(`Not a SnapTone clone: ${err}`);
  const out = b.slice(0, SNAPTONE.FILE_SIZE);
  const dv = new DataView(out.buffer);
  for (let o = 0x18; o < 0x68; o += 8) if (out.subarray(o, o + 8).every((x) => x === 0xff)) dv.setFloat64(o, -1, true);
  dv.setUint32(4, SNAPTONE.FILE_SIZE, true);
  dv.setUint32(0x14, SNAPTONE.EXTEND_SIZE, true);
  dv.setUint32(0x84, Math.min(dv.getUint32(0x84, true), SNAPTONE.ARR2_MAX), true);
  writeCrc(out, SNAPTONE.FILE_SIZE);
  return out;
}

/** Suite's name rule: keep allowed ASCII characters, cut to 10, "X" when nothing printable is left. */
export function sanitizeSnapToneName(name) {
  const kept = Array.from(String(name ?? ""))
    .filter((c) => NAME_CHAR.test(c))
    .join("")
    .slice(0, SNAPTONE.NAME_MAX);
  return kept.trim() === "" ? "X" : kept;
}

export const isUserSnapToneSlot = (slot) => Number.isInteger(slot) && slot >= SNAPTONE.FIRST_USER_SLOT && slot <= SNAPTONE.LAST_USER_SLOT;

/** NS-block fxid of SnapTone slot `slot` (0..79). */
export function snapToneFxId(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > SNAPTONE.LAST_USER_SLOT) throw new RangeError(`SnapTone slot must be 0..79, got ${slot}`);
  return SNAPTONE.FXID_BASE + slot;
}

/** Command payload that imports `file` (2696-byte SnapTone file) into user slot `slot` (50..79) as `name`. */
export function encodeImportSnapTone(slot, name, file) {
  if (!isUserSnapToneSlot(slot)) throw new RangeError(`SnapTone uploads go to user slots ${SNAPTONE.FIRST_USER_SLOT}..${SNAPTONE.LAST_USER_SLOT}, got ${slot}`);
  const f = toBytes(file);
  const err = checkSnapToneFile(f);
  if (err) throw new Error(err);
  const label = sanitizeSnapToneName(name);
  const head = [KIND.SET, CMD.IMPORT_SNAPTONE, ...u32le(0), ...u32le(snapToneFxId(slot))];
  const out = new Uint8Array(head.length + SNAPTONE.NAME_FIELD + NODE_FIELD + FPARA_FIELD + f.length);
  out.set(head, 0);
  for (let i = 0; i < label.length; i++) out[head.length + i] = label.charCodeAt(i);
  out.set(f, head.length + SNAPTONE.NAME_FIELD + NODE_FIELD + FPARA_FIELD);
  return out;
}

/** Inverse of encodeImportSnapTone (mock pedal, tests): { slot, name, file } or null if it is not an import. */
export function decodeImportSnapTone(payload) {
  const p = toBytes(payload);
  const fileAt = 10 + SNAPTONE.NAME_FIELD + NODE_FIELD + FPARA_FIELD;
  if (p[0] !== KIND.SET || p[1] !== CMD.IMPORT_SNAPTONE || p.length !== fileAt + SNAPTONE.FILE_SIZE) return null;
  const slot = readU32(p, 6) - SNAPTONE.FXID_BASE;
  let name = "";
  for (let i = 10; i < 10 + SNAPTONE.NAME_FIELD && p[i]; i++) name += String.fromCharCode(p[i]);
  return { slot, name, file: p.slice(fileAt) };
}
