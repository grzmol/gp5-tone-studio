// Byte-exact vectors from the analysed repositories and from a real GP-5 (marked "hardware"). Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { READ, Reassembler, crc8, decodeCurrentSlot, decodeGlobals, decodeMessage, encode, fromHex, midi, packetize, parseSysex, toHex } from "../lib/protocol.mjs";

const fx = (name) => new URL(`../fixtures/${name}`, import.meta.url);
const wire = (payload) => packetize(payload).map((m) => toHex(m, ""));
const one = (payload) => {
  const w = wire(payload);
  assert.equal(w.length, 1);
  return w[0];
};
const norm = (s) => s.replace(/\s+/g, "").toLowerCase();

test("crc8 check value (CRC-8/SMBUS)", () => {
  assert.equal(crc8(new TextEncoder().encode("123456789")), 0xf4);
});

test("read requests match gp5-wc / valeton-gp50 / TonexOneController wires", () => {
  const cases = {
    [READ.PRESET_NAMES]: "F0 00 0E 00 01 00 00 00 02 01 02 04 00 F7",
    [READ.CURRENT_PATCH]: "F0 00 09 00 01 00 00 00 02 01 02 04 01 F7",
    [READ.CURRENT_SLOT]: "F0 00 07 00 01 00 00 00 02 01 02 04 03 F7",
    [READ.GLOBALS]: "F0 0B 09 00 01 00 00 00 02 01 02 01 00 F7",
    [READ.USER_IRS]: "F0 02 09 00 01 00 00 00 02 01 02 02 00 F7",
    [READ.SNAPTONES]: "F0 03 05 00 01 00 00 00 02 01 02 02 04 F7",
  };
  for (const [sel, expected] of Object.entries(cases)) assert.equal(one(encode.read(Number(sel))), norm(expected), `sel 0x${Number(sel).toString(16)}`);
});

test("live-edit commands match gp5-editor and TonexOneController vectors", () => {
  // gp5-editor test/commands.test.js
  assert.equal(one(encode.selectPreset(5)), "f00202000100000006010104030005000000000000f7");
  assert.equal(one(encode.setModel(3, 0x07000001)), "f0050a00010000000e01010407000300000000000000030000000000000001000000000007f7");
  assert.equal(one(encode.setParam(3, 0, 70)), "f00b0600010000000e010104080003000000000000000000000000000000000000080c0402f7");
  assert.equal(one(encode.setBlockEnabled(3, true)), "f0020900010000000a0101040900030000000000000001000000000000f7");
  assert.equal(one(encode.setBlockEnabled("RVB", false)), "f0090200010000000a0101040900080000000000000000000000000000f7");
  // TonexOneController usb_valeton_gp5.c (generated from the C builder)
  assert.equal(one(encode.setParam("AMP", 0, 50)), norm("F0 00 0F 00 01 00 00 00 0E 01 01 04 08 00 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 04 08 04 02 F7"));
  assert.equal(one(encode.setParam("DLY", 1, 500)), norm("F0 00 0D 00 01 00 00 00 0E 01 01 04 08 00 07 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 0F 0A 04 03 F7"));
  assert.equal(one(encode.setPatchVolume(80)), norm("F0 00 0E 00 01 00 00 00 0A 01 01 04 02 00 01 02 00 00 00 00 00 05 00 00 00 00 00 00 00 F7"));
  assert.equal(one(encode.setGlobal("inputTrim", -6)), norm("F0 0B 0E 00 01 00 00 00 0A 01 01 01 01 00 01 00 03 00 00 00 00 0F 0A 00 00 00 00 00 00 F7"));
  assert.equal(one(encode.setGlobal("masterVolume", 75)), norm("F0 0D 0A 00 01 00 00 00 0A 01 01 01 01 00 02 00 02 00 00 00 00 04 0B 00 00 00 00 00 00 F7"));
  assert.equal(
    one(encode.savePreset(7, "Clean")),
    norm("F0 01 05 00 01 00 00 01 00 01 01 04 0A 00 07 00 00 00 00 00 00 04 03 06 0C 06 05 06 01 06 0E 00 00 00 00 00 00 00 00 00 00 F7")
  );
});

test("GP-5 full preset write reproduces the Valeton Suite 2.1.0 capture byte-for-byte (26 frames, total=0x1A)", () => {
  const cap = JSON.parse(readFileSync(fx("gp5_suite_import.json"), "utf8"));
  const prst = readFileSync(fx("97-FF_CC.prst"));
  assert.deepEqual(wire(encode.writePreset(cap.slot, prst)), cap.write);
  assert.equal(parseSysex(fromHex(cap.write[0])).total, 0x1a);
  assert.deepEqual(wire(encode.renamePreset(cap.slot, "Walk")), cap.rename);
});

test("framing reproduces the independent GP-50 Suite capture (29 frames, total=0x1D)", () => {
  const cap = JSON.parse(readFileSync(fx("gp50_suite_write_slot0.json"), "utf8"));
  const prst = Uint8Array.from(Buffer.from(cap.prst_b64, "base64"));
  const payload = [0x11, 0x4f, cap.slot, 0, 0, 0, ...prst.subarray(0x19)];
  assert.deepEqual(wire(payload), cap.write);
});

test("device frames from captures decode with valid CRC", () => {
  const ack = parseSysex(fromHex("F0 0B 02 00 01 00 00 00 03 01 04 00 08 00 00 F7"));
  assert.ok(ack.crcOk);
  assert.equal(decodeMessage(ack.payload).type, "ack");
  // TonexOneController comments: 0x45 reply, 0x47 echo
  assert.ok(parseSysex(fromHex("f0 07 0d 00 01 00 00 00 03 01 02 04 05 00 00 f7")).crcOk);
  const echo = parseSysex(fromHex("f0 0c 05 00 01 00 00 00 0e 01 01 04 07 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 f7"));
  assert.ok(echo.crcOk);
  assert.deepEqual(decodeMessage(echo.payload), { type: "model", block: 1, fxid: 0, raw: echo.payload });
  // corrupted nibble -> crc fails
  assert.equal(parseSysex(fromHex("F0 0B 02 00 01 00 00 00 03 01 04 00 08 00 01 F7")).crcOk, false);
  assert.equal(parseSysex(Uint8Array.of(0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7)), null);
});

test("reassembler joins out-of-order frames of a 468-byte body reply", () => {
  const payload = Uint8Array.from({ length: 468 }, (_, i) => (i * 7) & 0xff);
  const frames = packetize(payload).map(parseSysex);
  assert.equal(frames.length, 25);
  const r = new Reassembler();
  const order = frames.map((_, i) => i).reverse();
  let out = null;
  for (const i of order) out = r.push(frames[i]) ?? out;
  assert.deepEqual(out, payload);
});

test("standard MIDI helpers", () => {
  assert.deepEqual(midi.selectPreset(42), [0xb0, 0, 42]);
  assert.deepEqual(midi.blockSwitch("NS", true), [0xb0, 51, 127]);
  assert.deepEqual(midi.blockSwitch("AMP", false), [0xb0, 52, 0]);
  assert.deepEqual(midi.tuner(true), [0xb0, 58, 127]);
  assert.throws(() => midi.selectPreset(100), RangeError);
});

test("hardware: 0x10 globals reply is a record list; 0x43 slot reply", () => {
  const reply = fromHex(
    "12 10 01 01 04 00 06 00 01 01 02 01 04 00 01 00 00 00 02 02 04 00 00 00 00 00 01 02 01 00 00 03 02 01 00 64 01 03 01 00 00 " +
      "01 04 01 00 00 02 04 01 00 03 03 04 01 00 01 04 04 01 00 01 05 04 01 00 00 03 03 01 00 00 07 04 02 00 03 00"
  );
  const g = decodeGlobals(reply);
  assert.equal(g.records.length, 13);
  assert.deepEqual(g.records[0], { a: 1, b: 1, len: 4, value: 0x01010006 });
  assert.deepEqual([g.masterVolume, g.inputTrim, g.monitorLevel, g.btLevel, g.cabSimBypass], [0, 0, 3, 0, 0]);
  assert.equal(decodeCurrentSlot(fromHex("12 43 3f 00")), 63);
});
