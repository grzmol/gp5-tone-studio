import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MockGp5 } from "../lib/mock-device.mjs";
import { KIND, packetize, parseSysex, toHex } from "../lib/protocol.mjs";
import { Gp5Session } from "../lib/session.mjs";
import {
  SNAPTONE,
  checkCloneBlob,
  checkSnapToneFile,
  cloneToSnapToneFile,
  crc16Modbus,
  decodeImportSnapTone,
  encodeImportSnapTone,
  sanitizeSnapToneName,
} from "../lib/snaptone.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
// Clone blob made by Valeton Suite 2.1.0's converter (5868USB.dll) from NeuralAmpModelerCore's wavenet_a1_standard.nam.
const clone = load("snaptone-a1std.clo");
const presets = [load("65-Puppy.prst")];
const fast = { settleMs: 5, editSettleMs: 1, postSelectMs: 5, readTimeoutMs: 500, interMessageMs: 20, snapToneAckTimeoutMs: 200 };

test("CRC-16/MODBUS check value", () => {
  assert.equal(crc16Modbus(new TextEncoder().encode("123456789")), 0x4b37);
});

test("clone blob -> 2696-byte SnapTone file: header patched, float data kept, CRC redone", () => {
  assert.equal(checkCloneBlob(clone), null);
  const file = cloneToSnapToneFile(clone);
  assert.equal(file.length, SNAPTONE.FILE_SIZE);
  assert.equal(toHex(file.subarray(0, 0x18)), "56 54 53 49 88 0a 00 00 78 68 00 00 00 00 00 00 00 00 00 00 00 0a 00 00");
  assert.equal(toHex(file.subarray(0x78, 0x88)), "00 00 00 00 80 00 00 00 80 00 00 00 00 02 00 00", "arr2 capped at 512 taps");
  assert.deepEqual(file.subarray(0x18, 0x78), clone.subarray(0x18, 0x78));
  assert.deepEqual(file.subarray(0x88), clone.subarray(0x88, SNAPTONE.FILE_SIZE));
  assert.equal(checkSnapToneFile(file), null);
});

test("damaged clone data and files are refused", () => {
  const bad = clone.slice();
  bad[0x200] ^= 1;
  assert.match(checkCloneBlob(bad), /CRC/);
  const file = cloneToSnapToneFile(clone);
  file[0x300] ^= 1;
  assert.match(checkSnapToneFile(file), /CRC/);
  assert.throws(() => encodeImportSnapTone(60, "X", file), /CRC/);
  assert.match(checkSnapToneFile(clone), /2696/);
});

test("names follow Suite's rule: allowed ASCII only, 10 characters, X when empty", () => {
  assert.equal(sanitizeSnapToneName("5150 Red Channel"), "5150 Red C");
  assert.equal(sanitizeSnapToneName("Żółw$Amp"), "wAmp");
  assert.equal(sanitizeSnapToneName("   "), "X");
  assert.equal(sanitizeSnapToneName("ąę"), "X");
});

test("import payload: 11 25, fxId of the slot, name, 2696-byte file in 146 frames", () => {
  const file = cloneToSnapToneFile(clone);
  const payload = encodeImportSnapTone(79, "TEST", file);
  assert.equal(payload.length, 2770);
  const frames = packetize(payload);
  assert.equal(frames.length, 146);
  assert.equal(
    toHex(frames[0], ""),
    "f00001090200000103010102050000000000000000040f00000000000f050404050503050400000000000000000000f7",
  );
  assert.equal(parseSysex(frames[145]).payload.length, 15);
  assert.deepEqual(decodeImportSnapTone(payload), { slot: 79, name: "TEST", file });
  assert.throws(() => encodeImportSnapTone(49, "TEST", file), /user slots 50\.\.79/);
});

test("uploadSnapTone needs confirm, writes a user slot and verifies it in the 0x24 table", async () => {
  const dev = new MockGp5({ presets });
  const s = new Gp5Session(dev.transport(), { timing: fast });
  const file = cloneToSnapToneFile(clone);
  await assert.rejects(s.uploadSnapTone(62, "Lead", file), { code: "unsafe" });
  await assert.rejects(s.uploadSnapTone(12, "Lead", file, { confirm: true }), { code: "unsafe" });
  const steps = [];
  const r = await s.uploadSnapTone(62, "Lead Ch$", file, { confirm: true, onProgress: (d) => steps.push(d) });
  assert.deepEqual(r, { frames: 146, name: "Lead Ch", slot: 62 });
  assert.equal(steps.at(-1), 146);
  assert.deepEqual(dev.snapToneFiles.get(62), file);
  const table = await s.readSnapTones();
  assert.deepEqual({ name: table[62].name, flag: table[62].flag }, { name: "Lead Ch", flag: 0 });
  assert.deepEqual(dev.violations, []);
  await s.close();
});

test("uploadSnapTone resends a frame the pedal rejects, and gives up after too many rejections", async () => {
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
  const file = cloneToSnapToneFile(clone);
  await s.uploadSnapTone(70, "Retry", file, { confirm: true });
  assert.equal(dev.snapTones[70].name, "Retry");
  naks = Infinity;
  await assert.rejects(s.uploadSnapTone(71, "Never", file, { confirm: true }), { code: "verify", message: /frame 1\/146/ });
  assert.equal(dev.snapTones[71].name, "Empty");
  await s.close();
});
