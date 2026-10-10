// Long-term average spectrum (LTAS) on 1/3-octave bands, silence-gated.
// Frames: 8192-sample Hann, 50 % overlap. A frame counts when its RMS is above both the absolute gate
// (GATE_ABS_DB) and the relative gate (GATE_REL_DB below the 95th-percentile frame level), so pauses, count-ins
// and the song's guitar-free parts don't pull the average toward the noise floor.
import type { PcmAudio } from "@/song/types";
import { hann, powerSpectrum } from "./fft";

export const LTAS_FRAME = 8192;
export const GATE_ABS_DB = -60;
export const GATE_REL_DB = -35;

/** Base-2 1/3-octave band centres from ~20 Hz to ~20 kHz: 1000·2^(k/3), k = -17..13. */
export const BAND_CENTERS: readonly number[] = Array.from({ length: 31 }, (_, i) => 1000 * 2 ** ((i - 17) / 3));
export const bandEdges = (fc: number): [number, number] => [fc * 2 ** (-1 / 6), fc * 2 ** (1 / 6)];

export interface Ltas {
  /** Band centres, Hz (BAND_CENTERS) */
  centers: readonly number[];
  /** Mean power per FFT bin in each band, dB; NaN where the band is above Nyquist or nothing passed the gate */
  db: Float64Array;
  /** Frames that passed the silence gate / all frames */
  activeFrames: number;
  totalFrames: number;
}

/** Average all channels into one. */
export function toMono(audio: PcmAudio): Float32Array {
  const { channels } = audio;
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0]?.length ?? 0);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  for (let i = 0; i < out.length; i++) out[i] /= channels.length;
  return out;
}

export const toDb = (power: number) => 10 * Math.log10(Math.max(power, 1e-20));

/** Frame RMS levels in dBFS (frame length `n`, hop `hop`). */
export function frameLevels(x: Float32Array, n: number, hop: number): Float64Array {
  const count = x.length < n ? (x.length > 0 ? 1 : 0) : 1 + Math.floor((x.length - n) / hop);
  const out = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    const start = f * hop;
    const end = Math.min(start + n, x.length);
    for (let i = start; i < end; i++) sum += x[i] * x[i];
    out[f] = toDb(sum / n);
  }
  return out;
}

/** Value at quantile q (0..1) of `values` (a sorted copy is made). */
export function quantile(values: ArrayLike<number>, q: number): number {
  const sorted = Float64Array.from(values).sort();
  if (sorted.length === 0) return NaN;
  const pos = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Which frames pass the silence gate, from their levels. */
export function gateFrames(levels: Float64Array): Uint8Array {
  const ref = quantile(levels, 0.95);
  const threshold = Math.max(GATE_ABS_DB, ref + GATE_REL_DB);
  return Uint8Array.from(levels, (l) => (l >= threshold ? 1 : 0));
}

/** Silence-gated LTAS of mono `x` at `sampleRate` on BAND_CENTERS. */
export function ltas(x: Float32Array, sampleRate: number): Ltas {
  const n = LTAS_FRAME;
  const hop = n / 2;
  const levels = frameLevels(x, n, hop);
  const gate = gateFrames(levels);
  const bins = n / 2 + 1;
  const sum = new Float64Array(bins);
  const spec = new Float64Array(bins);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const window = hann(n);
  let active = 0;
  for (let f = 0; f < levels.length; f++) {
    if (!gate[f]) continue;
    powerSpectrum(x.subarray(f * hop, f * hop + n), window, re, im, spec);
    for (let k = 0; k < bins; k++) sum[k] += spec[k];
    active++;
  }
  const db = new Float64Array(BAND_CENTERS.length).fill(NaN);
  if (active > 0) {
    const binHz = sampleRate / n;
    BAND_CENTERS.forEach((fc, b) => {
      const [lo, hi] = bandEdges(fc);
      if (hi > sampleRate / 2) return;
      let acc = 0;
      let count = 0;
      for (let k = Math.ceil(lo / binHz); k < hi / binHz && k < bins; k++) {
        acc += sum[k];
        count++;
      }
      // Narrow low bands may fall between bins: take the bin nearest the centre.
      if (count === 0) {
        acc = sum[Math.min(bins - 1, Math.round(fc / binHz))];
        count = 1;
      }
      db[b] = toDb(acc / count / active);
    });
  }
  return { centers: BAND_CENTERS, db, activeFrames: active, totalFrames: levels.length };
}

/** Mean of `db` over the bands whose centre lies in [lo, hi] Hz (NaN bands skipped). */
export function bandMean(curve: { centers: readonly number[]; db: ArrayLike<number> }, lo: number, hi: number): number {
  let acc = 0;
  let count = 0;
  curve.centers.forEach((fc, i) => {
    const v = curve.db[i];
    if (fc >= lo && fc <= hi && Number.isFinite(v)) {
      acc += v;
      count++;
    }
  });
  return count ? acc / count : NaN;
}

/** Linear interpolation of a band curve at `freq` on a log-frequency axis; held flat beyond the first/last finite band. */
export function interpolateDb(centers: readonly number[], db: ArrayLike<number>, freq: number): number {
  const pts: [number, number][] = [];
  centers.forEach((fc, i) => {
    if (Number.isFinite(db[i])) pts.push([Math.log2(fc), db[i]]);
  });
  if (pts.length === 0) return 0;
  const x = Math.log2(Math.max(freq, 1e-3));
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  let i = 1;
  while (pts[i][0] < x) i++;
  const [x0, y0] = pts[i - 1];
  const [x1, y1] = pts[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
