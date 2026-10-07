// NAM `.nam` JSON: parse, inspect, lossless transforms, serialize. Pure (no I/O), see design/nam-a2.md.
// A2 = `SlimmableContainer` (NAM 0.7.x) holding one WaveNet per size (max_value 0.5 = Lite, 1.0 = Full).
// A1 = a single `WaveNet` (0.5.x layout: `kernel_size`, `head_size` per layer array).
import type { CaptureMetadata, CaptureSize } from "@shared/host/capture";

export type JsonObject = { [key: string]: unknown };

/** A parsed `.nam` file. Unknown fields are kept verbatim so serialize(parse(x)) loses nothing. */
export interface NamFile extends JsonObject {
  version: string;
  architecture: string;
  config: JsonObject;
  weights: number[];
  metadata?: NamMetadata;
  sample_rate?: number;
}

export interface NamMetadata extends JsonObject {
  name?: string;
  modeled_by?: string;
  gear_make?: string;
  gear_model?: string;
  gear_type?: string;
  tone_type?: string;
  loudness?: number;
  gain?: number;
  input_level_dbu?: number;
  output_level_dbu?: number;
}

export class NamParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NamParseError";
  }
}

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse `.nam` text. Throws NamParseError with a user-facing message when it isn't a NAM model. */
export function parseNam(text: string): NamFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new NamParseError("This file isn't valid JSON, so it can't be a NAM capture.");
  }
  if (!isObject(raw) || typeof raw.architecture !== "string" || !isObject(raw.config) || !Array.isArray(raw.weights)) {
    throw new NamParseError("This file isn't a NAM capture (no architecture, config or weights).");
  }
  if (typeof raw.version !== "string") throw new NamParseError("This NAM file has no format version.");
  if (raw.architecture === "SlimmableContainer") {
    const subs = raw.config.submodels;
    if (!Array.isArray(subs) || subs.length === 0) throw new NamParseError("This A2 file has no submodels.");
    for (const s of subs) {
      if (!isObject(s) || typeof s.max_value !== "number" || !isObject(s.model) || !Array.isArray(s.model.weights)) {
        throw new NamParseError("This A2 file has a submodel we can't read.");
      }
    }
  }
  if (raw.metadata !== undefined && !isObject(raw.metadata)) throw new NamParseError("This NAM file's metadata isn't an object.");
  return raw as NamFile;
}

/** Serialize to `.nam` text. Numbers keep full double precision (shortest round-trip form). */
export function serializeNam(file: NamFile): string {
  return JSON.stringify(file);
}

// ---------------------------------------------------------------------------------------------- inspect

export type SubmodelSize = "full" | "lite";

export interface SubmodelInfo {
  index: number;
  size: SubmodelSize;
  maxValue: number;
  params: number;
  /** Channels of the first layer array */
  channels: number | null;
  receptiveField: number | null;
  loudness: number | null;
}

export type A1Size = "standard" | "lite" | "feather" | "nano" | "custom";

export type NamArch =
  | { kind: "A2"; submodels: SubmodelInfo[] }
  | { kind: "A1"; size: A1Size; params: number; receptiveField: number | null; layout: "0.5" | "0.7" }
  | { kind: "other"; architecture: string };

export interface NamInfo {
  version: string;
  arch: NamArch;
  sampleRate: number | null;
  /** Total weights in the file (all sizes) */
  params: number;
  /** Receptive field in samples of the largest model, when computable */
  receptiveField: number | null;
  loudness: number | null;
  gain: number | null;
  inputLevelDbu: number | null;
  outputLevelDbu: number | null;
  /** A2 options a distiller would have to support (FiLM, gating, grouping) */
  features: string[];
  /** Output level can be changed losslessly (head_scale is the last weight of every WaveNet) */
  levelEditable: boolean;
  /** Why this capture can't be made GP-5 ready (null when it could be) */
  unsupported: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Receptive field of a WaveNet config in samples: 1 + Σ (k − 1)·d over every layer, + head kernel − 1. */
export function receptiveField(config: JsonObject): number | null {
  const layers = config.layers;
  if (!Array.isArray(layers)) return null;
  let rf = 1;
  for (const l of layers) {
    if (!isObject(l) || !Array.isArray(l.dilations)) return null;
    const dil = l.dilations as unknown[];
    const ks = Array.isArray(l.kernel_sizes) ? (l.kernel_sizes as unknown[]) : null;
    for (let i = 0; i < dil.length; i++) {
      const d = num(dil[i]);
      const k = ks ? num(ks[i]) : num(l.kernel_size);
      if (d === null || k === null) return null;
      rf += (k - 1) * d;
    }
    if (isObject(l.head) && num(l.head.kernel_size) !== null) rf += (l.head.kernel_size as number) - 1;
  }
  return rf;
}

function firstChannels(config: JsonObject): number | null {
  const layers = config.layers;
  return Array.isArray(layers) && isObject(layers[0]) ? num(layers[0].channels) : null;
}

/** NAM A2 options the A1 trainer can't reproduce, named for people. */
function a2Features(config: JsonObject): string[] {
  const found = new Set<string>();
  const layers = Array.isArray(config.layers) ? config.layers : [];
  for (const l of layers) {
    if (!isObject(l)) continue;
    for (const [key, v] of Object.entries(l)) {
      if (key.endsWith("_film") && isObject(v) && v.active === true) found.add("FiLM conditioning");
    }
    if (Array.isArray(l.gating_mode) && l.gating_mode.some((g) => g !== "none" && g !== null)) found.add("gating");
    if ((num(l.groups_input) ?? 1) > 1 || (num(l.groups_input_mixin) ?? 1) > 1) found.add("grouped convolutions");
    if (isObject(l.layer1x1) && (num(l.layer1x1.groups) ?? 1) > 1) found.add("grouped convolutions");
  }
  return [...found];
}

/** The last weight of a WaveNet is its head_scale (NAM core reads it from there). */
function headScaleMatches(model: JsonObject): boolean {
  if (model.architecture !== "WaveNet" || !isObject(model.config) || !Array.isArray(model.weights)) return false;
  const hs = num(model.config.head_scale);
  const last = num(model.weights[model.weights.length - 1]);
  if (hs === null || last === null || hs === 0) return false;
  return Math.abs(last - hs) <= Math.abs(hs) * 1e-5;
}

function a1Size(config: JsonObject): A1Size {
  const layers = Array.isArray(config.layers) ? config.layers : [];
  const ch = layers.map((l) => (isObject(l) ? num(l.channels) : null));
  if (ch.length !== 2) return "custom";
  const sizes: [A1Size, number, number][] = [
    ["standard", 16, 8],
    ["lite", 12, 6],
    ["feather", 8, 4],
    ["nano", 4, 2],
  ];
  return sizes.find(([, a, b]) => ch[0] === a && ch[1] === b)?.[0] ?? "custom";
}

/** Sizes are relative: the submodel with the highest max_value is Full, every other one is Lite. */
function submodelsOf(file: NamFile): JsonObject[] {
  return file.architecture === "SlimmableContainer" ? (file.config.submodels as JsonObject[]) : [];
}

export function inspectNam(file: NamFile): NamInfo {
  const meta = file.metadata ?? {};
  const sampleRate = num(file.sample_rate);
  let arch: NamArch;
  let receptive: number | null = null;
  let features: string[] = [];
  let levelEditable = false;

  if (file.architecture === "SlimmableContainer") {
    const subs = submodelsOf(file);
    const maxTop = Math.max(...subs.map((s) => s.max_value as number));
    const infos: SubmodelInfo[] = subs.map((s, index) => {
      const model = s.model as JsonObject;
      const config = isObject(model.config) ? model.config : {};
      const subMeta = isObject(model.metadata) ? model.metadata : {};
      features.push(...a2Features(config));
      return {
        index,
        size: (s.max_value as number) === maxTop ? "full" : "lite",
        maxValue: s.max_value as number,
        params: (model.weights as unknown[]).length,
        channels: firstChannels(config),
        receptiveField: receptiveField(config),
        loudness: num(subMeta.loudness),
      };
    });
    features = [...new Set(features)];
    arch = { kind: "A2", submodels: infos };
    receptive = Math.max(...infos.map((i) => i.receptiveField ?? 0)) || null;
    levelEditable = subs.every((s) => headScaleMatches(s.model as JsonObject));
  } else if (file.architecture === "WaveNet") {
    receptive = receptiveField(file.config);
    const layers = Array.isArray(file.config.layers) ? file.config.layers : [];
    const layout = layers.some((l) => isObject(l) && Array.isArray(l.kernel_sizes)) ? "0.7" : "0.5";
    arch = { kind: "A1", size: a1Size(file.config), params: file.weights.length, receptiveField: receptive, layout };
    levelEditable = headScaleMatches(file);
  } else {
    arch = { kind: "other", architecture: file.architecture };
  }

  const params = arch.kind === "A2" ? arch.submodels.reduce((n, s) => n + s.params, 0) : file.weights.length;

  let unsupported: string | null = null;
  if (arch.kind === "other") unsupported = "This file uses a custom NAM layout we can't read.";
  else if (sampleRate !== null && sampleRate !== 48000) {
    unsupported = `This capture is ${formatKhz(sampleRate)}. The GP-5 needs 48 kHz captures.`;
  } else if (features.length) {
    unsupported = `This A2 uses features (${features.join(", ")}) the trainer can't turn into an A1 yet.`;
  }

  return {
    version: file.version,
    arch,
    sampleRate,
    params,
    receptiveField: receptive,
    loudness: num(meta.loudness),
    gain: num(meta.gain),
    inputLevelDbu: num(meta.input_level_dbu),
    outputLevelDbu: num(meta.output_level_dbu),
    features,
    levelEditable,
    unsupported,
  };
}

export const formatKhz = (hz: number) => `${Number((hz / 1000).toFixed(1))} kHz`;

// ---------------------------------------------------------------------------------------------- transforms

const clone = <T>(v: T): T => structuredClone(v);

/** The text metadata fields a person can edit (Info tab). Empty string = removed from the file. */
export const TEXT_FIELDS = ["name", "modeled_by", "gear_make", "gear_model", "gear_type", "tone_type"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export function editableMetadata(file: NamFile): CaptureMetadata {
  const m = file.metadata ?? {};
  const text = (k: TextField) => (typeof m[k] === "string" ? (m[k] as string) : "");
  return {
    name: text("name"),
    modeled_by: text("modeled_by"),
    gear_make: text("gear_make"),
    gear_model: text("gear_model"),
    gear_type: text("gear_type"),
    tone_type: text("tone_type"),
    input_level_dbu: num(m.input_level_dbu),
    output_level_dbu: num(m.output_level_dbu),
  };
}

/** Rewrite the editable metadata fields; every other metadata field (date, loudness, training…) stays. */
export function withMetadata(file: NamFile, edits: CaptureMetadata): NamFile {
  const out = clone(file);
  const meta: NamMetadata = { ...(out.metadata ?? {}) };
  for (const k of TEXT_FIELDS) {
    const v = edits[k].trim();
    if (v) meta[k] = v;
    else delete meta[k];
  }
  for (const k of ["input_level_dbu", "output_level_dbu"] as const) {
    const v = edits[k];
    if (v === null || !Number.isFinite(v)) delete meta[k];
    else meta[k] = v;
  }
  out.metadata = meta;
  return out;
}

export class NamTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NamTransformError";
  }
}

function scaleWaveNet(model: JsonObject, g: number, db: number) {
  if (!headScaleMatches(model)) throw new NamTransformError("The output level of this model can't be changed losslessly.");
  const config = model.config as JsonObject;
  const weights = model.weights as number[];
  config.head_scale = (config.head_scale as number) * g;
  weights[weights.length - 1] = weights[weights.length - 1] * g;
  if (isObject(model.metadata) && num(model.metadata.loudness) !== null) {
    model.metadata.loudness = (model.metadata.loudness as number) + db;
  }
}

/**
 * Lossless output-level change: scale `head_scale` in config and the last weight of every WaveNet by
 * g = 10^(dB/20), and move `metadata.loudness` by the same dB.
 */
export function withOutputGain(file: NamFile, db: number): NamFile {
  if (db === 0) return clone(file);
  const out = clone(file);
  const g = 10 ** (db / 20);
  if (out.architecture === "SlimmableContainer") {
    for (const s of submodelsOf(out)) scaleWaveNet(s.model as JsonObject, g, db);
    if (out.metadata && num(out.metadata.loudness) !== null) out.metadata.loudness = (out.metadata.loudness as number) + db;
  } else if (out.architecture === "WaveNet") {
    scaleWaveNet(out, g, db); // a bare WaveNet's own metadata is the file's metadata
  } else {
    throw new NamTransformError("The output level of this model can't be changed losslessly.");
  }
  return out;
}

/**
 * Keep one size of an A2 file. The result is still a SlimmableContainer; the kept submodel answers every
 * slimmable size (max_value 1.0), so hosts that ask for "full" or "lite" both get it.
 */
export function withSize(file: NamFile, size: CaptureSize): NamFile {
  const out = clone(file);
  if (size === "both" || out.architecture !== "SlimmableContainer") return out;
  const info = inspectNam(file);
  if (info.arch.kind !== "A2") return out;
  const keep = info.arch.submodels.find((s) => s.size === size);
  if (!keep) throw new NamTransformError(`This file has no ${size === "full" ? "Full" : "Lite"} size.`);
  const sub = clone(submodelsOf(file)[keep.index]);
  sub.max_value = 1.0;
  out.config = { ...out.config, submodels: [sub] };
  return out;
}

/** Loudness in dB of each size as the file reports it (submodel metadata, falling back to the file's). */
export function loudnessOf(info: NamInfo, size: SubmodelSize | "a1"): number | null {
  if (info.arch.kind === "A2") return info.arch.submodels.find((s) => s.size === size)?.loudness ?? info.loudness;
  return info.loudness;
}
