// Gain class (clean / crunch / high gain) from three distortion proxies of the guitar stem.
//
//  1. Spectral flatness (geometric / arithmetic mean of the power spectrum, 100 Hz–6 kHz, 2048-sample frames).
//     Clean notes are a few harmonic peaks (1e-4 and below); saturated chords fill the spectrum with harmonics
//     and intermodulation (towards 0.1). Score 0 at 1e-4, 1 at 1e-1, log scale.
//  2. Harmonic density: energy 2.5–8 kHz relative to 100 Hz–2.5 kHz. Clipping pushes energy into the upper
//     harmonics. Score 0 at -40 dB, 1 at -15 dB.
//  3. Envelope crest: loudest 10 ms RMS over the RMS of its 0.4 s window. Picked clean notes decay (5 dB and
//     above); distortion compresses them into sustain (1.5 dB and below). It reads the dynamics, not the
//     waveform, so a cabinet's filtering doesn't change it. Score 0 at 5 dB, 1 at 1.5 dB.
//
// Overall score = 0.35·flatness + 0.35·density + 0.3·crest. Below 0.4 = clean, 0.4–0.65 = crunch, above = high gain.
// These breakpoints are heuristics from synthetic and reference material, not a measurement of the amp's gain knob.
// Only frames that pass the silence gate (ltas.ts) count.
import { hann, powerSpectrum } from "./fft";
import { frameLevels, gateFrames, quantile, toDb } from "./ltas";

export type GainClass = "clean" | "crunch" | "high";

export interface GainEstimate {
  gainClass: GainClass;
  /** 0 (clean) .. 1 (saturated) */
  score: number;
  confidence: number;
  /** Median spectral flatness, 0..1 */
  flatness: number;
  /** Energy 2.5–8 kHz relative to 100 Hz–2.5 kHz, dB */
  hfRatioDb: number;
  /** Median envelope crest over 0.4 s windows, dB */
  crestDb: number;
}

const FRAME = 2048;
const CREST_WINDOW_S = 0.4;
export const CRUNCH_FROM = 0.4;
export const HIGH_FROM = 0.65;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Median flatness and HF ratio over gated 2048-sample frames. */
function spectralProxies(x: Float32Array, sampleRate: number): { flatness: number; hfRatioDb: number } {
  const hop = FRAME / 2;
  const gate = gateFrames(frameLevels(x, FRAME, hop));
  const window = hann(FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const spec = new Float64Array(FRAME / 2 + 1);
  const binHz = sampleRate / FRAME;
  const bin = (hz: number) => Math.min(FRAME / 2, Math.round(hz / binHz));
  const [flatLo, flatHi, split, hfHi] = [bin(100), bin(6000), bin(2500), bin(8000)];
  const flat: number[] = [];
  const hf: number[] = [];
  for (let f = 0; f < gate.length; f++) {
    if (!gate[f]) continue;
    powerSpectrum(x.subarray(f * hop, f * hop + FRAME), window, re, im, spec);
    let logSum = 0;
    let linSum = 0;
    for (let k = flatLo; k <= flatHi; k++) {
      logSum += Math.log(spec[k] + 1e-20);
      linSum += spec[k];
    }
    const count = flatHi - flatLo + 1;
    flat.push(Math.exp(logSum / count) / (linSum / count + 1e-20));
    let low = 0;
    let high = 0;
    for (let k = flatLo; k < split; k++) low += spec[k];
    for (let k = split; k <= hfHi; k++) high += spec[k];
    hf.push(toDb(high / (low + 1e-20)));
  }
  return { flatness: flat.length ? quantile(flat, 0.5) : 0, hfRatioDb: hf.length ? quantile(hf, 0.5) : -60 };
}

/** Median envelope crest (dB) over gated 0.4 s windows. */
function envelopeCrest(x: Float32Array, sampleRate: number): number {
  const n = Math.round(CREST_WINDOW_S * sampleRate);
  const hop = Math.round(n / 2);
  const levels = frameLevels(x, n, hop);
  const gate = gateFrames(levels);
  const shortN = Math.round(0.01 * sampleRate);
  const shortHop = Math.round(shortN / 2);
  const short = frameLevels(x, shortN, shortHop);
  const crest: number[] = [];
  for (let f = 0; f < levels.length; f++) {
    if (!gate[f]) continue;
    let peak = -Infinity;
    const last = Math.min(short.length - 1, Math.floor((f * hop + n - shortN) / shortHop));
    for (let s = Math.ceil((f * hop) / shortHop); s <= last; s++) peak = Math.max(peak, short[s]);
    crest.push(peak - levels[f]);
  }
  return crest.length ? quantile(crest, 0.5) : 0;
}

export function classifyScore(score: number): GainClass {
  return score >= HIGH_FROM ? "high" : score >= CRUNCH_FROM ? "crunch" : "clean";
}

export function estimateGain(x: Float32Array, sampleRate: number): GainEstimate {
  const { flatness, hfRatioDb } = spectralProxies(x, sampleRate);
  const crestDb = envelopeCrest(x, sampleRate);
  const parts = [clamp01((Math.log10(flatness + 1e-12) + 4) / 3), clamp01((hfRatioDb + 40) / 25), clamp01((5 - crestDb) / 3.5)];
  const score = 0.35 * parts[0] + 0.35 * parts[1] + 0.3 * parts[2];
  const gainClass = classifyScore(score);
  const margin = gainClass === "clean" ? CRUNCH_FROM - score : gainClass === "high" ? score - HIGH_FROM : Math.min(score - CRUNCH_FROM, HIGH_FROM - score);
  // The three proxies disagreeing (e.g. a bright clean tone with high flatness) lowers confidence.
  const mean = (parts[0] + parts[1] + parts[2]) / 3;
  const spread = Math.sqrt(parts.reduce((acc, p) => acc + (p - mean) ** 2, 0) / 3);
  const confidence = Math.min(0.95, Math.max(0.2, (0.45 + 2.5 * margin) * (1 - 0.8 * spread)));
  return { gainClass, score, confidence, flatness, hfRatioDb, crestDb };
}
