import type { GuitarAnalysis } from "./analyse";
import { BAND_CENTERS } from "./ltas";

// Synthetic signals for the Tone Match DSP tests (seeded, so the tests are deterministic).

/** Mulberry32 PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function whiteNoise(length: number, seed: number, amplitude = 0.3): Float32Array {
  const r = rng(seed);
  return Float32Array.from({ length }, () => (r() * 2 - 1) * amplitude);
}

export interface PluckOptions {
  seconds: number;
  sampleRate: number;
  seed: number;
  /** Mean gap between notes, s (exponential gaps when `random`, else steady) */
  gap: number;
  random?: boolean;
  /** Amplitude decay time constant, s */
  decay: number;
  harmonics?: number;
  amplitude?: number;
}

/** Picked harmonic notes (random pitch 110–330 Hz, harmonics at 1/k² level) with exponential decay. */
export function plucks(o: PluckOptions): Float32Array {
  const r = rng(o.seed);
  const n = Math.round(o.seconds * o.sampleRate);
  const out = new Float32Array(n);
  const harmonics = o.harmonics ?? 6;
  const len = Math.round(Math.min(o.decay * 7, 3) * o.sampleRate);
  for (let t = 0.1; t < o.seconds; t += o.random === false ? o.gap : 0.05 + -Math.log(1 - r()) * o.gap) {
    const start = Math.round(t * o.sampleRate);
    const f0 = 110 * 3 ** r();
    const amp = (o.amplitude ?? 0.3) * (0.5 + 0.5 * r());
    const phases = Array.from({ length: harmonics }, () => r() * 2 * Math.PI);
    for (let i = 0; i < len && start + i < n; i++) {
      const time = i / o.sampleRate;
      let s = 0;
      for (let k = 1; k <= harmonics; k++) s += Math.sin(2 * Math.PI * f0 * k * time + phases[k - 1]) / (k * k);
      out[start + i] += amp * s * Math.exp(-time / o.decay);
    }
  }
  return out;
}

/**
 * Notes held for `hold` s and then muted, each followed by a noise reverb tail: the tail builds up to `wetDb`
 * below the note while it sounds and decays at 60 dB per `rt60` after it stops.
 */
export function mutedNotesWithReverb(o: { seconds: number; sampleRate: number; seed: number; gap: number; hold: number; rt60: number; wetDb: number }): Float32Array {
  const r = rng(o.seed);
  const n = Math.round(o.seconds * o.sampleRate);
  const out = new Float32Array(n);
  const wet = 10 ** (o.wetDb / 20);
  const tailLen = Math.round(o.rt60 * 1.5 * o.sampleRate);
  const holdLen = Math.round(o.hold * o.sampleRate);
  const fade = Math.round(0.004 * o.sampleRate);
  for (let t = 0.1; t + o.hold < o.seconds; t += o.hold + o.gap * (0.5 + r())) {
    const start = Math.round(t * o.sampleRate);
    const f0 = 110 * 3 ** r();
    const amp = 0.2 * (0.6 + 0.4 * r());
    for (let i = 0; i < holdLen + tailLen && start + i < n; i++) {
      const time = i / o.sampleRate;
      const gate = i < holdLen - fade ? 1 : i < holdLen ? (holdLen - i) / fade : 0;
      let s = 0;
      for (let k = 1; k <= 4; k++) s += Math.sin(2 * Math.PI * f0 * k * time) / k;
      // Noise tail: RMS `wet` relative to the note's RMS (≈0.8·amp for these 4 harmonics).
      const build = i < holdLen ? 1 - Math.exp(-time / 0.05) : 10 ** ((-3 * (i - holdLen)) / o.sampleRate / o.rt60);
      out[start + i] += amp * (s * gate + 0.8 * wet * Math.sqrt(3) * (r() * 2 - 1) * build);
    }
  }
  return out;
}

/** Feedback delay: y = x + m·Σ_{k≥1} g^(k-1)·x(t − kT). */
export function addEcho(x: Float32Array, sampleRate: number, timeS: number, feedback: number, level: number): Float32Array {
  const d = Math.round(timeS * sampleRate);
  const echo = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) echo[i] = x[i - d] + feedback * echo[i - d];
  return Float32Array.from(x, (v, i) => v + level * echo[i]);
}

/** Drive into a hard clipper. */
export function hardClip(x: Float32Array, drive: number, ceiling: number): Float32Array {
  return Float32Array.from(x, (v) => Math.max(-ceiling, Math.min(ceiling, v * drive)));
}

/** Biquad coefficients (b0, b1, b2, a1, a2), normalised by a0. */
export type Biquad = [number, number, number, number, number];

/** RBJ biquad low-pass coefficients. */
export function lowPass(fc: number, q: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

export function biquad(x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** |H(f)|² of a biquad. */
export function biquadPower([b0, b1, b2, a1, a2]: Biquad, f: number, sampleRate: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const mag2 = (c0: number, c1: number, c2: number) => {
    const re = c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w);
    const im = -c1 * Math.sin(w) - c2 * Math.sin(2 * w);
    return re * re + im * im;
  };
  return mag2(b0, b1, b2) / mag2(1, a1, a2);
}

/** A hand-made analysis: scooped high gain with a 375 ms delay and a plate-length reverb. */
export function analysisFixture(over: Partial<GuitarAnalysis> = {}): GuitarAnalysis {
  return {
    durationS: 180,
    ltas: { centers: BAND_CENTERS, db: new Float64Array(BAND_CENTERS.length), activeFrames: 900, totalFrames: 1000 },
    level: { rmsDb: -18, peakDb: -1, activeShare: 0.9, confidence: 0.95 },
    gain: { gainClass: "high", score: 0.75, confidence: 0.8, flatness: 0.02, hfRatioDb: -20, crestDb: 1.2 },
    delay: { detected: true, timeMs: 375, feedback: 0.4, level: 0.5, dark: false, confidence: 0.7 },
    reverb: { detected: true, rt60: 1.2, levelDb: -12, tails: 20, dryOffsets: 2, confidence: 0.8 },
    tone: { bassDb: 2, lowMidDb: -1, midDb: -3, trebleDb: 1, presenceDb: 0.5, confidence: 0.6 },
    ...over,
  };
}
