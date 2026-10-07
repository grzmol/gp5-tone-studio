// NAM file check for the GP-5 hand-off (send step 2).
// Valeton Suite imports NAM A1 *standard* WaveNet in the 0.5.x JSON layout; a 0.7.x file hangs its import.
// For the standard WaveNet the two layouts differ only in the config schema; the flat `weights` array
// (head_scale last) is identical, so 0.7 → 0.5.x is a config reshape with weights passed through.
// Schema facts from drewmerc302/nam-a2a1-converter (pipeline/nam_transcode.py) and reference files in
// drewmerc302/valeton-gp50/refs (wavenet_a1_standard.nam: version 0.5.0, 13802 weights).
import type { NamCheck } from "@shared/host/tones";

export class NamCheckError extends Error {
  constructor(detail: string) {
    super(`This file isn't a NAM A1 standard model. Pick another model or report it to the creator. (${detail})`);
    this.name = "NamCheckError";
  }
}

export const NAM_05X_VERSION = "0.5.4";

/** A1 standard: two layer arrays, 16 then 8 channels, head sizes 8 and 1, kernel 3, ten dilations each. */
const STANDARD = [
  { channels: 16, head_size: 8, input_size: 1 },
  { channels: 8, head_size: 1, input_size: 16 },
];

const FILM_KEYS = [
  "conv_pre_film",
  "conv_post_film",
  "activation_pre_film",
  "activation_post_film",
  "input_mixin_pre_film",
  "input_mixin_post_film",
  "layer1x1_post_film",
  "head1x1_post_film",
];

type Json = Record<string, unknown>;

function uniform(values: unknown, what: string): unknown {
  if (!Array.isArray(values)) return values;
  const distinct = new Set(values.map((v) => JSON.stringify(v)));
  if (distinct.size !== 1) throw new NamCheckError(`${what} differs between layers`);
  return values[0];
}

/** One 0.7.x layer-array config → the 0.5.x layer config; refuses features 0.5.x can't express. */
function reshapeLayer(i: number, la: Json): Json {
  for (const k of FILM_KEYS) if ((la[k] as Json | undefined)?.active) throw new NamCheckError(`layer ${i} uses FiLM`);
  if ((la.head1x1 as Json | undefined)?.active) throw new NamCheckError(`layer ${i} uses head1x1`);
  if (la.slimmable != null) throw new NamCheckError(`layer ${i} is slimmable (A2)`);
  if (la.packing != null) throw new NamCheckError(`layer ${i} is packed`);
  if ((la.bottleneck ?? la.channels) !== la.channels) throw new NamCheckError(`layer ${i} has a bottleneck`);
  const gating = (la.gating_mode as unknown[] | undefined) ?? ["none"];
  const secondary = (la.secondary_activation as unknown[] | undefined) ?? [null];
  if (gating.some((g) => g !== "none") || secondary.some((s) => s != null)) throw new NamCheckError(`layer ${i} is gated`);
  const head = la.head as Json | undefined;
  if (!head || typeof head.out_channels !== "number") throw new NamCheckError(`layer ${i} has no head size`);
  if ((head.kernel_size ?? 1) !== 1) throw new NamCheckError(`layer ${i} head kernel is not 1`);
  let activation = uniform(la.activation, "activation");
  if (activation && typeof activation === "object") activation = (activation as Json).type;
  const kernel = "kernel_sizes" in la ? uniform(la.kernel_sizes, "kernel size") : la.kernel_size;
  return {
    input_size: la.input_size,
    condition_size: la.condition_size,
    channels: la.channels,
    head_size: head.out_channels,
    kernel_size: kernel,
    dilations: la.dilations,
    activation,
    gated: false,
    head_bias: Boolean(head.bias),
  };
}

function assertStandard(model: Json): void {
  const config = model.config as Json | undefined;
  const layers = config?.layers as Json[] | undefined;
  if (!Array.isArray(layers) || layers.length !== 2) throw new NamCheckError("expected two layer arrays");
  layers.forEach((la, i) => {
    const want = STANDARD[i];
    if (la.channels !== want.channels || la.head_size !== want.head_size || la.input_size !== want.input_size)
      throw new NamCheckError(`layer ${i} is ${la.channels} channels, not A1 standard`);
    if (la.kernel_size !== 3 || !Array.isArray(la.dilations) || la.dilations.length !== 10) throw new NamCheckError(`layer ${i} has a non-standard receptive field`);
    if (la.gated) throw new NamCheckError(`layer ${i} is gated`);
  });
  if (typeof config?.head_scale !== "number") throw new NamCheckError("missing head_scale");
  if (!Array.isArray(model.weights) || model.weights.length === 0) throw new NamCheckError("no weights");
  if (model.sample_rate !== undefined && model.sample_rate !== 48000) throw new NamCheckError(`${model.sample_rate} Hz, the GP-5 needs 48 kHz`);
}

/**
 * Parse a downloaded .nam, confirm WaveNet A1 standard, reshape 0.7.x → 0.5.x when needed, and validate
 * the result. Returns the JSON text to hand to Valeton Suite.
 */
export function prepareNam(text: string): { json: string; check: NamCheck } {
  let model: Json;
  try {
    model = JSON.parse(text) as Json;
  } catch {
    throw new NamCheckError("not JSON");
  }
  if (model.architecture !== "WaveNet") throw new NamCheckError(`architecture is ${String(model.architecture)}`);
  const version = String(model.version ?? "");
  if (version.startsWith("0.5")) {
    assertStandard(model);
    return { json: text, check: { version, reshaped: false } };
  }
  if (!version.startsWith("0.7")) throw new NamCheckError(`unsupported version ${version || "unknown"}`);
  const config = model.config as Json;
  const layers = config?.layers;
  if (!Array.isArray(layers)) throw new NamCheckError("no layer arrays");
  const out: Json = {
    version: NAM_05X_VERSION,
    architecture: "WaveNet",
    config: { layers: layers.map((la, i) => reshapeLayer(i, la as Json)), head: config.head ?? null, head_scale: config.head_scale },
    weights: model.weights,
    sample_rate: model.sample_rate ?? 48000,
  };
  if (model.metadata !== undefined) out.metadata = model.metadata;
  assertStandard(out);
  return { json: JSON.stringify(out), check: { version, reshaped: true } };
}

/** Minimal RIFF/WAVE sanity check for IR files. */
export function assertWav(buf: Uint8Array): void {
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("This IR isn't a WAV file. Pick another model or report it to the creator.");
}
