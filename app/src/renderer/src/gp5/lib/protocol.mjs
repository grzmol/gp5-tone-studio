// Valeton GP-5 USB-MIDI SysEx protocol codec. Pure, isomorphic ESM (browser + Node >= 18), zero dependencies.
//
// Wire format (identical host->device and device->host):
//   BUF  = [crc, total, index, len, ...payload]        payload <= 19 bytes per frame on USB
//   crc  = CRC-8 (poly 0x07, init 0x00, no reflection, no xorout) over BUF[1..]
//   wire = F0, (b >> 4, b & 0x0F) for every b in BUF, F7  -- every byte split into two nibbles, high first.
//   total = number of frames in the transfer (ceil(len(payload)/19)), index = 0..total-1.
// Payload: [kind, fn, ...args]. kind 0x12 = read/query (and read replies), 0x11 = set/command, 0x14 = device ACK.
// All integers little-endian u32, parameter values float32 LE.
//
// Sources (see skill gp5-sysex-protocol for per-fact evidence): drewmerc302/valeton-gp50 (MIT),
// fsanchezlme97-ui/gp5-editor (MIT), helvecioneto/gp5-wc (Apache-2.0), Builty/TonexOneController (Apache-2.0).

export const USB_IDS = Object.freeze({ vendorId: 0x84ef, gp5: 0x0184, gp50: 0x018a, midiInterface: 3 });

/** Storage/block order used everywhere: bypass bit k, model record k, params k*8.., live-edit block index k. */
export const BLOCKS = Object.freeze(["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"]);
export const BLOCK = Object.freeze(Object.fromEntries(BLOCKS.map((b, i) => [b, i])));

export const PRESET_COUNT = 100;
export const FRAME_PAYLOAD_MAX = 19;
export const KIND = Object.freeze({ SET: 0x11, GET: 0x12, ACK: 0x14 });

/** Read selectors: request payload [0x12, sel]; reply payload starts with the same two bytes. */
export const READ = Object.freeze({
  GLOBALS: 0x10,
  USER_IRS: 0x20,
  SNAPTONES: 0x24,
  PRESET_NAMES: 0x40,
  CURRENT_PATCH: 0x41,
  CURRENT_SLOT: 0x43,
});

/** Command function codes (payload [0x11, fn, ...]). */
export const CMD = Object.freeze({
  SET_GLOBAL: 0x11,
  SET_PATCH_SETTING: 0x42,
  SELECT_PRESET: 0x43,
  SET_MODEL: 0x47,
  SET_PARAM: 0x48,
  SET_BLOCK: 0x49,
  SAVE_PRESET: 0x4a,
  RENAME_PRESET: 0x4c,
  WRITE_PRESET: 0x4f,
});

/**
 * Named global settings, addressed by record id [a, b] (CMD.SET_GLOBAL and the 0x10 reply records).
 * Addresses/ranges from TonexOneController; record layout of the 0x10 reply verified on a real GP-5.
 */
export const GLOBALS = Object.freeze({
  inputTrim: { addr: [1, 3], min: -20, max: 20 },
  masterVolume: { addr: [2, 2], min: 0, max: 100 },
  cabSimBypass: { addr: [3, 3], min: 0, max: 1 },
  recordLevel: { addr: [1, 4], min: -20, max: 20 },
  monitorLevel: { addr: [2, 4], min: -20, max: 20 },
  btLevel: { addr: [5, 4], min: -20, max: 20 },
});

/** Standard MIDI CC map of the GP-5 (channel 1). Block switches: 0-63 off, 64-127 on. */
export const CC = Object.freeze({
  PRESET_SELECT: 0,
  PATCH_VOLUME: 7,
  BANK_DOWN: 22,
  BANK_UP: 23,
  PATCH_DOWN: 24,
  PATCH_UP: 25,
  SONG_PATCH_DOWN: 29,
  SONG_PATCH_UP: 30,
  TUNER: 58,
  CTL: 69,
  BLOCK_SWITCH: Object.freeze({ NR: 48, PRE: 49, DST: 50, NS: 51, AMP: 52, CAB: 53, EQ: 54, MOD: 55, DLY: 56, RVB: 57 }),
});

// ---------------------------------------------------------------------------------------------------------------
// byte helpers

const toBytes = (b) => (b instanceof Uint8Array ? b : Uint8Array.from(b));
export const u32le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
export const f32le = (v) => {
  const d = new DataView(new ArrayBuffer(4));
  d.setFloat32(0, v, true);
  return [d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)];
};
const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const readF32 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
const readI8 = (v) => (v & 0x80 ? v - 0x100 : v);
const latin1 = (b) => {
  let s = "";
  for (const c of b) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};
function asciiField(name, len) {
  const out = new Array(len).fill(0);
  const s = String(name);
  for (let i = 0; i < Math.min(len, s.length); i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) throw new RangeError(`preset name must be printable ASCII, got ${JSON.stringify(s)}`);
    out[i] = c;
  }
  return out;
}
export const toHex = (b, sep = " ") => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(sep);
export const fromHex = (s) => Uint8Array.from(s.replace(/[^0-9a-f]/gi, "").match(/../g) ?? [], (h) => parseInt(h, 16));

function assertSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PRESET_COUNT) throw new RangeError(`preset slot must be 0..99, got ${slot}`);
}
function blockIndex(block) {
  const k = typeof block === "string" ? BLOCK[block.toUpperCase()] : block;
  if (!Number.isInteger(k) || k < 0 || k > 9) throw new RangeError(`unknown block ${block}`);
  return k;
}

// ---------------------------------------------------------------------------------------------------------------
// framing

/** CRC-8/SMBUS (poly 0x07, init 0). crc8("123456789") === 0xF4. */
export function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

/** Build one frame (BUF with CRC filled in). */
export function buildFrame(total, index, payload) {
  if (payload.length > 0xff) throw new RangeError("frame payload too long");
  const buf = [0, total & 0xff, index & 0xff, payload.length, ...payload];
  buf[0] = crc8(buf.slice(1));
  return Uint8Array.from(buf);
}

/** BUF -> SysEx wire bytes (F0, nibbles, F7). */
export function frameToSysex(buf) {
  const out = new Uint8Array(buf.length * 2 + 2);
  out[0] = 0xf0;
  for (let i = 0; i < buf.length; i++) {
    out[1 + i * 2] = buf[i] >> 4;
    out[2 + i * 2] = buf[i] & 0x0f;
  }
  out[out.length - 1] = 0xf7;
  return out;
}

/** Split a logical payload into SysEx messages ready to send (19-byte frames, total = frame count). */
export function packetize(payload, chunk = FRAME_PAYLOAD_MAX) {
  const p = toBytes(payload);
  const total = Math.max(1, Math.ceil(p.length / chunk));
  if (total > 0xff) throw new RangeError("payload needs more than 255 frames");
  const out = [];
  for (let i = 0; i < total; i++) out.push(frameToSysex(buildFrame(total, i, p.subarray(i * chunk, (i + 1) * chunk))));
  return out;
}

/**
 * Decode one SysEx message (with or without F0/F7) into a frame.
 * Returns null when it is not a Valeton nibble frame (odd nibble count, nibble > 0x0F, too short).
 */
export function parseSysex(msg) {
  const m = toBytes(msg);
  let a = 0;
  let z = m.length;
  if (m[0] === 0xf0) a = 1;
  if (m[z - 1] === 0xf7) z -= 1;
  const n = z - a;
  if (n < 8 || n % 2) return null;
  const buf = new Uint8Array(n / 2);
  for (let i = 0; i < buf.length; i++) {
    const hi = m[a + 2 * i];
    const lo = m[a + 2 * i + 1];
    if (hi > 0x0f || lo > 0x0f) return null;
    buf[i] = (hi << 4) | lo;
  }
  const [crc, total, index, len] = buf;
  const payload = buf.subarray(4);
  return { crc, crcOk: crc === crc8(buf.subarray(1)), total, index, len, lenOk: len === payload.length, payload };
}

/**
 * Reassembles multi-frame transfers. Frames are grouped by `total`, ordered by `index`.
 * push() returns the complete payload (Uint8Array) when the last missing frame arrives, else null.
 */
export class Reassembler {
  #pending = new Map();
  push(frame) {
    if (frame.total <= 1) return frame.payload.slice();
    let t = this.#pending.get(frame.total);
    if (!t || (frame.index === 0 && t.parts[0])) {
      t = { parts: new Array(frame.total), have: 0 };
      this.#pending.set(frame.total, t);
    }
    if (frame.index >= frame.total) return null;
    if (!t.parts[frame.index]) t.have++;
    t.parts[frame.index] = frame.payload.slice();
    if (t.have < frame.total) return null;
    this.#pending.delete(frame.total);
    const len = t.parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of t.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  reset() {
    this.#pending.clear();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// request / command payloads (logical, unframed). Send with packetize(payload).

export const encode = Object.freeze({
  /** Read request. sel = READ.* */
  read: (sel) => [KIND.GET, sel],
  /** Select preset via SysEx (gp5-editor: works on GP-5; TonexOneController saw occasional lockups -> prefer CC#0). */
  selectPreset: (slot) => (assertSlot(slot), [KIND.SET, CMD.SELECT_PRESET, ...u32le(slot)]),
  /** Swap the model in a block. fxid = u32 from the effects catalog (category << 24 | model). */
  setModel: (block, fxid) => {
    const k = blockIndex(block);
    return [KIND.SET, CMD.SET_MODEL, ...u32le(k), ...u32le(k), ...u32le(fxid >>> 0)];
  },
  /** Set one parameter. paramIndex = catalog algId (0..7; NS uses 0..4). value in display units. */
  setParam: (block, paramIndex, value) => {
    if (!Number.isInteger(paramIndex) || paramIndex < 0 || paramIndex > 15) throw new RangeError(`bad param index ${paramIndex}`);
    return [KIND.SET, CMD.SET_PARAM, ...u32le(blockIndex(block)), ...u32le(paramIndex), ...f32le(Number(value))];
  },
  /** Block on/off. */
  setBlockEnabled: (block, on) => [KIND.SET, CMD.SET_BLOCK, ...u32le(blockIndex(block)), ...u32le(on ? 1 : 0)],
  /** Current patch volume 0..100 (patch setting record id 1). */
  setPatchVolume: (vol) => {
    const v = Math.max(0, Math.min(100, Math.round(vol)));
    return [KIND.SET, CMD.SET_PATCH_SETTING, 0x01, 0x20, 0x00, 0x00, v, 0x00, 0x00, 0x00];
  },
  /** Global setting (name from GLOBALS). Value is sent as a signed byte, exactly like TonexOneController. */
  setGlobal: (name, value) => {
    const g = GLOBALS[name];
    if (!g) throw new RangeError(`unknown global ${name}; known: ${Object.keys(GLOBALS).join(", ")}`);
    const v = Math.max(g.min, Math.min(g.max, Math.round(value)));
    return [KIND.SET, CMD.SET_GLOBAL, g.addr[0], g.addr[1], 0x00, 0x00, v & 0xff, 0x00, 0x00, 0x00];
  },
  /** Store the current (edited) buffer into `slot` under `name` (max 10 chars). Overwrites the slot. */
  savePreset: (slot, name) => (assertSlot(slot), [KIND.SET, CMD.SAVE_PRESET, ...u32le(slot), ...asciiField(name, 10)]),
  /** Rename a slot (10-char field). Seen in a Valeton Suite capture only. */
  renamePreset: (slot, name) => (assertSlot(slot), [KIND.SET, CMD.RENAME_PRESET, ...u32le(slot), ...asciiField(name, 10)]),
  /** Full preset write: payload for a 507-byte GP-5 .prst (bytes 0x19.. = name + body). 488 bytes -> 26 frames. */
  writePreset: (slot, prst) => {
    assertSlot(slot);
    const p = toBytes(prst);
    if (p.length !== 507) throw new RangeError(`GP-5 .prst must be 507 bytes, got ${p.length}`);
    return [KIND.SET, CMD.WRITE_PRESET, slot, 0x00, 0x00, 0x00, ...p.subarray(0x19)];
  },
});

/** Standard MIDI short messages (channel 0 = MIDI channel 1). */
export const midi = Object.freeze({
  cc: (num, value, channel = 0) => [0xb0 | (channel & 0x0f), num & 0x7f, Math.max(0, Math.min(127, Math.round(value)))],
  selectPreset: (slot, channel = 0) => (assertSlot(slot), midi.cc(CC.PRESET_SELECT, slot, channel)),
  patchVolume: (vol, channel = 0) => midi.cc(CC.PATCH_VOLUME, Math.max(0, Math.min(100, vol)), channel),
  blockSwitch: (block, on, channel = 0) => {
    const name = BLOCKS[blockIndex(block)];
    return midi.cc(CC.BLOCK_SWITCH[name], on ? 127 : 0, channel);
  },
  tuner: (on, channel = 0) => midi.cc(CC.TUNER, on ? 127 : 0, channel),
  ctl: (value, channel = 0) => midi.cc(CC.CTL, value, channel),
  programChange: (program, channel = 0) => [0xc0 | (channel & 0x0f), program & 0x7f],
});

// ---------------------------------------------------------------------------------------------------------------
// reply decoders. `data` = reassembled payload INCLUDING the 2-byte [0x12, sel] echo.

function expectReply(data, sel) {
  if (data[0] !== KIND.GET || data[1] !== sel) throw new Error(`expected reply 12 ${sel.toString(16)}, got ${toHex(data.subarray(0, 2))}`);
}

/** 0x40 -> 100 x { slot, id, name }. slot = record position (ids drift after on-pedal reordering). */
export function decodePresetNames(data) {
  expectReply(data, READ.PRESET_NAMES);
  const out = [];
  for (let off = 2, slot = 0; off + 20 <= data.length; off += 20, slot++) {
    out.push({ slot, id: readU32(data, off), name: latin1(data.subarray(off + 4, off + 20)).trim() });
  }
  return out;
}

/** 0x43 -> current preset slot (0..99). Same layout for the unsolicited "slot changed" notification. */
export function decodeCurrentSlot(data) {
  expectReply(data, READ.CURRENT_SLOT);
  return data[2] | ((data[3] ?? 0) << 8);
}

/** 0x41 -> body bytes (== .prst[0x29:], 466 bytes on GP-5). */
export function decodeCurrentPatch(data) {
  expectReply(data, READ.CURRENT_PATCH);
  return data.slice(2);
}

/**
 * 0x24 (80 SnapTone/amp-capture slots: 0..49 factory, 50..79 user) / 0x20 (20 user IR slots)
 * -> [{ index, name, kind: "user" | "factory" | "empty", flag }].
 * flag byte (verified on hardware): 0 = user-loaded content, 1 = factory or empty ("Empty" / "User IR n").
 */
export function decodeSlotTable(data) {
  const sel = data[1];
  const count = sel === READ.SNAPTONES ? 80 : sel === READ.USER_IRS ? 20 : 0;
  if (data[0] !== KIND.GET || !count) throw new Error(`not a 0x24/0x20 reply: ${toHex(data.subarray(0, 2))}`);
  const names = 2 + count;
  const out = [];
  for (let i = 0; i < count && names + i * 16 + 16 <= data.length; i++) {
    const flag = data[2 + i];
    const name = latin1(data.subarray(names + i * 16, names + i * 16 + 16)).trim();
    const kind = flag === 0 ? "user" : name === "Empty" || /^User IR \d+$/.test(name) ? "empty" : "factory";
    out.push({ index: i, name, kind, flag });
  }
  return out;
}

/**
 * 0x10 -> globals. The reply is a record list [a][b][u16 len][value LE, len bytes] (same shape as .prst settings).
 * Returns { records: [{ a, b, len, value }], <name>: value for every known GLOBALS entry }.
 */
export function decodeGlobals(data) {
  expectReply(data, READ.GLOBALS);
  const records = [];
  for (let o = 2; o + 4 <= data.length; ) {
    const len = data[o + 2] | (data[o + 3] << 8);
    if (o + 4 + len > data.length) break;
    let value = 0;
    for (let i = len - 1; i >= 0; i--) value = value * 256 + data[o + 4 + i];
    if (len === 1) value = readI8(value);
    else if (len === 4) value |= 0;
    records.push({ a: data[o], b: data[o + 1], len, value });
    o += 4 + len;
  }
  const out = { records };
  for (const [name, g] of Object.entries(GLOBALS)) {
    const r = records.find((x) => x.a === g.addr[0] && x.b === g.addr[1]);
    if (r) out[name] = r.value;
  }
  return out;
}

/**
 * Classify any complete payload received from the device. Used for unsolicited traffic
 * (knob turns, footswitches, preset changes on the pedal) and for ACKs.
 */
export function decodeMessage(p) {
  const kind = p[0];
  const fn = p[1];
  if (kind === KIND.ACK) return { type: "ack", kind, fn, raw: p };
  if (kind === KIND.GET && fn === READ.CURRENT_SLOT && p.length >= 3) return { type: "slot", slot: p[2] | ((p[3] ?? 0) << 8), raw: p };
  if ((kind === KIND.SET || kind === KIND.GET) && p.length >= 14 && fn === CMD.SET_PARAM)
    return { type: "param", block: readU32(p, 2), index: readU32(p, 6), value: readF32(p, 10), raw: p };
  if ((kind === KIND.SET || kind === KIND.GET) && p.length >= 10 && fn === CMD.SET_BLOCK)
    return { type: "block", block: readU32(p, 2), enabled: readU32(p, 6) !== 0, raw: p };
  if ((kind === KIND.SET || kind === KIND.GET) && p.length >= 14 && fn === CMD.SET_MODEL)
    return { type: "model", block: readU32(p, 2), fxid: readU32(p, 10), raw: p };
  if (fn === 0x1b || fn === 0x73) return { type: "presetChanged", kind, fn, raw: p };
  if (kind === KIND.GET) return { type: "reply", sel: fn, raw: p };
  return { type: "unknown", kind, fn, raw: p };
}
