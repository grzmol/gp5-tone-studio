// In-memory GP-5 simulator speaking the documented USB protocol. Use it for unit tests, UI development and
// (via scripts/virtual-gp5.mjs) as a virtual MIDI device. It models what open-source captures show; behaviour
// the pedal has not been observed to do (e.g. param defaults after a model change) is NOT invented.

import { BLOCKS, CC, CMD, FRAME_PAYLOAD_MAX, GLOBALS, KIND, PRESET_COUNT, READ, Reassembler, packetize, parseSysex, u32le } from "./protocol.mjs";
import { BODY_OFF, GP5_BODY_LEN, applyEdits, bodyOf, readName, rebuildPrst } from "./prst.mjs";
import { checkSnapToneFile, decodeImportSnapTone, isUserSnapToneSlot } from "./snaptone.mjs";

const ACK = [KIND.ACK, 0x08, 0x00]; // device ACK frame BUF b2 01 00 03 14 08 00
const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const nameBytes = (s, n) => Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) & 0xff : 0));

export class MockGp5 {
  /**
   * @param opts {
   *   presets: Array<Uint8Array> (507-byte GP-5 .prst; shorter list is cycled, extra slots are named "GP-5"),
   *   latencyMs = 1, minGapMs = 15 (gaps below this are recorded in .violations),
   *   snapTones?: string[80], userIRs?: string[20], acceptProgramChange = false, acceptCcSelect = true }
   */
  constructor({ presets, latencyMs = 1, minGapMs = 15, snapTones = [], userIRs = [], acceptProgramChange = false, acceptCcSelect = true } = {}) {
    if (!presets?.length) throw new Error("MockGp5 needs at least one GP-5 .prst");
    this.slots = Array.from({ length: PRESET_COUNT }, (_, i) => {
      const src = presets[i % presets.length];
      return { name: i < presets.length ? readName(src) : "GP-5", body: bodyOf(src) };
    });
    this.current = 0;
    this.buffer = this.slots[0].body.slice();
    // record layout copied from a real GP-5 0x10 reply: [a, b, len, value]
    this.globalRecords = [[1, 1, 4, 0x01010006], [2, 1, 4, 1], [2, 2, 4, 80], [1, 2, 1, 0], [3, 2, 1, 100], [1, 3, 1, 0], [1, 4, 1, 0], [2, 4, 1, 0], [3, 4, 1, 1], [4, 4, 1, 1], [5, 4, 1, 0], [3, 3, 1, 0], [7, 4, 2, 3]];
    // flag 0 = user content, 1 = factory/empty (as on hardware)
    this.snapTones = Array.from({ length: 80 }, (_, i) => (snapTones[i] ? { name: snapTones[i], flag: i < 50 ? 1 : 0 } : { name: i < 50 ? `Factory ${i + 1}` : "Empty", flag: 1 }));
    this.userIRs = Array.from({ length: 20 }, (_, i) => (userIRs[i] ? { name: userIRs[i], flag: 0 } : { name: `User IR ${i + 1}`, flag: 1 }));
    this.snapToneFiles = new Map(); // slot -> uploaded 2696-byte SnapTone file
    this.latencyMs = latencyMs;
    this.minGapMs = minGapMs;
    this.acceptProgramChange = acceptProgramChange;
    this.acceptCcSelect = acceptCcSelect;
    this.dropFrames = 0; // > 0: lose frame #5 of the next multi-frame write(s), like a busy pedal
    this.log = []; // decoded host->device payloads, newest last
    this.violations = []; // { gapMs } for host messages sent faster than minGapMs
    this.#reasm = new Reassembler();
  }
  #reasm;
  #listener = null;
  #lastRx = 0;

  /** Transport for Gp5Session (host side). */
  transport() {
    return {
      name: "GP-5 (mock)",
      send: (bytes) => this.receive(Uint8Array.from(bytes)),
      onMessage: (cb) => {
        this.#listener = cb;
      },
      close: () => {
        this.#listener = null;
      },
    };
  }

  /** Attach any sink for device->host bytes (used by the virtual-port bridge). */
  setOutput(cb) {
    this.#listener = cb;
  }

  #emit(bytes) {
    const b = Uint8Array.from(bytes);
    setTimeout(() => this.#listener?.(b), this.latencyMs);
  }
  #reply(payload) {
    for (const m of packetize(payload, FRAME_PAYLOAD_MAX)) this.#emit(m);
  }

  /** Bytes from host. */
  receive(bytes) {
    const now = Date.now();
    if (this.#lastRx && now - this.#lastRx < this.minGapMs) this.violations.push({ gapMs: now - this.#lastRx });
    this.#lastRx = now;
    if (bytes[0] !== 0xf0) return this.#short(bytes);
    const frame = parseSysex(bytes);
    if (!frame || !frame.crcOk) return; // the real pedal ignores malformed frames
    const isRead = frame.total === 1 && frame.payload[0] === KIND.GET;
    if (!isRead && frame.total > 1 && this.dropFrames > 0 && frame.index === 5) {
      // simulate a busy pedal: frame lost, no ACK, partial transfer discarded (seen on hardware)
      this.dropFrames--;
      this.#reasm.reset();
      return;
    }
    if (!isRead) this.#emit(packetize(ACK)[0]);
    const payload = this.#reasm.push(frame);
    if (payload) this.#handle(payload);
  }

  #short([status, d1, d2]) {
    if ((status & 0xf0) === 0xb0 && d1 === CC.PRESET_SELECT) {
      if (this.acceptCcSelect && d2 < PRESET_COUNT) this.#select(d2);
    } else if ((status & 0xf0) === 0xc0 && this.acceptProgramChange && d1 < PRESET_COUNT) this.#select(d1);
    else if ((status & 0xf0) === 0xb0) {
      const blk = Object.entries(CC.BLOCK_SWITCH).find(([, cc]) => cc === d1)?.[0];
      if (blk) this.#setMask(BLOCKS.indexOf(blk), d2 >= 64);
    }
  }

  #select(slot) {
    this.current = slot;
    this.buffer = this.slots[slot].body.slice();
  }
  #prst() {
    return rebuildPrst(this.slots[this.current].name, this.buffer, "gp5");
  }
  #setBuffer(prst) {
    this.buffer = bodyOf(prst);
  }
  #setMask(k, on) {
    this.#setBuffer(applyEdits(this.#prst(), { blocks: { [k]: { enabled: on } } }));
  }

  #handle(p) {
    this.log.push(p);
    const [kind, fn] = p;
    if (kind === KIND.GET) return this.#read(fn);
    if (kind !== KIND.SET) return;
    switch (fn) {
      case CMD.SELECT_PRESET:
        return this.#select(readU32(p, 2));
      case CMD.SET_MODEL:
        return this.#setBuffer(applyEdits(this.#prst(), { blocks: { [readU32(p, 2)]: { fxid: readU32(p, 10) } } }));
      case CMD.SET_PARAM: {
        const v = new DataView(p.buffer, p.byteOffset + 10, 4).getFloat32(0, true);
        return this.#setBuffer(applyEdits(this.#prst(), { blocks: { [readU32(p, 2)]: { params: { [readU32(p, 6)]: v } } } }));
      }
      case CMD.SET_BLOCK:
        return this.#setMask(readU32(p, 2), readU32(p, 6) !== 0);
      case CMD.SET_PATCH_SETTING:
        if (p[2] === 1) this.#setBuffer(applyEdits(this.#prst(), { volume: p[6] }));
        return;
      case CMD.SET_GLOBAL: {
        const r = this.globalRecords.find(([a, b]) => a === p[2] && b === p[3]);
        if (r) r[3] = p[6] & 0x80 ? p[6] - 256 : p[6];
        return;
      }
      case CMD.SAVE_PRESET: {
        const slot = readU32(p, 2);
        this.slots[slot] = { name: String.fromCharCode(...p.subarray(6, 16).filter((c) => c)), body: this.buffer.slice() };
        return;
      }
      case CMD.RENAME_PRESET:
        this.slots[readU32(p, 2)].name = String.fromCharCode(...p.subarray(6, 16).filter((c) => c));
        return;
      case CMD.WRITE_PRESET: {
        const slot = p[2];
        const rest = p.subarray(6); // name(16) + body
        this.slots[slot] = { name: String.fromCharCode(...rest.subarray(0, 16).filter((c) => c)), body: rest.slice(16) };
        if (slot === this.current) this.buffer = this.slots[slot].body.slice();
        return;
      }
      case CMD.IMPORT_SNAPTONE: {
        // Stored only when well-formed; the pedal's reaction to a bad file is unknown, so nothing else is modelled.
        const up = decodeImportSnapTone(p);
        if (!up || !isUserSnapToneSlot(up.slot) || checkSnapToneFile(up.file)) return;
        this.snapTones[up.slot] = { name: up.name, flag: 0 };
        this.snapToneFiles.set(up.slot, up.file);
        return;
      }
    }
  }

  #read(sel) {
    switch (sel) {
      case READ.PRESET_NAMES:
        return this.#reply([KIND.GET, sel, ...this.slots.flatMap((s, i) => [...u32le(i), ...nameBytes(s.name, 16)])]);
      case READ.CURRENT_PATCH:
        return this.#reply([KIND.GET, sel, ...this.buffer]);
      case READ.CURRENT_SLOT:
        return this.#reply([KIND.GET, sel, this.current & 0xff, this.current >> 8]);
      case READ.SNAPTONES:
      case READ.USER_IRS: {
        const t = sel === READ.SNAPTONES ? this.snapTones : this.userIRs;
        return this.#reply([KIND.GET, sel, ...t.map((x) => x.flag), ...t.flatMap((x) => nameBytes(x.name, 16))]);
      }
      case READ.GLOBALS:
        return this.#reply([KIND.GET, sel, ...this.globalRecords.flatMap(([a, b, len, v]) => [a, b, len, 0, ...u32le(v).slice(0, len)])]);
    }
  }

  // ---- helpers for tests / demos: simulate hardware interaction (device-originated messages)

  /** Footswitch/knob on the pedal: switch preset and notify like the real unit (12 43 slot 00 00 00). */
  pressPreset(slot) {
    this.#select(slot);
    this.#reply([KIND.GET, READ.CURRENT_SLOT, slot, 0, 0, 0]);
  }
  /** Knob turn on the pedal -> param notification. */
  turnKnob(block, index, value) {
    this.#setBuffer(applyEdits(this.#prst(), { blocks: { [block]: { params: { [index]: value } } } }));
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, value, true);
    this.#reply([KIND.SET, CMD.SET_PARAM, ...u32le(block), ...u32le(index), ...new Uint8Array(f.buffer)]);
  }
}

export { BODY_OFF, GP5_BODY_LEN };
