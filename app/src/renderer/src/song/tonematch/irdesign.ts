// Cabinet IR matching: the correction between the GP-5's cab-less output (recorded through its USB audio) and the
// song's guitar stem, as a minimum-phase FIR at the GP-5's IR rate.
//
// 1. Both LTAS curves (ltas.ts, already 1/3-octave smoothed) are normalised to their mean level in 200 Hz–4 kHz,
//    and the correction is stem − recording, limited to ±MAX_CORRECTION_DB.
// 2. Outside 80 Hz–8 kHz a separated stem from a mixed song says little (bass and cymbals bleed, codecs cut the top),
//    so the correction is held at its edge values there, and the cabinet ends are shaped instead: a 2nd-order
//    high-pass at 70 Hz and a 4th-order low-pass at 9 kHz (Butterworth magnitudes).
// 3. The magnitude is made minimum phase with the real-cepstrum method (fold the cepstrum onto positive quefrency)
//    on a 16384-point grid, truncated to IR_TAPS with a short half-Hann fade, and peak-normalised to -1 dBFS.
import { fft } from "./fft";
import { bandMean, interpolateDb, type Ltas } from "./ltas";

/** GP-5 user IRs are 44.1 kHz. */
export const IR_RATE = 44100;
export const IR_TAPS = 1024;
export const MAX_CORRECTION_DB = 15;
export const MATCH_LO_HZ = 80;
export const MATCH_HI_HZ = 8000;
const HIGH_PASS_HZ = 70;
const LOW_PASS_HZ = 9000;
const GRID = 16384;
const PEAK = 10 ** (-1 / 20);

export interface CorrectionCurve {
  centers: readonly number[];
  /** Correction per band, dB (NaN where neither curve had data) */
  db: Float64Array;
}

/** stem − recording on the bands, both normalised to 200 Hz–4 kHz, limited and held outside the match range. */
export function correctionCurve(stem: Ltas, recording: Ltas): CorrectionCurve {
  const stemRef = bandMean(stem, 200, 4000);
  const recRef = bandMean(recording, 200, 4000);
  if (!Number.isFinite(stemRef) || !Number.isFinite(recRef)) throw new Error("There's not enough signal to compare the recording with the song.");
  const raw = Float64Array.from(stem.centers, (fc, i) => {
    if (fc < MATCH_LO_HZ || fc > MATCH_HI_HZ) return NaN;
    const d = stem.db[i] - stemRef - (recording.db[i] - recRef);
    return Number.isFinite(d) ? Math.max(-MAX_CORRECTION_DB, Math.min(MAX_CORRECTION_DB, d)) : NaN;
  });
  return { centers: stem.centers, db: raw };
}

/** Butterworth magnitude (dB) of an order-`n` high-pass (`high`) or low-pass at `fc`. */
function butterworthDb(f: number, fc: number, n: number, high: boolean): number {
  const ratio = high ? fc / Math.max(f, 1e-6) : f / fc;
  return -10 * Math.log10(1 + ratio ** (2 * n));
}

/** Target IR magnitude at `f`, dB: the correction (held flat beyond its ends) with the cabinet's end slopes. */
export function targetDb(curve: CorrectionCurve, f: number): number {
  return interpolateDb(curve.centers, curve.db, f) + butterworthDb(f, HIGH_PASS_HZ, 2, true) + butterworthDb(f, LOW_PASS_HZ, 4, false);
}

/**
 * Minimum-phase FIR whose magnitude follows `magnitudeDb(f)` (relative; the result is peak-normalised).
 * Real cepstrum c = IFFT(ln|H|); folding c onto n ≥ 0 (c[0], 2c[1..N/2-1], c[N/2]) and exponentiating its FFT
 * gives the minimum-phase spectrum with the same magnitude.
 */
export function designMinPhaseIr(magnitudeDb: (f: number) => number, taps = IR_TAPS, sampleRate = IR_RATE): Float32Array {
  const n = GRID;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    const logMag = (magnitudeDb((k * sampleRate) / n) / 20) * Math.LN10;
    re[k] = logMag;
    if (k > 0 && k < n / 2) re[n - k] = logMag;
  }
  fft(re, im, true); // real cepstrum (im ≈ 0)
  for (let q = 1; q < n / 2; q++) re[q] *= 2;
  for (let q = n / 2 + 1; q < n; q++) re[q] = 0;
  im.fill(0);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const mag = Math.exp(re[k]);
    const phase = im[k];
    re[k] = mag * Math.cos(phase);
    im[k] = mag * Math.sin(phase);
  }
  fft(re, im, true);
  const h = new Float32Array(taps);
  const fade = Math.max(1, Math.round(taps / 8));
  let peak = 0;
  for (let i = 0; i < taps; i++) {
    const w = i < taps - fade ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (i - (taps - fade))) / fade);
    h[i] = re[i] * w;
    peak = Math.max(peak, Math.abs(h[i]));
  }
  if (peak > 0) for (let i = 0; i < taps; i++) h[i] *= PEAK / peak;
  return h;
}

/** Magnitude response of FIR `h` at `f`, dB. */
export function responseDb(h: Float32Array, f: number, sampleRate = IR_RATE): number {
  const w = (2 * Math.PI * f) / sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < h.length; i++) {
    re += h[i] * Math.cos(w * i);
    im -= h[i] * Math.sin(w * i);
  }
  return 10 * Math.log10(re * re + im * im + 1e-30);
}

export interface MatchedIr {
  curve: CorrectionCurve;
  /** IR_TAPS samples at IR_RATE, peak -1 dBFS */
  ir: Float32Array;
}

/** The matched cabinet IR for a stem and a cab-less recording of the player. */
export function matchIr(stem: Ltas, recording: Ltas): MatchedIr {
  const curve = correctionCurve(stem, recording);
  if (!curve.db.some(Number.isFinite)) throw new Error("The recording and the song share no usable frequency range.");
  return { curve, ir: designMinPhaseIr((f) => targetDb(curve, f)) };
}
