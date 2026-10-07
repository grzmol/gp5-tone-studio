import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyEdits, bodyOf, convertPrst, isCrcValid, parsePrst, rebuildPrst, validateOrder } from "../lib/prst.mjs";

const load = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const puppy = load("65-Puppy.prst");
const ffcc = load("97-FF_CC.prst");

test("decodes real GP-5 presets", () => {
  const p = parsePrst(ffcc);
  assert.equal(p.device, "gp5");
  assert.equal(p.name, "FF CC");
  assert.ok(p.crcValid);
  assert.equal(p.mask, 0x1fb);
  assert.equal(p.blocks[3].fxid, 0x07000004); // Dark Twin
  assert.deepEqual(p.blocks[3].params.slice(0, 3), [70, 85, 40]);
  assert.equal(p.blocks[4].fxid, 0x0a100001); // User IR 2
  assert.deepEqual(p.blocks[7].params.slice(0, 3), [3, 308, 42]); // Ping Pong: Time 308 ms at algId 1
});

test("rebuild(name, body) round-trips a file byte-for-byte", () => {
  for (const f of [puppy, ffcc, load("67-OerdriveM.prst")]) assert.deepEqual(rebuildPrst(parsePrst(f).name, bodyOf(f)), f);
});

test("applyEdits changes only the addressed bytes and fixes the CRC", () => {
  const out = applyEdits(puppy, { name: "Lead 2", volume: 70, blocks: { AMP: { params: { 0: 61 } }, DLY: { enabled: true } } });
  assert.ok(isCrcValid(out));
  const p = parsePrst(out);
  assert.equal(p.name, "Lead 2");
  assert.equal(p.settings.volume, 70);
  assert.equal(p.blocks[3].params[0], 61);
  assert.ok(p.blocks[7].enabled);
  assert.deepEqual(puppy, load("65-Puppy.prst"), "input must not be mutated");
});

test("chain order rules: fixed core DST,NS,AMP,CAB,EQ", () => {
  assert.equal(validateOrder([0, 1, 2, 9, 3, 4, 5, 6, 8, 7]), null);
  assert.equal(validateOrder([8, 0, 1, 2, 9, 3, 4, 5, 6, 7]), null);
  assert.match(validateOrder([0, 1, 2, 3, 9, 4, 5, 6, 7, 8]), /contiguous/);
  assert.throws(() => applyEdits(puppy, { order: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8] }));
});

test("GP-50 -> GP-5 -> GP-50 conversion is lossless for shared models", () => {
  const cap = JSON.parse(readFileSync(new URL("../fixtures/gp50_suite_write_slot0.json", import.meta.url), "utf8"));
  const gp50 = Uint8Array.from(Buffer.from(cap.prst_b64, "base64"));
  const gp5 = convertPrst(gp50, "gp5");
  assert.equal(gp5.length, 507);
  assert.equal(parsePrst(gp5).name, "US Lead");
  assert.deepEqual(parsePrst(gp5).blocks, parsePrst(gp50).blocks);
});
