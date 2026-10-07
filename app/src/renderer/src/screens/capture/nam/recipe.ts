// Versions are recipes on top of the original file: metadata, level, size (lossless) and shaping (heard in the
// audition and kept for the GP-5 conversion; never written into the A2 file).
import type { CaptureRecipe, CaptureSize, Shaping } from "@shared/host/capture";
import { editableMetadata, inspectNam, withMetadata, withOutputGain, withSize, type NamFile, type NamInfo, type TextField } from "./model";
import { FLAT_SHAPING, SHAPING_RANGES } from "./shaping";

export const LOUDNESS_TARGETS = [-14, -18, -23] as const;
export const TRIM_RANGE = { min: -24, max: 24, step: 0.5 };

/** Recipe of the original file (version 0). */
export function originalRecipe(file: NamFile): CaptureRecipe {
  return { metadata: editableMetadata(file), trimDb: 0, loudnessTarget: null, size: "both", shaping: { ...FLAT_SHAPING } };
}

/** Output change in dB: the loudness match (when the file reports its loudness) plus the trim. */
export function levelGainDb(recipe: Pick<CaptureRecipe, "trimDb" | "loudnessTarget">, loudness: number | null): number {
  const match = recipe.loudnessTarget !== null && loudness !== null ? recipe.loudnessTarget - loudness : 0;
  return match + recipe.trimDb;
}

/** The lossless file a recipe describes: metadata, output level, sizes. Shaping is not part of it. */
export function applyRecipe(file: NamFile, recipe: CaptureRecipe, info: NamInfo = inspectNam(file)): NamFile {
  let out = withMetadata(file, recipe.metadata);
  const gain = levelGainDb(recipe, info.loudness);
  if (gain !== 0) out = withOutputGain(out, gain);
  if (recipe.size !== "both") out = withSize(out, recipe.size);
  return out;
}

export const recipesEqual = (a: CaptureRecipe, b: CaptureRecipe) => JSON.stringify(a) === JSON.stringify(b);

const FIELD_LABEL: Record<TextField | "input_level_dbu" | "output_level_dbu", string> = {
  name: "name",
  modeled_by: "modeled by",
  gear_make: "gear make",
  gear_model: "gear model",
  gear_type: "gear type",
  tone_type: "tone type",
  input_level_dbu: "input calibration",
  output_level_dbu: "output calibration",
};

export const SIZE_LABEL: Record<CaptureSize, string> = { both: "Both sizes", full: "Full only", lite: "Lite only" };

export const fmtDb = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Number(Math.abs(db).toFixed(1))} dB`;
export const fmtHz = (hz: number) => (hz >= 1000 ? `${Number((hz / 1000).toFixed(1))} kHz` : `${Math.round(hz)} Hz`);

const SHAPING_LABEL: Record<keyof Shaping, (v: number) => string> = {
  driveDb: (v) => `input drive ${fmtDb(v)}`,
  lowCutHz: (v) => (v <= SHAPING_RANGES.lowCutHz.min ? "low cut off" : `low cut ${fmtHz(v)}`),
  tightPct: (v) => `tight ${Math.round(v)} %`,
  bassDb: (v) => `bass ${fmtDb(v)}`,
  midDb: (v) => `mid ${fmtDb(v)}`,
  trebleDb: (v) => `treble ${fmtDb(v)}`,
  highCutHz: (v) => (v >= SHAPING_RANGES.highCutHz.max ? "high cut off" : `high cut ${fmtHz(v)}`),
};

/** One line for the versions list: what `next` changes compared with `prev`. */
export function summarize(prev: CaptureRecipe, next: CaptureRecipe): string {
  const parts: string[] = [];
  const meta = (Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]).filter((k) => prev.metadata[k] !== next.metadata[k]);
  if (meta.includes("name")) parts.push(next.metadata.name ? `renamed to “${next.metadata.name}”` : "removed the name");
  const otherMeta = meta.filter((k) => k !== "name").map((k) => FIELD_LABEL[k]);
  if (otherMeta.length) parts.push(`set ${joinWords(otherMeta)}`);
  if (prev.loudnessTarget !== next.loudnessTarget) {
    parts.push(next.loudnessTarget === null ? "loudness match off" : `matched loudness to ${fmtDb(next.loudnessTarget)}`);
  }
  if (prev.trimDb !== next.trimDb) parts.push(`output trim ${fmtDb(next.trimDb)}`);
  if (prev.size !== next.size) parts.push(SIZE_LABEL[next.size].toLowerCase());
  const shaping = (Object.keys(SHAPING_LABEL) as (keyof Shaping)[]).filter((k) => prev.shaping[k] !== next.shaping[k]);
  if (shaping.length) parts.push(shaping.map((k) => SHAPING_LABEL[k](next.shaping[k])).join(", "));
  if (!parts.length) return "No changes";
  const line = parts.join("; ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function joinWords(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

