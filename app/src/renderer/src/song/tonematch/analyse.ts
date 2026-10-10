// Guitar stem analysis: everything Tone Match reads from the separated guitar, as plain data (it crosses the
// worker boundary). Each estimate carries a confidence 0..1.
import { estimateDelay, type DelayEstimate } from "./delay";
import { estimateGain, type GainEstimate } from "./gain";
import { bandMean, frameLevels, gateFrames, ltas, LTAS_FRAME, type Ltas } from "./ltas";
import { estimateReverb, type ReverbEstimate } from "./reverb";

export interface LevelEstimate {
  /** RMS of the frames that pass the silence gate, dBFS */
  rmsDb: number;
  peakDb: number;
  /** Share of the song where the guitar plays (frames passing the gate) */
  activeShare: number;
  confidence: number;
}

/**
 * Tone of the stem against a generic guitar-through-a-cabinet spectrum (1/3-octave band power: flat 150 Hz–1 kHz,
 * -6 dB/oct below, -4 dB/oct from 1 to 5 kHz, -18 dB/oct above), after matching both in 100 Hz–4 kHz. Positive =
 * more than that reference. These steer the amp's tone stack and the EQ; the IR match measures the real thing.
 */
export interface ToneEstimate {
  bassDb: number;
  lowMidDb: number;
  midDb: number;
  trebleDb: number;
  presenceDb: number;
  confidence: number;
}

export interface GuitarAnalysis {
  durationS: number;
  ltas: Ltas;
  level: LevelEstimate;
  gain: GainEstimate;
  delay: DelayEstimate;
  reverb: ReverbEstimate;
  tone: ToneEstimate;
}

/** Below this share of playing time, the stem is mostly bleed: every estimate is downweighted. */
const SPARSE_SHARE = 0.08;

export function estimateLevel(x: Float32Array, result: Ltas): LevelEstimate {
  const levels = frameLevels(x, LTAS_FRAME, LTAS_FRAME / 2);
  const gate = gateFrames(levels);
  let power = 0;
  let count = 0;
  levels.forEach((l, i) => {
    if (gate[i] && Number.isFinite(l)) {
      power += 10 ** (l / 10);
      count++;
    }
  });
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const activeShare = result.totalFrames ? result.activeFrames / result.totalFrames : 0;
  return {
    rmsDb: count ? 10 * Math.log10(power / count) : -120,
    peakDb: 20 * Math.log10(peak + 1e-12),
    activeShare,
    confidence: count >= 20 ? 0.95 : count / 20,
  };
}

/** Reference band power (dB) of a generic guitar through a cabinet, see ToneEstimate. */
export function referenceBandPower(fc: number): number {
  if (fc < 150) return -6 * Math.log2(150 / fc);
  if (fc <= 1000) return 0;
  if (fc <= 5000) return -4 * Math.log2(fc / 1000);
  return -4 * Math.log2(5) - 18 * Math.log2(fc / 5000);
}

export function estimateTone(result: Ltas): ToneEstimate {
  // ltas.db is power per FFT bin; a 1/3-octave band's power grows with its width (∝ fc).
  const deviation = Float64Array.from(result.centers, (fc, i) => result.db[i] + 10 * Math.log10(fc) - referenceBandPower(fc));
  const curve = { centers: result.centers, db: deviation };
  const ref = bandMean(curve, 100, 4000);
  const at = (lo: number, hi: number) => {
    const v = bandMean(curve, lo, hi) - ref;
    return Number.isFinite(v) ? v : 0;
  };
  return {
    bassDb: at(100, 250),
    lowMidDb: at(315, 500),
    midDb: at(630, 1250),
    trebleDb: at(1600, 3150),
    presenceDb: at(4000, 6300),
    confidence: result.activeFrames >= 20 ? 0.6 : 0.3,
  };
}

const scaleConfidence = <T extends { confidence: number }>(e: T, k: number): T => ({ ...e, confidence: e.confidence * k });

/** Analyse the mono guitar stem `x`. `onProgress` gets 0..1 between the stages. */
export function analyseGuitar(x: Float32Array, sampleRate: number, onProgress?: (fraction: number) => void): GuitarAnalysis {
  const spectrum = ltas(x, sampleRate);
  const level = estimateLevel(x, spectrum);
  onProgress?.(0.15);
  const gain = estimateGain(x, sampleRate);
  onProgress?.(0.3);
  const delay = estimateDelay(x, sampleRate);
  onProgress?.(0.85);
  const reverb = estimateReverb(x, sampleRate);
  onProgress?.(1);
  const k = level.activeShare < SPARSE_SHARE ? Math.max(0.2, level.activeShare / SPARSE_SHARE) : 1;
  return {
    durationS: x.length / sampleRate,
    ltas: spectrum,
    level,
    gain: scaleConfidence(gain, k),
    delay: scaleConfidence(delay, k),
    reverb: scaleConfidence(reverb, k),
    tone: scaleConfidence(estimateTone(spectrum), k),
  };
}
