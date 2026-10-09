#!/usr/bin/env node
// Regenerates src/renderer/src/snaptone/excitation.bin from Valeton Suite's SnapTone test signal.
// Usage: node scripts/make-excitation.mjs <path to nam_input_wav.wav>
// The file ships with Valeton Suite 2.1.0 (data/flutter_assets/assets/wavs/nam_input_wav.wav): 44.1 kHz, 16-bit,
// stereo with identical channels, 70 s. Suite only uses channel 0. The output stores those samples as first
// differences (mod 2^16), low-byte plane then high-byte plane, raw-deflated (decoder: snaptone/pipeline.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/make-excitation.mjs <nam_input_wav.wav>");
  process.exit(1);
}
const b = readFileSync(src);
if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
let fmt = null;
let samples = null;
for (let off = 12; off + 8 <= b.length; ) {
  const id = b.toString("ascii", off, off + 4);
  const size = b.readUInt32LE(off + 4);
  if (id === "fmt ") fmt = { tag: b.readUInt16LE(off + 8), channels: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
  if (id === "data") {
    if (!fmt || fmt.tag !== 1 || fmt.bits !== 16 || fmt.rate !== 44100) throw new Error("expected 16-bit PCM at 44.1 kHz");
    const frames = size / (2 * fmt.channels);
    samples = new Int16Array(frames);
    for (let i = 0; i < frames; i++) samples[i] = b.readInt16LE(off + 8 + i * 2 * fmt.channels);
  }
  off += 8 + size + (size & 1);
}
if (!samples) throw new Error("no data chunk");
const n = samples.length;
const planes = new Uint8Array(2 * n);
let prev = 0;
for (let i = 0; i < n; i++) {
  const d = (samples[i] - prev) & 0xffff;
  prev = samples[i];
  planes[i] = d & 0xff;
  planes[n + i] = d >> 8;
}
const out = new URL("../src/renderer/src/snaptone/excitation.bin", import.meta.url);
writeFileSync(out, deflateRawSync(planes, { level: 9 }));
console.log(`${n} samples -> ${out.pathname}`);
