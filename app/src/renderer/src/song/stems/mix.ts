import { STEM_NAMES, type StemName } from "../types";

// Stem mixer math (pure): gains from mute/solo/volume, waveform peaks, time labels.

export interface StemMix {
  /** 0..1 linear */
  volume: number;
  mute: boolean;
  solo: boolean;
}

export type Mix = Record<StemName, StemMix>;

export const defaultMix = (): Mix => Object.fromEntries(STEM_NAMES.map((n) => [n, { volume: 1, mute: false, solo: false }])) as Mix;

/** Linear gain per stem: with any stem soloed only soloed, unmuted stems play; otherwise every unmuted stem. */
export function stemGains(mix: Mix): Record<StemName, number> {
  const soloing = STEM_NAMES.some((n) => mix[n].solo);
  return Object.fromEntries(STEM_NAMES.map((n) => [n, mix[n].mute || (soloing && !mix[n].solo) ? 0 : mix[n].volume])) as Record<StemName, number>;
}

/** Peak (max |x| over channels) per bucket, `buckets` buckets over the whole length. */
export function peaks(channels: Float32Array[], buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const n = channels[0]?.length ?? 0;
  if (!n) return out;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.max(from + 1, Math.floor(((b + 1) * n) / buckets));
    let peak = 0;
    for (const ch of channels) for (let i = from; i < to && i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
    out[b] = peak;
  }
  return out;
}

/** RMS level of planar audio, all channels together. */
export function rms(channels: Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    count += ch.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** 83.4 → "1:23" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
