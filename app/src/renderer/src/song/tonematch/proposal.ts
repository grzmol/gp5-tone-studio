// From a guitar analysis to a GP-5 preset proposal: models from the catalog, key params, a reason and a
// confidence per block. Pure (no device access); apply.ts plays it on the pedal.
//
// Assumed param scales (the GP-5 doesn't document them; these are starting points to fine-tune by ear):
//  - amp tone stack and PRES: 50 = flat, 4 steps per dB; Guitar EQ bands: ±50 = ±12.5 dB (4 steps per dB).
//  - delay F.Back = feedback × 100; delay and reverb Mix = 100 · w / (1 + w) for a wet level w relative to dry.
//  - reverb Decay: RT60 0.3 s → 0, 5 s → 100, linear.
import { clampParam, defaultParams, findModel } from "@/gp5/lib/catalog.mjs";
import { BLOCK_CODES, type BlockCode, type ModelInfo, type ParamInfo } from "@/state/device-types";
import type { GuitarAnalysis, ToneEstimate } from "./analyse";
import type { GainClass } from "./gain";

export interface ProposedSetting {
  name: string;
  value: number;
  unit?: string;
}

export interface ProposedBlock {
  /** GP-5 storage index (0 NR … 9 NS) */
  index: number;
  code: BlockCode;
  enabled: boolean;
  /** Model to load; null keeps the block's current model and params (only on/off changes) */
  fxid: number | null;
  /** Display title of the model (when fxid is set) */
  title: string | null;
  /** All 8 param slots (when fxid is set) */
  params: number[] | null;
  /** The params worth showing, in catalog order */
  settings: ProposedSetting[];
  why: string;
  /** How sure the analysis behind this block is; null for fixed choices (blocks switched off for a clean audition) */
  confidence: number | null;
}

export interface Proposal {
  blocks: ProposedBlock[];
  /** Weighted overall confidence */
  confidence: number;
  summary: string;
}

/** Below this confidence a detected delay or reverb isn't put in the preset. */
export const EFFECT_MIN_CONFIDENCE = 0.35;
const STEPS_PER_DB = 4;
const GAIN_LABEL: Record<GainClass, string> = { clean: "Clean", crunch: "Crunch", high: "High gain" };

/** Catalog params also flag on/off switches. */
type CatalogModel = ModelInfo & { params: (ParamInfo & { toggle?: boolean })[] };

const fmtDb = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
const clampStep = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

function model(name: string, block: BlockCode): CatalogModel {
  const m = findModel(name, block) as CatalogModel | undefined;
  if (!m) throw new Error(`The catalog has no ${block} model "${name}"`);
  return m;
}

/** A block loading `name` with `values` (by param name; unknown names are skipped) on top of the model defaults. */
function withModel(code: BlockCode, name: string, values: Record<string, number>, why: string, confidence: number): ProposedBlock {
  const m = model(name, code);
  const params = defaultParams(m.fxid) as number[];
  const settings: ProposedSetting[] = [];
  for (const p of m.params) {
    if (values[p.name] !== undefined) params[p.index] = clampParam(p, values[p.name]) as number;
    if (!p.toggle || values[p.name] !== undefined) settings.push({ name: p.name, value: params[p.index], ...(p.unit ? { unit: p.unit } : {}) });
  }
  return { index: BLOCK_CODES.indexOf(code), code, enabled: true, fxid: m.fxid, title: m.title, params, settings, why, confidence };
}

const keepModel = (code: BlockCode, enabled: boolean, why: string, confidence: number | null): ProposedBlock => ({
  index: BLOCK_CODES.indexOf(code),
  code,
  enabled,
  fxid: null,
  title: null,
  params: null,
  settings: [],
  why,
  confidence,
});

interface AmpChoice {
  amp: string;
  cab: string;
  character: string;
}

/** Amp and matching cab for the gain class and the tone's character. */
export function chooseAmp(gainClass: GainClass, score: number, tone: ToneEstimate): AmpChoice {
  const top = tone.trebleDb + tone.presenceDb;
  const bright = top > 3;
  const dark = top < -3;
  if (gainClass === "clean") {
    if (bright) return { amp: "Dark Twin", cab: "Dark Twin 2x12", character: "bright, sparkly clean" };
    if (dark) return { amp: "Bellman 59N", cab: "Bellman 2x12", character: "warm, round clean" };
    if (tone.midDb > 2) return { amp: "Foxy 30N", cab: "Foxy 2x12", character: "mid-forward, chimey clean" };
    return { amp: "J-120 CL", cab: "J-120 2x12", character: "neutral clean" };
  }
  if (gainClass === "crunch") {
    if (bright) return { amp: "Foxy 30TB", cab: "Foxy 2x12", character: "bright, chimey crunch" };
    if (dark) return { amp: "Bellman 59B", cab: "Bellman 2x12", character: "warm, loose crunch" };
    if (score < 0.48) return { amp: "UK 45", cab: "UK GRN 2x12", character: "light edge-of-breakup crunch" };
    return { amp: "UK 800", cab: "UK GRN 4x12", character: "classic British crunch" };
  }
  if (tone.midDb < -1.5) return { amp: "Mess DualM", cab: "Mess 4x12", character: "scooped modern high gain" };
  if (tone.midDb > 1.5) return { amp: "EV 51", cab: "EV 4x12", character: "mid-forward modern high gain" };
  if (dark) return { amp: "Bog RedV", cab: "Bog 4x12", character: "thick, dark high gain" };
  return { amp: "Solo100 LD", cab: "Solo 4x12", character: "smooth high-gain lead" };
}

/** Amp gain knob within the class range: clean 15–40, crunch 40–65, high gain 60–85. */
export function ampGain(gainClass: GainClass, score: number): number {
  if (gainClass === "clean") return clampStep(15 + (score / 0.4) * 25, 15, 40);
  if (gainClass === "crunch") return clampStep(40 + ((score - 0.4) / 0.25) * 25, 40, 65);
  return clampStep(60 + ((score - 0.65) / 0.35) * 25, 60, 85);
}

/** Half of a deviation as tone-stack steps around 50 (the EQ takes the other half). */
const knob = (db: number) => clampStep(50 + (db / 2) * STEPS_PER_DB, 25, 75);
const eqBand = (db: number) => clampStep((db / 2) * STEPS_PER_DB, -20, 20);

function ampBlock(a: GuitarAnalysis, choice: AmpChoice): ProposedBlock {
  const { gain, tone } = a;
  const values: Record<string, number> = {
    Gain: ampGain(gain.gainClass, gain.score),
    Bass: knob(tone.bassDb),
    Middle: knob(tone.midDb),
    Treble: knob(tone.trebleDb),
    PRES: knob(tone.presenceDb),
    Tone: knob(tone.trebleDb),
    "Tone Cut": clampStep(50 - (tone.trebleDb / 2) * STEPS_PER_DB, 25, 75),
  };
  if (choice.amp === "Dark Twin") values.Bright = 1;
  const why =
    `${GAIN_LABEL[gain.gainClass]} (saturation score ${gain.score.toFixed(2)}): upper harmonics ${fmtDb(gain.hfRatioDb)} against the body, ` +
    `${gain.crestDb.toFixed(1)} dB of pick dynamics. The tone is ${choice.character}, so this amp; its tone stack takes half of the ` +
    `spectrum's difference from a typical guitar (bass ${fmtDb(tone.bassDb)}, mids ${fmtDb(tone.midDb)}, treble ${fmtDb(tone.trebleDb)}).`;
  return withModel("AMP", choice.amp, values, why, gain.confidence);
}

function eqBlock(tone: ToneEstimate): ProposedBlock {
  const values = { "125Hz": eqBand(tone.bassDb), "400Hz": eqBand(tone.lowMidDb), "800Hz": eqBand(tone.midDb), "1.6kHz": eqBand(tone.trebleDb), "4kHz": eqBand(tone.presenceDb) };
  const strongest = Math.max(...Object.values(values).map(Math.abs));
  const block = withModel(
    "EQ",
    "Guitar EQ 1",
    values,
    strongest >= 6
      ? "Shapes the other half of the spectrum's difference from a typical guitar, in five bands (at most ±5 dB). The IR match below measures it properly."
      : "The spectrum is close to a typical guitar, so the EQ stays off.",
    tone.confidence,
  );
  return { ...block, enabled: strongest >= 6 };
}

function delayBlock(a: GuitarAnalysis): ProposedBlock {
  const d = a.delay;
  if (!d.detected || d.confidence < EFFECT_MIN_CONFIDENCE)
    return keepModel("DLY", false, d.detected ? "A possible echo was found, but too uncertain to add (it may be the rhythm of the part)." : "No clear echo in the guitar.", d.confidence);
  const slap = d.timeMs <= 160 && d.feedback < 0.25;
  const name = slap ? "Slapback" : d.dark || d.timeMs > 1000 ? (d.dark && d.timeMs <= 1000 ? "Tape" : "Analog") : "Pure";
  const fb = Math.round(d.feedback * 100);
  const values = { Mix: clampStep((100 * d.level) / (1 + d.level), 5, 60), Time: Math.round(d.timeMs), "F.Back": fb, Feedback: fb };
  const why =
    `Repeats every ${Math.round(d.timeMs)} ms, each about ${Math.round(d.feedback * 100)} % of the one before, the first ${(-20 * Math.log10(d.level + 1e-6)).toFixed(1)} dB under the guitar` +
    (slap ? " (a single short slap)." : d.dark ? "; the repeats lose their highs, like an analog or tape delay." : ".");
  return withModel("DLY", name, values, why, d.confidence);
}

function reverbBlock(a: GuitarAnalysis): ProposedBlock {
  const r = a.reverb;
  if (!r.detected || r.confidence < EFFECT_MIN_CONFIDENCE)
    return keepModel(
      "RVB",
      false,
      r.tails + r.dryOffsets === 0 ? "No note endings to measure a reverb on." : `Notes stop without a clear tail (${r.dryOffsets} dry endings, ${r.tails} with a tail).`,
      r.confidence,
    );
  const name = r.rt60 < 0.7 ? "Room" : r.rt60 < 1.8 ? "Plate" : "Hall";
  const w = 10 ** (r.levelDb / 20);
  const values = { Mix: clampStep((100 * w) / (1 + w), 5, 50), Decay: clampStep(((r.rt60 - 0.3) / 4.7) * 100, 5, 95) };
  const why = `Note endings leave a tail that fades in about ${r.rt60.toFixed(1)} s (RT60), starting ${Math.abs(r.levelDb).toFixed(1)} dB under the note; measured on ${r.tails} endings.`;
  return withModel("RVB", name, values, why, r.confidence);
}

/** Build the proposal. Blocks not listed in the analysis (PRE, MOD, NS) are switched off to keep the audition clean. */
export function proposePreset(a: GuitarAnalysis): Proposal {
  const { gain } = a;
  const choice = chooseAmp(gain.gainClass, gain.score, a.tone);
  const boost = gain.gainClass === "high" && gain.score >= 0.8;
  const amp = ampBlock(a, choice);
  const cab = withModel("CAB", choice.cab, {}, `The cabinet usually paired with this amp. Record your own match below to replace it with an IR.`, gain.confidence * 0.8);
  const blocks: ProposedBlock[] = [
    keepModel("NR", gain.gainClass === "high", gain.gainClass === "high" ? "A gate keeps high gain quiet between notes." : "Not needed at this gain.", gain.confidence),
    keepModel("PRE", false, "Off for the audition.", null),
    boost
      ? withModel("DST", "Green OD", { Gain: 10, Tone: 60, VOL: 75 }, "Very saturated: a low-gain overdrive in front of the amp tightens the low end, the usual way to get there.", gain.confidence * 0.8)
      : keepModel("DST", false, "The amp gives enough drive on its own.", gain.confidence),
    amp,
    cab,
    eqBlock(a.tone),
    keepModel("MOD", false, "Modulation isn't analysed; off for the audition.", null),
    delayBlock(a),
    reverbBlock(a),
    keepModel("NS", false, "No SnapTone in the chain, so the amp model is heard alone.", null),
  ];
  const confidence = 0.4 * gain.confidence + 0.2 * a.tone.confidence + 0.2 * a.delay.confidence + 0.2 * a.reverb.confidence;
  const fx = [blocks[7].enabled ? (blocks[7].title ?? "") + " delay" : null, blocks[8].enabled ? (blocks[8].title ?? "") + " reverb" : null].filter(Boolean);
  const summary = `${GAIN_LABEL[gain.gainClass]}: ${amp.title} into ${cab.title}${fx.length ? `, ${fx.join(" and ")}` : ", no time effects"}.`;
  return { blocks, confidence, summary };
}
