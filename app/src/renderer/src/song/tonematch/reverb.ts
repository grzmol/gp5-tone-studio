// Reverb estimate from what's left after notes stop.
//
// Envelope: RMS of 20 ms windows every 5 ms, in dB. A note offset is a fast drop (≥ 6 dB within 30 ms) from at
// least 25 dB above the noise floor (10th percentile of the envelope). A dry offset falls straight to the floor; with
// reverb the fall stops at a knee (the next 30 ms drop less than 4 dB) and a slower, straight-line (in dB) tail follows.
//  - Decay: least-squares slope of the tail (until the floor, a new note, or 2 s) → RT60 = 60 dB / slope.
//  - Level: knee level relative to the level before the drop (the reverb-to-direct ratio at the offset).
// The medians over all tails are reported; more tails and consistent decays give more confidence. Echoes from a
// delay also leave tails, so a strong delay makes the reverb read longer.
import { frameLevels, quantile } from "./ltas";

export interface ReverbEstimate {
  detected: boolean;
  /** Median RT60 of the tails, s */
  rt60: number;
  /** Median tail level relative to the note before it stops, dB (negative) */
  levelDb: number;
  /** Offsets that had a tail / offsets that didn't */
  tails: number;
  dryOffsets: number;
  confidence: number;
}

const WINDOW_S = 0.02;
const HOP_S = 0.005;
const DROP_FRAMES = 6; // 30 ms
const DROP_DB = 6;
const KNEE_DB = 4;
const MIN_ABOVE_FLOOR_DB = 25;
const TAIL_MIN_S = 0.1;
const TAIL_MAX_S = 2;

interface Tail {
  rt60: number;
  levelDb: number;
}

/** Least-squares slope of y per step. */
function slope(y: Float64Array, from: number, to: number): number {
  const n = to - from;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const v = y[from + i];
    sx += i;
    sy += v;
    sxx += i * i;
    sxy += i * v;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

/** Follow one offset starting at `i`: its tail (or null when dry) and the frame to continue from. */
function followOffset(env: Float64Array, i: number, floor: number, hopS: number): { tail: Tail | null; next: number } {
  const n = env.length;
  let k = i + 1;
  const kneeBy = Math.min(n - DROP_FRAMES - 1, i + Math.round(0.1 / hopS));
  while (k < kneeBy && env[k] - env[k + DROP_FRAMES] >= KNEE_DB) k++;
  if (k >= kneeBy || env[k] < floor + 8) return { tail: null, next: i + DROP_FRAMES };
  // Tail: until the floor, a new note (3 dB above the running minimum) or TAIL_MAX_S.
  let end = k;
  let min = env[k];
  const stop = Math.min(n, k + Math.round(TAIL_MAX_S / hopS));
  while (end + 1 < stop && env[end + 1] > floor + 3 && env[end + 1] < min + 3) {
    end++;
    min = Math.min(min, env[end]);
  }
  if ((end - k) * hopS < TAIL_MIN_S) return { tail: null, next: end + 1 };
  const dbPerS = slope(env, k, end + 1) / hopS;
  // A tail that barely falls is a note still ringing, not a reverb.
  if (dbPerS > -5) return { tail: null, next: end + 1 };
  return { tail: { rt60: Math.min(8, -60 / dbPerS), levelDb: env[k] - env[i] }, next: end + 1 };
}

export function estimateReverb(x: Float32Array, sampleRate: number): ReverbEstimate {
  const hop = Math.round(HOP_S * sampleRate);
  const env = frameLevels(x, Math.round(WINDOW_S * sampleRate), hop);
  const hopS = hop / sampleRate;
  const none: ReverbEstimate = { detected: false, rt60: 0, levelDb: -60, tails: 0, dryOffsets: 0, confidence: 0.2 };
  if (env.filter((v) => v > -100).length < 100) return none;
  // Digital silence between notes would put the floor at -200 dB; nothing below -100 dB matters.
  const floor = Math.max(-100, quantile(env, 0.1));
  const tails: Tail[] = [];
  let dry = 0;
  for (let i = 0; i + DROP_FRAMES < env.length; i++) {
    if (env[i] < floor + MIN_ABOVE_FLOOR_DB || env[i] - env[i + DROP_FRAMES] < DROP_DB) continue;
    const { tail, next } = followOffset(env, i, floor, hopS);
    if (tail) tails.push(tail);
    else dry++;
    i = next;
  }
  if (tails.length + dry === 0) return none;
  const counted = tails.length + dry;
  if (tails.length < 3 || tails.length < dry) {
    return { ...none, tails: tails.length, dryOffsets: dry, confidence: Math.min(0.8, 0.3 + 0.05 * counted) };
  }
  const rts = tails.map((t) => t.rt60);
  const rt60 = quantile(rts, 0.5);
  const spread = (quantile(rts, 0.75) - quantile(rts, 0.25)) / rt60;
  return {
    detected: true,
    rt60,
    levelDb: quantile(
      tails.map((t) => t.levelDb),
      0.5,
    ),
    tails: tails.length,
    dryOffsets: dry,
    confidence: Math.min(0.85, 0.3 + 0.05 * tails.length) * (spread < 0.5 ? 1 : 0.7),
  };
}
