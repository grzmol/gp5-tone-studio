import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MockGp5 } from "../lib/mock-device.mjs";
import { KIND, buildFrame, packetize, parseSysex, toHex } from "../lib/protocol.mjs";
import { Gp5Session } from "../lib/session.mjs";
import { USER_IR, decodeImportUserIr, encodeImportUserIr, encodeUserIrData, isUserIrSlot, userIrFxId } from "../lib/userir.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const presets = [load("65-Puppy.prst")];
const fast = { settleMs: 5, editSettleMs: 1, postSelectMs: 5, readTimeoutMs: 500, interMessageMs: 20, snapToneAckTimeoutMs: 200 };
const dirac = () => encodeUserIrData([0x7fffff]);

test("User IR fxids cover CAB 'User IR 1..20' and nothing else", () => {
  assert.equal(userIrFxId(0), 0x0a100000);
  assert.equal(userIrFxId(19), 0x0a100013);
  assert.throws(() => userIrFxId(20), RangeError);
  assert.throws(() => userIrFxId(-1), RangeError);
  assert.equal(isUserIrSlot(1.5), false);
});

test("data block: 24-bit Dirac is ff ff 7f 00 then zeros, 2048 bytes", () => {
  const d = dirac();
  assert.equal(d.length, USER_IR.DATA_BYTES);
  assert.equal(toHex(d.subarray(0, 4)), "ff ff 7f 00");
  assert.ok(d.subarray(4).every((b) => b === 0));
});

test("data block: negative samples are sign-extended int32 LE, not left-justified", () => {
  const d = encodeUserIrData(Int32Array.from([-1, -0x800000, 1]));
  assert.equal(toHex(d.subarray(0, 12)), "ff ff ff ff 00 00 80 ff 01 00 00 00");
});

test("data block: only the first 512 samples are kept; out-of-range samples are refused", () => {
  const long = new Int32Array(700).fill(5);
  const d = encodeUserIrData(long);
  assert.equal(d.length, 2048);
  assert.equal(new DataView(d.buffer).getInt32(511 * 4, true), 5);
  assert.throws(() => encodeUserIrData([0x800000]), RangeError);
  assert.throws(() => encodeUserIrData([0.5]), RangeError);
});

test("import payload for slot 3 'TEST' matches the Suite layout (spec §7)", () => {
  const p = encodeImportUserIr(3, "TEST", dirac());
  assert.equal(p.length, 2122);
  const frames = packetize(p);
  assert.equal(frames.length, 112);
  assert.equal(toHex(p.subarray(0, 19)), "11 21 00 00 00 00 03 00 10 0a 54 45 53 54 00 00 00 00 00");
  assert.ok(p.subarray(19, 74).every((b) => b === 0), "rest of name, node and fPara are zero");
  assert.equal(toHex(buildFrame(112, 0, p.subarray(0, 19)).subarray(0, 4)), "69 70 00 13");
  assert.equal(toHex(p.subarray(74, 78)), "ff ff 7f 00", "data starts at byte 74 (frame 3, byte 17)");
  assert.equal(parseSysex(frames[111]).payload.length, 13);
});

test("import payload: name follows Suite's rule, bad slots and data sizes are refused", () => {
  const p = encodeImportUserIr(0, "My $Cab 4x12 V30", dirac());
  assert.equal(decodeImportUserIr(p).name, "My Cab 4x1");
  assert.throws(() => encodeImportUserIr(20, "X", dirac()), RangeError);
  assert.throws(() => encodeImportUserIr(0, "X", new Uint8Array(100)), /2048/);
});

test("encode/decode round trip", () => {
  const data = encodeUserIrData(Int32Array.from({ length: 512 }, (_, i) => (i % 2 ? -i : i) * 1000));
  const back = decodeImportUserIr(encodeImportUserIr(17, "Room", data));
  assert.deepEqual(back, { slot: 17, name: "Room", data });
  assert.equal(decodeImportUserIr([KIND.SET, 0x25, 0, 0]), null);
});

test("uploadUserIr needs confirm, rejects slots outside 0..19, writes the slot and verifies it in the 0x20 table", async () => {
  const dev = new MockGp5({ presets });
  const s = new Gp5Session(dev.transport(), { timing: fast });
  const data = dirac();
  await assert.rejects(s.uploadUserIr(3, "TEST", data), { code: "unsafe" });
  await assert.rejects(s.uploadUserIr(20, "TEST", data, { confirm: true }), { code: "unsafe" });
  await assert.rejects(s.uploadUserIr(-1, "TEST", data, { confirm: true }), { code: "unsafe" });
  const steps = [];
  const r = await s.uploadUserIr(3, "TEST$", data, { confirm: true, onProgress: (d) => steps.push(d) });
  assert.deepEqual(r, { frames: 112, name: "TEST", slot: 3 });
  assert.equal(steps.at(-1), 112);
  assert.deepEqual(dev.userIrFiles.get(3), data);
  const table = await s.readUserIRs();
  assert.deepEqual({ name: table[3].name, flag: table[3].flag }, { name: "TEST", flag: 0 });
  assert.deepEqual(dev.violations, []);
  await s.close();
});

test("uploadUserIr resends a frame the pedal rejects, and gives up after too many rejections", async () => {
  const dev = new MockGp5({ presets });
  const t = dev.transport();
  let naks = 1;
  // Swap the next ACK for a rejection (first data byte 1) while `naks` > 0.
  const transport = {
    ...t,
    onMessage: (cb) =>
      t.onMessage((bytes) => {
        const f = parseSysex(bytes);
        if (f?.payload[0] === KIND.ACK && naks > 0) {
          naks--;
          return cb(packetize([KIND.ACK, 0x08, 0x01])[0]);
        }
        cb(bytes);
      }),
  };
  const s = new Gp5Session(transport, { timing: fast });
  await s.uploadUserIr(10, "Retry", dirac(), { confirm: true });
  assert.equal(dev.userIRs[10].name, "Retry");
  naks = Infinity;
  await assert.rejects(s.uploadUserIr(11, "Never", dirac(), { confirm: true }), { code: "verify", message: /frame 1\/112/ });
  assert.deepEqual(dev.userIRs[11], { name: "User IR 12", flag: 1 });
  await s.close();
});
