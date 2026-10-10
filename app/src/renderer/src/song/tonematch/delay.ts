// Delay (echo) detection from the autocorrelation of the onset function.
//
// The stem is analysed in 2048-sample frames every ~5 ms. The onset function o(t) is the power spectral flux in
// 100 Hz–8 kHz: the sum over FFT bins of each bin's power rise since the previous frame (one spike per pick
// attack). Per-bin power keeps two overlapping notes from beating against each other the way a band envelope
// would, and powers of separate events add. A delay with first-repeat level m (amplitude) and feedback g adds
// repeats of each attack with powers m²·g^(2(k-1)) at kT. For attacks at random times the normalised
// autocorrelation ρ of o then has peaks at T, 2T, … with (p = g², q = m²)
//     ρ(2T) / ρ(T) = p        and        ρ(T) = (q + q²·p·a) / (1 + q²·a),  a = 1 / (1 − p²),
// which give the feedback and, solved for q, the repeat level. The echo time is the strongest peak of ρ in
// 60 ms–1.2 s (sub-frame by parabolic interpolation). Repeats darker than the dry attacks (ρ above 3 kHz much
// lower than below 1.5 kHz) point to an analog or tape delay.
// Limit: playing that repeats at a steady period (straight eighths, a riff) looks like an echo with feedback near
// 1; that case is reported with low confidence.
import { hann, powerSpectrum } from "./fft";

export interface DelayEstimate {
  detected: boolean;
  /** Echo time, ms (when detected) */
  timeMs: number;
  /** Feedback g, 0..0.9: level of each repeat relative to the one before */
  feedback: number;
  /** First repeat level relative to the dry signal (linear) */
  level: number;
  /** Repeats lose their highs (analog/tape character) */
  dark: boolean;
  confidence: number;
}

export const DELAY_MIN_MS = 60;
export const DELAY_MAX_MS = 1200;
const FRAME = 2048;
const HOP_S = 0.005;
/** Half-width of the onset detrend window, frames (±80 ms: wider than one attack in a 2048-sample frame) */
const DETREND_HALF = 16;
/** ρ(T) needed to call it an echo, and its margin over the median ρ in the search range */
const DETECT_RHO = 0.12;
const DETECT_PROMINENCE = 0.08;

interface Onsets {
  full: Float64Array;
  low: Float64Array;
  high: Float64Array;
  /** Envelope frames per second */
  rate: number;
}

/** Onset functions (full band, below 1.5 kHz, above 3 kHz) of `x`. */
export function onsetFunctions(x: Float32Array, sampleRate: number): Onsets {
  const hop = Math.max(1, Math.round(HOP_S * sampleRate));
  const frames = x.length < FRAME ? 0 : 1 + Math.floor((x.length - FRAME) / hop);
  const window = hann(FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const spec = new Float64Array(FRAME / 2 + 1);
  const binHz = sampleRate / FRAME;
  const bin = (hz: number) => Math.min(FRAME / 2, Math.round(hz / binHz));
  const [lo, split1, split2, hi] = [bin(100), bin(1500), bin(3000), bin(8000)];
  const prev = new Float64Array(FRAME / 2 + 1);
  const flux = [new Float64Array(frames), new Float64Array(frames), new Float64Array(frames)];
  for (let f = 0; f < frames; f++) {
    powerSpectrum(x.subarray(f * hop, f * hop + FRAME), window, re, im, spec);
    let full = 0;
    let low = 0;
    let high = 0;
    for (let k = lo; k <= hi; k++) {
      const rise = f === 0 ? 0 : Math.max(0, spec[k] - prev[k]);
      full += rise;
      if (k < split1) low += rise;
      else if (k >= split2) high += rise;
    }
    prev.set(spec);
    flux[0][f] = full;
    flux[1][f] = low;
    flux[2][f] = high;
  }
  return { full: flux[0], low: flux[1], high: flux[2], rate: sampleRate / hop };
}

/**
 * Remove the local mean (centred window of ±`half` frames): sustained notes raise the flux for as long as they
 * ring, which would otherwise put a broad hump under every lag shorter than a note.
 */
function detrend(o: Float64Array, half: number): Float64Array {
  const n = o.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i];
  return Float64Array.from(o, (v, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    return v - (prefix[hi] - prefix[lo]) / (hi - lo);
  });
}

/** Normalised, unbiased autocorrelation of `o` (local mean removed) for lags 0..maxLag. */
export function autocorrelation(o: Float64Array, maxLag: number): Float64Array {
  const n = o.length;
  const d = detrend(o, DETREND_HALF);
  const out = new Float64Array(maxLag + 1);
  let r0 = 0;
  for (const v of d) r0 += v * v;
  r0 /= Math.max(1, n);
  if (r0 <= 0) return out;
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += d[i] * d[i + lag];
    out[lag] = acc / (n - lag) / r0;
  }
  return out;
}

/** ρ at fractional lag (linear interpolation). */
const at = (rho: Float64Array, lag: number) => {
  const i = Math.floor(lag);
  if (i + 1 >= rho.length) return rho[rho.length - 1] ?? 0;
  return rho[i] + (rho[i + 1] - rho[i]) * (lag - i);
};

/** Repeat power q from ρ(T) and the per-repeat power ratio p (the smaller root, ≤ 1). */
export function repeatPower(rhoT: number, p: number): number {
  const a = 1 / (1 - p * p);
  const c = a * (rhoT - p);
  if (Math.abs(c) < 1e-9) return Math.min(1, Math.max(0, rhoT));
  const disc = 1 - 4 * c * rhoT;
  if (disc < 0) return 1;
  return Math.min(1, Math.max(0, (1 - Math.sqrt(disc)) / (2 * c)));
}

const NONE: DelayEstimate = { detected: false, timeMs: 0, feedback: 0, level: 0, dark: false, confidence: 0 };

export function estimateDelay(x: Float32Array, sampleRate: number): DelayEstimate {
  const onsets = onsetFunctions(x, sampleRate);
  const minLag = Math.ceil((DELAY_MIN_MS / 1000) * onsets.rate);
  const maxLag = Math.floor((DELAY_MAX_MS / 1000) * onsets.rate);
  if (onsets.full.length < 4 * maxLag) return { ...NONE, confidence: 0.2 };
  const rho = autocorrelation(onsets.full, 3 * maxLag + 2);
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const peak = rho[lag] >= rho[lag - 1] && rho[lag] >= rho[lag + 1];
    if (peak && (best < 0 || rho[lag] > rho[best])) best = lag;
  }
  const median = Float64Array.from(rho.subarray(minLag, maxLag + 1)).sort()[Math.floor((maxLag - minLag) / 2)];
  // No echo: confident in proportion to how flat ρ is.
  if (best < 0 || rho[best] < DETECT_RHO || rho[best] - median < DETECT_PROMINENCE) {
    const strongest = best < 0 ? 0 : rho[best];
    return { ...NONE, confidence: Math.min(0.85, Math.max(0.3, 0.85 - 3 * Math.max(0, strongest - 0.04))) };
  }
  const [y0, y1, y2] = [rho[best - 1], rho[best], rho[best + 1]];
  const denom = y0 - 2 * y1 + y2;
  const lag = best + (denom < 0 ? (0.5 * (y0 - y2)) / denom : 0);
  const rhoT = Math.max(y1, at(rho, lag));
  // Least squares over the repeats, ρ(2T) ≈ p·ρ(T) and ρ(3T) ≈ p·ρ(2T). A second repeat that doesn't stand out of
  // the noise floor of ρ (twice the median |ρ| in the search range) means no feedback.
  const floor = Float64Array.from(rho.subarray(minLag, maxLag + 1), Math.abs).sort()[Math.floor((maxLag - minLag) / 2)];
  const r2 = at(rho, 2 * lag) > 2 * floor ? at(rho, 2 * lag) : 0;
  const r3 = r2 > 0 ? Math.max(0, at(rho, 3 * lag)) : 0;
  const p = Math.min(0.81, Math.max(0, (r2 * rhoT + r3 * r2) / (rhoT * rhoT + r2 * r2)));
  const p3 = r3 / Math.max(1e-9, r2);
  const lowRho = at(autocorrelation(onsets.low, best + 2), lag);
  const highRho = at(autocorrelation(onsets.high, best + 2), lag);
  // A steady repeating part looks like an echo with feedback near 1; repeats that don't decay consistently
  // (ρ(3T)/ρ(2T) far from ρ(2T)/ρ(T)) are doubtful too.
  const rhythmic = p > 0.7 ? 0.5 : 1;
  const consistent = p > 0.05 && Math.abs(p3 - p) > 0.35 ? 0.75 : 1;
  const strength = Math.min(1, (rhoT - DETECT_RHO) / 0.25);
  return {
    detected: true,
    timeMs: (lag / onsets.rate) * 1000,
    feedback: Math.sqrt(p),
    level: Math.sqrt(repeatPower(rhoT, p)),
    dark: lowRho > 0.05 && highRho < 0.6 * lowRho,
    confidence: Math.min(0.9, (0.4 + 0.5 * strength) * rhythmic * consistent),
  };
}
