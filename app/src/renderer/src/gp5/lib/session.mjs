// Gp5Session: transport-agnostic, paced, serialized request/response layer for the Valeton GP-5.
// Works with any transport implementing:
//   { name: string, send(bytes: Uint8Array): void, onMessage(cb: (bytes: Uint8Array) => void): void, close(): void|Promise<void> }
// Transports: ./transport-webmidi.mjs (browser/Electron), ./transport-node.mjs (Node), ./mock-device.mjs (tests).
//
// Pacing rules (the pedal has a shallow MIDI input queue and can wedge until power-cycled if flooded):
//  - one request in flight at a time (promise chain), >= 20 ms between outgoing messages,
//  - settle gap after every exchange, never sweep unknown selectors, keep ONE port open for the session.

import {
  BLOCKS,
  KIND,
  READ,
  Reassembler,
  decodeCurrentPatch,
  decodeCurrentSlot,
  decodeGlobals,
  decodeMessage,
  decodePresetNames,
  decodeSlotTable,
  encode,
  midi,
  packetize,
  parseSysex,
  toHex,
} from "./protocol.mjs";
import { GP5_BODY_LEN, bodyOf, detectDevice, rebuildPrst } from "./prst.mjs";
import { encodeImportSnapTone, isUserSnapToneSlot, sanitizeSnapToneName } from "./snaptone.mjs";
import { USER_IR, encodeImportUserIr, isUserIrSlot } from "./userir.mjs";

export const DEFAULT_TIMING = Object.freeze({
  interMessageMs: 20, // TonexOneController: VALETON_GP5_INTER_MESSAGE_DELAY
  settleMs: 200, // gap after every read exchange (valeton-gp50 SETTLE_MS)
  editSettleMs: 25, // gap after live-edit commands (gp5-editor EDIT_SETTLE_MS)
  readTimeoutMs: 2500, // whole multi-frame reply must arrive within this
  ackTimeoutMs: 150, // per-frame ACK wait during writes/commands
  postSelectMs: 300, // after a preset change before reading 0x41 ("0.15 races; 0.25 clean")
  snapToneAckTimeoutMs: 3000, // per-frame ACK wait of a SnapTone / User IR upload before resending (Suite: 3000 x 1 ms ticks)
  snapToneResends: 9, // resends allowed per SnapTone / User IR upload (Suite fails the message after the 9th)
  readRetries: 1,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Gp5Error extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "timeout" | "length" | "verify" | "unsafe" | "closed"
  }
}

export class Gp5Session extends EventTarget {
  #t;
  #timing;
  #chain = Promise.resolve();
  #lastSend = 0;
  #reasm = new Reassembler();
  #waiters = new Set();
  #closed = false;
  #log;

  /**
   * @param transport see header
   * @param opts { timing?: Partial<DEFAULT_TIMING>, log?: (dir, bytes, decoded?) => void }
   */
  constructor(transport, opts = {}) {
    super();
    this.#t = transport;
    this.#timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.#log = opts.log;
    transport.onMessage((bytes) => this.#onBytes(bytes));
  }

  get transportName() {
    return this.#t.name;
  }

  // ------------------------------------------------------------------------------------------- low level

  #onBytes(bytes) {
    if (bytes[0] !== 0xf0) {
      this.#log?.("rx", bytes);
      this.dispatchEvent(Object.assign(new Event("midi"), { data: bytes }));
      return;
    }
    const frame = parseSysex(bytes);
    if (!frame || !frame.crcOk || !frame.lenOk) {
      this.#log?.("rx-bad", bytes);
      this.dispatchEvent(Object.assign(new Event("badframe"), { data: bytes }));
      return;
    }
    const payload = this.#reasm.push(frame);
    if (!payload) return;
    const msg = decodeMessage(payload);
    this.#log?.("rx", bytes, msg);
    let consumed = false;
    for (const w of this.#waiters) if (w.match(payload, msg)) (consumed = true), w.resolve(payload);
    // "message" = unsolicited traffic only (pedal knobs/footswitches, echoes nobody waited for)
    if (!consumed) this.dispatchEvent(Object.assign(new Event("message"), { message: msg }));
  }

  async #send(bytes) {
    if (this.#closed) throw new Gp5Error("closed", "session closed");
    const wait = this.#lastSend + this.#timing.interMessageMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.#log?.("tx", bytes);
    this.#t.send(bytes);
    this.#lastSend = Date.now();
  }

  #waitFor(match, timeoutMs) {
    let w;
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(w);
        reject(new Gp5Error("timeout", `no reply within ${timeoutMs} ms`));
      }, timeoutMs);
      w = {
        match,
        resolve: (v) => {
          clearTimeout(timer);
          this.#waiters.delete(w);
          resolve(v);
        },
      };
      this.#waiters.add(w);
    });
    return p;
  }

  /** Serialize fn behind every previous exchange, then settle for `settleMs`. */
  exclusive(fn, settleMs = this.#timing.settleMs) {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.then(
      () => sleep(settleMs),
      () => sleep(settleMs)
    );
    return run;
  }

  /** Read selector `sel` (READ.*); resolves with the reassembled payload incl. the [0x12, sel] echo. */
  read(sel, { timeoutMs = this.#timing.readTimeoutMs, retries = this.#timing.readRetries } = {}) {
    return this.exclusive(() => this.#readNow(sel, timeoutMs, retries));
  }

  async #readNow(sel, timeoutMs, retries) {
    for (let attempt = 0; ; attempt++) {
      this.#reasm.reset();
      const reply = this.#waitFor((p) => p[0] === KIND.GET && p[1] === sel && p.length > 2, timeoutMs);
      for (const m of packetize(encode.read(sel))) await this.#send(m);
      try {
        return await reply;
      } catch (e) {
        if (attempt >= retries) throw new Gp5Error("timeout", `read 0x${sel.toString(16)}: ${e.message}`);
        await sleep(400);
      }
    }
  }

  /** Send a logical command payload (framed + paced); waits up to ackTimeoutMs per frame for an ACK. */
  command(payload, opts = {}) {
    return this.exclusive(() => this.#commandNow(payload, opts), this.#timing.editSettleMs);
  }

  async #commandNow(payload, { ackTimeoutMs = this.#timing.ackTimeoutMs, requireAck = false } = {}) {
    const frames = packetize(payload);
    let acked = 0;
    for (const f of frames) {
      const ack = this.#waitFor((p) => p[0] === KIND.ACK, ackTimeoutMs).then(
        () => true,
        () => false
      );
      await this.#send(f);
      if (await ack) acked++;
    }
    if (requireAck && acked < frames.length) throw new Gp5Error("verify", `only ${acked}/${frames.length} frames acknowledged`);
    return { frames: frames.length, acked };
  }

  /** Raw short MIDI message (CC/PC), paced like everything else. */
  sendShort(bytes) {
    return this.exclusive(() => this.#send(Uint8Array.from(bytes)), this.#timing.editSettleMs);
  }

  async close() {
    this.#closed = true;
    await this.#chain.catch(() => {});
    await this.#t.close();
  }

  // ------------------------------------------------------------------------------------------- reads

  async readPresetNames() {
    return decodePresetNames(await this.read(READ.PRESET_NAMES));
  }
  async readCurrentSlot() {
    return decodeCurrentSlot(await this.read(READ.CURRENT_SLOT));
  }
  /** Body of the ACTIVE preset buffer (incl. unsaved live edits). 466 bytes on GP-5. */
  async readCurrentBody() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = decodeCurrentPatch(await this.read(READ.CURRENT_PATCH));
      if (body.length === GP5_BODY_LEN) return body;
      this.#log?.("warn", new Uint8Array(), { type: "length", got: body.length });
      await sleep(400);
    }
    throw new Gp5Error("length", `0x41 body is not ${GP5_BODY_LEN} bytes (is this a GP-5?)`);
  }
  async readSnapTones() {
    return decodeSlotTable(await this.read(READ.SNAPTONES));
  }
  async readUserIRs() {
    return decodeSlotTable(await this.read(READ.USER_IRS));
  }
  async readGlobals() {
    return decodeGlobals(await this.read(READ.GLOBALS));
  }

  // ------------------------------------------------------------------------------------------- preset selection

  /**
   * Select preset `slot`. method: "cc" (CC#0, used by TonexOneController + gp5-wc), "sysex" (11 43, used by gp5-editor),
   * "auto" (CC, verify with 0x43, fall back to SysEx). Returns the slot reported by the pedal.
   */
  async selectPreset(slot, { method = "auto" } = {}) {
    if (method === "cc" || method === "auto") await this.sendShort(midi.selectPreset(slot));
    else await this.command(encode.selectPreset(slot));
    await sleep(this.#timing.postSelectMs);
    let now = await this.readCurrentSlot();
    if (now !== slot && method === "auto") {
      await this.command(encode.selectPreset(slot));
      await sleep(this.#timing.postSelectMs);
      now = await this.readCurrentSlot();
    }
    if (now !== slot) throw new Gp5Error("verify", `pedal reports slot ${now} after selecting ${slot}`);
    return now;
  }

  /** Read slot `slot` as a complete 507-byte .prst (selects it!). Pass names to avoid re-reading 0x40. */
  async readPreset(slot, { names } = {}) {
    await this.selectPreset(slot);
    const body = await this.readCurrentBody();
    const list = names ?? (await this.readPresetNames());
    return rebuildPrst(list[slot].name, body, "gp5");
  }

  /** Back up every slot. Restores the originally active slot afterwards. onProgress(done, total, entry). */
  async backupAll({ onProgress, slots } = {}) {
    const names = await this.readPresetNames();
    const original = await this.readCurrentSlot();
    const wanted = slots ?? names.map((n) => n.slot);
    const out = [];
    try {
      for (const slot of wanted) {
        const prst = await this.readPreset(slot, { names });
        const entry = { slot, name: names[slot].name, prst };
        out.push(entry);
        onProgress?.(out.length, wanted.length, entry);
      }
    } finally {
      await this.selectPreset(original).catch(() => {});
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------- live edits (active buffer)

  setBlockEnabled(block, on) {
    return this.command(encode.setBlockEnabled(block, on));
  }
  /** Changes model; the pedal loads that model's default params — re-read 0x41 before showing values. */
  setModel(block, fxid) {
    return this.command(encode.setModel(block, fxid));
  }
  setParam(block, paramIndex, value) {
    return this.command(encode.setParam(block, paramIndex, value));
  }
  setPatchVolume(vol) {
    return this.command(encode.setPatchVolume(vol));
  }
  setGlobal(name, value) {
    return this.command(encode.setGlobal(name, value));
  }
  setTuner(on) {
    return this.sendShort(midi.tuner(on));
  }

  // ------------------------------------------------------------------------------------------- persistent writes (destructive)

  #guard(confirm, what) {
    if (confirm !== true) throw new Gp5Error("unsafe", `${what} overwrites pedal memory; pass { confirm: true } after backing up`);
  }

  /** Store the active buffer (with live edits) into `slot` named `name` (<= 10 chars). */
  async savePreset(slot, name, { confirm } = {}) {
    this.#guard(confirm, "savePreset");
    return this.command(encode.savePreset(slot, name));
  }

  /** Rename a slot (<= 10 chars). Valeton Suite capture; verified on hardware. */
  async renamePreset(slot, name, { confirm } = {}) {
    this.#guard(confirm, "renamePreset");
    return this.command(encode.renamePreset(slot, name));
  }

  /**
   * Write a 507-byte GP-5 .prst into `slot` (26 frames, one ACK per frame), then verify by reading it back.
   * If a frame is not acknowledged the pedal discards the whole transfer (observed on hardware right after a
   * save/select burst), so the stream is aborted and restarted from frame 0 after a pause (up to `attempts`).
   * Verification selects another slot and then `slot` (re-selecting the active slot does not reload flash).
   */
  async writePreset(slot, prst, { confirm, verify = true, onProgress, attempts = 3 } = {}) {
    this.#guard(confirm, "writePreset");
    if (detectDevice(prst).key !== "gp5") throw new Gp5Error("unsafe", "not a GP-5 .prst (convert GP-50 presets first)");
    const frames = packetize(encode.writePreset(slot, prst));
    const want = bodyOf(prst);
    for (let attempt = 1; ; attempt++) {
      await sleep(attempt === 1 ? 300 : 1000); // let the pedal finish flash work from earlier commands
      const acked = await this.exclusive(async () => {
        for (let i = 0; i < frames.length; i++) {
          const ack = this.#waitFor((p) => p[0] === KIND.ACK, this.#timing.ackTimeoutMs * 2).then(
            () => true,
            () => false
          );
          await this.#send(frames[i]);
          if (!(await ack)) return i;
          onProgress?.(i + 1, frames.length);
        }
        return frames.length;
      });
      if (acked < frames.length) {
        if (attempt < attempts) continue;
        throw new Gp5Error("verify", `frame ${acked + 1}/${frames.length} not acknowledged after ${attempts} attempts; slot ${slot} unchanged`);
      }
      if (!verify) return { frames: frames.length, acked, attempts: attempt, verified: false };
      await this.selectPreset((slot + 1) % 100);
      await this.selectPreset(slot);
      const body = await this.readCurrentBody();
      if (body.length === want.length && body.every((v, i) => v === want[i])) return { frames: frames.length, acked, attempts: attempt, verified: true };
      if (attempt >= attempts) throw new Gp5Error("verify", `read-back of slot ${slot} differs from the written preset`);
    }
  }

  /**
   * Upload a 2696-byte SnapTone file (lib/snaptone.mjs) into user SnapTone slot `slot` (50..79) as `name`.
   * Sent with the Suite file transport (#sendFileFrames), then verified by re-reading the SnapTone table (0x24):
   * it must hold user content under the sanitized name.
   */
  async uploadSnapTone(slot, name, file, { confirm, onProgress } = {}) {
    this.#guard(confirm, "uploadSnapTone");
    if (!isUserSnapToneSlot(slot)) throw new Gp5Error("unsafe", `SnapTone uploads go to user slots 50..79, got ${slot}`);
    const label = sanitizeSnapToneName(name);
    const frames = packetize(encodeImportSnapTone(slot, label, file));
    await this.#sendFileFrames(frames, "SnapTone", onProgress);
    await this.#verifyTableEntry(() => this.readSnapTones(), slot, label, `SnapTone slot ${slot}`);
    return { frames: frames.length, name: label, slot };
  }

  /**
   * Upload a 2048-byte User IR data block (lib/userir.mjs) into User IR slot `slot` (0..19) as `name`.
   * Same transport as SnapTone; the pedal sends no final reply, so the slot is verified through the User IR
   * table (0x20). The IR content itself cannot be read back.
   */
  async uploadUserIr(slot, name, data, { confirm, onProgress } = {}) {
    this.#guard(confirm, "uploadUserIr");
    if (!isUserIrSlot(slot)) throw new Gp5Error("unsafe", `User IR uploads go to slots 0..${USER_IR.SLOTS - 1}, got ${slot}`);
    const label = sanitizeSnapToneName(name);
    const frames = packetize(encodeImportUserIr(slot, label, data));
    await this.#sendFileFrames(frames, "User IR", onProgress);
    await this.#verifyTableEntry(() => this.readUserIRs(), slot, label, `User IR ${slot + 1}`);
    return { frames: frames.length, name: label, slot };
  }

  /**
   * Suite's file-upload flow control (SnapTone, User IR): one frame per ACK; an ACK whose first data byte is
   * not 0, or no ACK within snapToneAckTimeoutMs, resends the same frame; more than snapToneResends resends abort.
   */
  async #sendFileFrames(frames, what, onProgress) {
    await sleep(300); // let the pedal finish flash work from earlier commands, as before preset writes
    await this.exclusive(async () => {
      let resends = 0;
      for (let i = 0; i < frames.length; ) {
        // Suite's HTDevice::reciveACKData accepts kind 0x14 and 0x13; the first data byte 0 means "accepted".
        const ack = this.#waitFor((p) => p[0] === KIND.ACK || p[0] === 0x13, this.#timing.snapToneAckTimeoutMs).then(
          (p) => p[2] === 0,
          () => false
        );
        await this.#send(frames[i]);
        if (await ack) {
          i++;
          onProgress?.(i, frames.length);
        } else if (++resends > this.#timing.snapToneResends) {
          throw new Gp5Error("verify", `${what} upload stopped at frame ${i + 1}/${frames.length}: the pedal did not accept it`);
        }
      }
    });
  }

  /** A slot table entry must show user content (flag 0) under `label`; the pedal may need a moment to commit. */
  async #verifyTableEntry(readTable, slot, label, what) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(500);
      const entry = (await readTable())[slot];
      if (entry?.flag === 0 && entry.name === label) return;
    }
    throw new Gp5Error("verify", `${what} does not show "${label}" after the upload`);
  }

  // ------------------------------------------------------------------------------------------- state sync

  /** Full snapshot used at connect time: names, active slot, active body, globals. */
  async syncState() {
    const names = await this.readPresetNames();
    const slot = await this.readCurrentSlot();
    const body = await this.readCurrentBody();
    const globals = await this.readGlobals().catch(() => null);
    return { names, slot, prst: rebuildPrst(names[slot]?.name ?? "", body, "gp5"), globals };
  }
}

export { BLOCKS, toHex };
