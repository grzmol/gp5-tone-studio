// Valeton GP-5 (and GP-50) .prst preset codec. Pure isomorphic ESM.
// Port of drewmerc302/valeton-gp50 app/static/prst.js (MIT, (c) 2026 Andrew Mercurio) restructured around a
// parsed preset object. Layout (GP-5, 507 bytes):
//   0x00 20-byte header "GP-5\0..\0\x01\0"   0x14 CRC-8/0x07 over [0x15:]   0x15 FF FF FF FF
//   0x19 16-byte name (latin1, NUL padded)   0x29 body = TLV chain [u16 tag][u16 len][payload]:
//     0x00FF (16)  constant prefix + devtag 0a 45 4d 51
//     0x0000 (16)  constant 01 10 04 00 0a 00 00 00 02 10 04 00 08 00 00 00
//     0x0001 (16)  settings: [01 20 04 00 u32 VOL][02 20 04 00 u32 BPM]
//     0x0002 (390) tone: [01 30 04 00 u32 enable mask][02 30 0a 00 order[10]][03 30 28 00 10 x u32 fxid][04 30 40 01 80 x f32]
//     0x0003 (8)   footswitch masks fs1 u32, fs2 u32
// The device body returned by read 0x41 is exactly prst[0x29:].

import { BLOCKS, crc8 } from "./protocol.mjs";

export const NAME_OFF = 0x19;
export const NAME_LEN = 16;
export const BODY_OFF = 0x29;
export const CRC_OFF = 0x14;
export const N_BLOCKS = 10;
export const PARAMS_PER_BLOCK = 8;

const hx = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
export const DEVICES = Object.freeze({
  gp5: Object.freeze({ key: "gp5", name: "GP-5", header: hx("47502d3500000000000000000000000000000100"), length: 507, devtag: hx("0a454d51") }),
  gp50: Object.freeze({ key: "gp50", name: "GP-50", header: hx("47502d3530000000000000000000000000000100"), length: 552, devtag: hx("47503530") }),
});
export const GP5_BODY_LEN = DEVICES.gp5.length - BODY_OFF; // 466

const REC = Object.freeze({ MASK: [0x01, 0x30, 0x04, 0x00], ORDER: [0x02, 0x30, 0x0a, 0x00], MODELS: [0x03, 0x30, 0x28, 0x00], PARAMS: [0x04, 0x30, 0x40, 0x01] });
/** fxids that exist only on the GP-50. */
export const GP50_ONLY_FXIDS = Object.freeze({ 0x01000001: "PRE AC Sim", 0x05000008: "PRE C-Wah", 0x0a00003c: "CAB AC" });
/** Blocks that may move in the chain; DST, NS, AMP, CAB, EQ form a fixed contiguous core in this order. */
export const MOVABLE_BLOCKS = Object.freeze([0, 1, 6, 7, 8]);
export const CORE_SEQUENCE = Object.freeze([2, 9, 3, 4, 5]);
export const DEFAULT_ORDER = Object.freeze([0, 1, 2, 9, 3, 4, 5, 6, 7, 8]);

const u8 = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function find(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const tlv = (tag, payload) => {
  const out = new Uint8Array(4 + payload.length);
  view(out).setUint16(0, tag, true);
  view(out).setUint16(2, payload.length, true);
  out.set(payload, 4);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Identify the device a .prst belongs to (header first, then length). */
export function detectDevice(prst) {
  const b = u8(prst);
  for (const d of Object.values(DEVICES)) if (d.header.every((v, i) => b[i] === v)) return d;
  for (const d of Object.values(DEVICES)) if (b.length === d.length) return d;
  throw new Error(`unrecognized .prst (length ${b.length})`);
}

export function computeCrc(prst) {
  return crc8(u8(prst).subarray(CRC_OFF + 1));
}
export function isCrcValid(prst) {
  return u8(prst)[CRC_OFF] === computeCrc(prst);
}
/** Recompute the file CRC in place; returns the buffer. */
export function refixCrc(prst) {
  prst[CRC_OFF] = computeCrc(prst);
  return prst;
}

/** Walk the body TLV chain -> [{ tag, offset (absolute, of payload), length }]. */
export function listRecords(prst) {
  const b = u8(prst);
  const d = view(b);
  const out = [];
  for (let off = BODY_OFF; off + 4 <= b.length; ) {
    const tag = d.getUint16(off, true);
    const length = d.getUint16(off + 2, true);
    if (off + 4 + length > b.length) throw new Error(`TLV 0x${tag.toString(16)} at 0x${off.toString(16)} overruns the file`);
    out.push({ tag, offset: off + 4, length });
    off += 4 + length;
  }
  return out;
}

function toneOffsets(b) {
  const at = (rec) => {
    const i = find(b, rec, BODY_OFF);
    if (i < 0) throw new Error(`tone record ${rec.map((x) => x.toString(16)).join(" ")} not found`);
    return i + 4;
  };
  return { mask: at(REC.MASK), order: at(REC.ORDER), models: at(REC.MODELS), params: at(REC.PARAMS) };
}

/** Name helpers (16 bytes in the file; the device's rename/save commands carry only 10). */
export function readName(prst) {
  const b = u8(prst);
  let s = "";
  for (let i = NAME_OFF; i < NAME_OFF + NAME_LEN && b[i]; i++) s += String.fromCharCode(b[i]);
  return s.trim();
}
function writeName(b, name) {
  const s = String(name);
  for (let i = 0; i < NAME_LEN; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 0;
    if (i < s.length && (c < 0x20 || c > 0x7e)) throw new RangeError(`name must be printable ASCII: ${JSON.stringify(s)}`);
    b[NAME_OFF + i] = c;
  }
}

/**
 * Parse a .prst into a plain object.
 * blocks[k] = { name, enabled, fxid, params: number[8] } in storage order NR..NS.
 */
export function parsePrst(prst) {
  const b = u8(prst);
  const device = detectDevice(b);
  if (b.length !== device.length) throw new Error(`${device.name} .prst must be ${device.length} bytes, got ${b.length}`);
  const d = view(b);
  const off = toneOffsets(b);
  const mask = d.getUint32(off.mask, true);
  const order = Array.from(b.subarray(off.order, off.order + N_BLOCKS));
  const blocks = BLOCKS.map((name, k) => ({
    name,
    enabled: !!(mask & (1 << k)),
    fxid: d.getUint32(off.models + k * 4, true),
    params: Array.from({ length: PARAMS_PER_BLOCK }, (_, i) => d.getFloat32(off.params + (k * PARAMS_PER_BLOCK + i) * 4, true)),
  }));
  const settings = { volume: 50, bpm: 120 };
  const fs = { fs1: [], fs2: [] };
  for (const r of listRecords(b)) {
    if (r.tag === 0x0001) {
      for (let i = r.offset; i + 4 <= r.offset + r.length; ) {
        const id = b[i];
        const len = d.getUint16(i + 2, true);
        const v = len === 4 ? d.getInt32(i + 4, true) : len === 2 ? d.getUint16(i + 4, true) : b[i + 4];
        if (id === 1) settings.volume = v;
        else if (id === 2) settings.bpm = v;
        i += 4 + len;
      }
    } else if (r.tag === 0x0003) {
      const bits = (m) => BLOCKS.flatMap((_, k) => (m & (1 << k) ? [k] : []));
      fs.fs1 = bits(d.getUint32(r.offset, true));
      fs.fs2 = bits(d.getUint32(r.offset + 4, true));
    }
  }
  return { device: device.key, name: readName(b), crcValid: isCrcValid(b), mask, order, blocks, settings, footswitches: fs };
}

/** Validate a chain order: permutation of 0..9 with the fixed core DST,NS,AMP,CAB,EQ contiguous. */
export function validateOrder(order) {
  if (!Array.isArray(order) || order.length !== N_BLOCKS || new Set(order).size !== N_BLOCKS || order.some((v) => !Number.isInteger(v) || v < 0 || v > 9))
    return "order must be a permutation of 0..9";
  const start = order.indexOf(CORE_SEQUENCE[0]);
  if (CORE_SEQUENCE.some((blk, i) => order[start + i] !== blk)) return "DST, NS, AMP, CAB, EQ must stay contiguous in that order";
  return null;
}

/**
 * Return a NEW .prst with edits applied and CRC fixed. edits:
 *  { name, volume (0..100), bpm (40..300), order: number[10], footswitches: { fs1: number[], fs2: number[] },
 *    blocks: { [blockIndexOrName]: { enabled?, fxid?, params?: { [algId]: value } } } }
 */
export function applyEdits(prst, edits = {}) {
  const b = Uint8Array.from(u8(prst));
  const d = view(b);
  const off = toneOffsets(b);
  for (const [key, e] of Object.entries(edits.blocks ?? {})) {
    const k = /^\d+$/.test(key) ? Number(key) : BLOCKS.indexOf(key.toUpperCase());
    if (k < 0 || k > 9) throw new RangeError(`unknown block ${key}`);
    if (e.fxid !== undefined) d.setUint32(off.models + k * 4, e.fxid >>> 0, true);
    if (e.enabled !== undefined) {
      const m = d.getUint32(off.mask, true);
      d.setUint32(off.mask, (e.enabled ? m | (1 << k) : m & ~(1 << k)) >>> 0, true);
    }
    for (const [alg, value] of Object.entries(e.params ?? {})) {
      const i = Number(alg);
      if (!Number.isInteger(i) || i < 0 || i >= PARAMS_PER_BLOCK) throw new RangeError(`param index ${alg} out of range`);
      d.setFloat32(off.params + (k * PARAMS_PER_BLOCK + i) * 4, Number(value), true);
    }
  }
  if (edits.order) {
    const err = validateOrder(edits.order);
    if (err) throw new RangeError(err);
    b.set(edits.order, off.order);
  }
  const recs = listRecords(b);
  if (edits.volume !== undefined || edits.bpm !== undefined) {
    const r = recs.find((x) => x.tag === 0x0001);
    for (let i = r.offset; i + 4 <= r.offset + r.length; ) {
      const id = b[i];
      const len = d.getUint16(i + 2, true);
      const put = (v) => (len === 4 ? d.setInt32(i + 4, v, true) : (b[i + 4] = v & 0xff));
      if (id === 1 && edits.volume !== undefined) put(Math.max(0, Math.min(100, Math.trunc(edits.volume))));
      if (id === 2 && edits.bpm !== undefined && len === 4) put(Math.max(40, Math.min(300, Math.trunc(edits.bpm))));
      i += 4 + len;
    }
  }
  if (edits.footswitches) {
    const r = recs.find((x) => x.tag === 0x0003);
    for (const [key, o] of [["fs1", 0], ["fs2", 4]]) {
      const list = edits.footswitches[key];
      if (list) d.setUint32(r.offset + o, list.reduce((m, k) => m | (1 << k), 0) >>> 0, true);
    }
  }
  if (edits.name !== undefined) writeName(b, edits.name);
  return refixCrc(b);
}

/** Rebuild a full .prst from a device read: name (from 0x40) + body (from 0x41). */
export function rebuildPrst(name, body, deviceKey = "gp5") {
  const dev = DEVICES[deviceKey];
  const bb = u8(body);
  if (bb.length !== dev.length - BODY_OFF) throw new Error(`expected a ${dev.length - BODY_OFF}-byte ${dev.name} body, got ${bb.length}`);
  const out = concat(dev.header, [0], [0xff, 0xff, 0xff, 0xff], new Uint8Array(NAME_LEN), bb);
  writeName(out, name);
  return refixCrc(out);
}

/** Body part of a .prst (what the device returns for read 0x41). */
export const bodyOf = (prst) => u8(prst).slice(BODY_OFF);

/**
 * Convert GP-50 .prst -> GP-5 (or back). The 390-byte tone block is shared, so this is a re-wrap.
 * GP-50-only models block conversion unless { force: true } (their model records get zeroed).
 */
export function convertPrst(prst, targetKey, { force = false } = {}) {
  const b = u8(prst);
  const source = detectDevice(b);
  const target = DEVICES[targetKey];
  if (!target) throw new RangeError(`unknown device ${targetKey}`);
  if (source.key === target.key) return b.slice();
  const d = view(b);
  const recs = listRecords(b);
  const get = (tag) => recs.find((r) => r.tag === tag);
  const toneRec = get(0x0002);
  if (!toneRec || toneRec.length !== 390) throw new Error("unexpected tone block");
  const tone = b.slice(toneRec.offset, toneRec.offset + 390);
  const models = find(tone, REC.MODELS) + 4;
  const tv = view(tone);
  const problems = [];
  for (let k = 0; k < N_BLOCKS; k++) {
    const fx = tv.getUint32(models + k * 4, true);
    if (target.key === "gp5" && GP50_ONLY_FXIDS[fx]) problems.push(`${BLOCKS[k]} (${GP50_ONLY_FXIDS[fx]})`);
  }
  if (problems.length && !force) throw new Error(`no GP-5 equivalent for ${problems.join(", ")}; pass { force: true } to drop them`);
  if (force) for (let k = 0; k < N_BLOCKS; k++) if (GP50_ONLY_FXIDS[tv.getUint32(models + k * 4, true)]) tv.setUint32(models + k * 4, 0, true);
  const { settings, footswitches } = parsePrst(b);
  const mask = (list) => list.reduce((m, k) => m | (1 << k), 0) >>> 0;
  const w = (n, v) => {
    const o = new Uint8Array(n);
    const ov = view(o);
    if (n === 4) ov.setUint32(0, v >>> 0, true);
    else o[0] = v;
    return o;
  };
  const settingsPayload =
    target.key === "gp5"
      ? concat([1, 0x20, 4, 0], w(4, settings.volume), [2, 0x20, 4, 0], w(4, settings.bpm))
      : concat(
          [1, 0x20, 1, 0, settings.volume & 0xff],
          [2, 0x20, 4, 0],
          w(4, settings.bpm),
          ...[[3, 1, 0], [4, 4, 0], [5, 4, 100], [6, 1, 0], [7, 1, 0], [8, 1, 100], [9, 1, 0], [10, 1, 0]].map(([id, n, v]) => concat([id, 0x20, n, 0], w(n, v)))
        );
  const fsPayload = concat(w(4, mask(footswitches.fs1)), w(4, mask(footswitches.fs2)), target.key === "gp50" ? [5, 5] : []);
  const body = concat(
    tlv(0x00ff, concat(hx("010004000100000002000400"), target.devtag)),
    tlv(0x0000, hx("011004000a0000000210040008000000")),
    tlv(0x0001, settingsPayload),
    tlv(0x0002, tone),
    tlv(0x0003, fsPayload)
  );
  void d;
  return rebuildPrst(readName(b), body, target.key);
}
