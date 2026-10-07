// "Shape before GP-5": the pre/post filters as Web Audio BiquadFilterNode settings, and their exact magnitude
// response (Web Audio spec / RBJ cookbook formulas), so the drawn curve is what the audition plays.
import type { Shaping } from "@shared/host/capture";

export const FLAT_SHAPING: Shaping = {
  driveDb: 0,
  lowCutHz: 20,
  tightPct: 0,
  bassDb: 0,
  midDb: 0,
  trebleDb: 0,
  highCutHz: 20000,
};

export const SHAPING_RANGES = {
  driveDb: { min: -12, max: 12, step: 0.5 },
  lowCutHz: { min: 20, max: 300, step: 1 },
  tightPct: { min: 0, max: 100, step: 1 },
  bassDb: { min: -12, max: 12, step: 0.5 },
  midDb: { min: -12, max: 12, step: 0.5 },
  trebleDb: { min: -12, max: 12, step: 0.5 },
  highCutHz: { min: 2000, max: 20000, step: 100 },
} satisfies Record<keyof Shaping, { min: number; max: number; step: number }>;

export const isFlat = (s: Shaping) => (Object.keys(FLAT_SHAPING) as (keyof Shaping)[]).every((k) => s[k] === FLAT_SHAPING[k]);

export interface FilterSpec {
  type: "highpass" | "lowpass" | "peaking" | "lowshelf" | "highshelf";
  frequency: number;
  /** Web Audio Q: in dB for highpass/lowpass, linear for peaking, unused for shelves */
  Q: number;
  /** dB, peaking and shelves only */
  gain: number;
}

/** Butterworth Q (1/√2) expressed in dB, as Web Audio's lowpass/highpass expect. */
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
/** Tight at 100 % = −6 dB bell at 150 Hz: tightens palm mutes without thinning the tone. */
const TIGHT = { frequency: 150, Q: 0.8, maxCutDb: 6 };
/** A peaking filter with 0 dB gain is an exact identity: used for filters at their "off" position. */
const IDENTITY: FilterSpec = { type: "peaking", frequency: 1000, Q: 1, gain: 0 };

/** Filters before the capture (input drive is a gain, not a filter). */
export function preFilters(s: Shaping): FilterSpec[] {
  return [
    s.lowCutHz > SHAPING_RANGES.lowCutHz.min ? { type: "highpass", frequency: s.lowCutHz, Q: BUTTERWORTH_Q_DB, gain: 0 } : IDENTITY,
    s.tightPct > 0 ? { type: "peaking", frequency: TIGHT.frequency, Q: TIGHT.Q, gain: (-TIGHT.maxCutDb * s.tightPct) / 100 } : IDENTITY,
  ];
}

/** Filters after the capture. */
export function postFilters(s: Shaping): FilterSpec[] {
  return [
    { type: "lowshelf", frequency: 110, Q: 0, gain: s.bassDb },
    { type: "peaking", frequency: 700, Q: 0.9, gain: s.midDb },
    { type: "highshelf", frequency: 3200, Q: 0, gain: s.trebleDb },
    s.highCutHz < SHAPING_RANGES.highCutHz.max ? { type: "lowpass", frequency: s.highCutHz, Q: BUTTERWORTH_Q_DB, gain: 0 } : IDENTITY,
  ];
}

/** Biquad coefficients [b0, b1, b2, a0, a1, a2] exactly as the Web Audio spec defines them. */
export function biquadCoefficients(f: FilterSpec, sampleRate: number): [number, number, number, number, number, number] {
  const w0 = (2 * Math.PI * f.frequency) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (f.gain / 40);
  switch (f.type) {
    case "lowpass":
    case "highpass": {
      const alpha = sin / (2 * 10 ** (f.Q / 20));
      const b1 = f.type === "lowpass" ? 1 - cos : -(1 + cos);
      const b0 = f.type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2;
      return [b0, b1, b0, 1 + alpha, -2 * cos, 1 - alpha];
    }
    case "peaking": {
      const alpha = sin / (2 * f.Q);
      return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
    }
    case "lowshelf":
    case "highshelf": {
      const s = (sin / 2) * Math.SQRT2 * 2 * Math.sqrt(A); // 2·alpha_S·√A with shelf slope S = 1
      const sign = f.type === "lowshelf" ? 1 : -1;
      return [
        A * (A + 1 - sign * (A - 1) * cos + s),
        sign * 2 * A * (A - 1 - sign * (A + 1) * cos),
        A * (A + 1 - sign * (A - 1) * cos - s),
        A + 1 + sign * (A - 1) * cos + s,
        -sign * 2 * (A - 1 + sign * (A + 1) * cos),
        A + 1 + sign * (A - 1) * cos - s,
      ];
    }
  }
}

/** Magnitude in dB of a chain of biquads at `freq` Hz. */
export function chainResponseDb(filters: FilterSpec[], freq: number, sampleRate = 48000): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let db = 0;
  for (const f of filters) {
    const [b0, b1, b2, a0, a1, a2] = biquadCoefficients(f, sampleRate);
    const nr = b0 + b1 * c1 + b2 * c2;
    const ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2;
    const di = -(a1 * s1 + a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}
