import type { PcmAudio } from "./types";

// PCM WAV writer for exported stems and IRs (16- or 24-bit integer, any channel count).

/** `audio` as a RIFF/WAVE file. Samples are clipped to [-1, 1] and rounded to the nearest integer. */
export function encodeWav(audio: PcmAudio, bits: 16 | 24 = 16): Uint8Array {
  const channels = audio.channels.length;
  const frames = channels ? audio.channels[0].length : 0;
  const width = bits / 8;
  const dataBytes = frames * channels * width;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * width, true);
  view.setUint16(32, channels * width, true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  const full = 2 ** (bits - 1);
  let p = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const x = Math.max(-1, Math.min(1, audio.channels[c][i]));
      const v = Math.max(-full, Math.min(full - 1, Math.round(x * full)));
      if (bits === 16) view.setInt16(p, v, true);
      else {
        out[p] = v & 0xff;
        out[p + 1] = (v >> 8) & 0xff;
        out[p + 2] = (v >> 16) & 0xff;
      }
      p += width;
    }
  return out;
}
