// Effect/model catalog lookups for the GP-5. Data: ./catalog-data.mjs (generated).
import { BLOCKS } from "./protocol.mjs";
import { MODELS, SNAPTONE_PARAMS } from "./catalog-data.mjs";

const byFxid = new Map(MODELS.map((m) => [m.fxid, m]));

/** Model entry for an fxid (SnapTone slots synthesized). */
export function modelByFxid(fxid) {
  const id = fxid >>> 0;
  if (byFxid.has(id)) return byFxid.get(id);
  if (id >>> 24 === 0x0f && (id & 0xffffff) < 80) {
    const n = id & 0xff;
    return { fxid: id, block: "NS", name: `SnapTone ${n}`, title: `Tone Catch ${n + 1}`, type: "SnapTone", params: SNAPTONE_PARAMS };
  }
  return undefined;
}

/** All models available in a block ("AMP", 3, ...). NS returns the 80 SnapTone slots. */
export function modelsForBlock(block) {
  const name = typeof block === "number" ? BLOCKS[block] : String(block).toUpperCase();
  if (name === "NS") return Array.from({ length: 80 }, (_, n) => modelByFxid(0x0f000000 | n));
  return MODELS.filter((m) => m.block === name);
}

/** Case-insensitive search by name or title within a block (or everywhere). */
export function findModel(query, block) {
  const q = String(query).toLowerCase();
  const pool = block === undefined ? MODELS : modelsForBlock(block);
  return pool.find((m) => m.name.toLowerCase() === q || m.title.toLowerCase() === q) ?? pool.find((m) => m.name.toLowerCase().includes(q) || m.title.toLowerCase().includes(q));
}

/** Resolve a parameter of a model by name (e.g. "Gain", "Time") -> { name, index, min, max, ... }. */
export function findParam(fxid, paramName) {
  const m = modelByFxid(fxid);
  if (!m) throw new RangeError(`unknown fxid 0x${(fxid >>> 0).toString(16)}`);
  const q = String(paramName).toLowerCase();
  const p = m.params.find((x) => x.name.toLowerCase() === q);
  if (!p) throw new RangeError(`${m.title} has no param ${paramName}; params: ${m.params.map((x) => x.name).join(", ")}`);
  return p;
}

/** Clamp + snap a value to the parameter's range/step. */
export function clampParam(p, value) {
  let v = Math.min(p.max, Math.max(p.min, Number(value)));
  if (p.toggle) return v >= 0.5 ? 1 : 0;
  if (p.step > 0) v = p.min + Math.round((v - p.min) / p.step) * p.step;
  return Number(v.toFixed(6));
}

/** Default param array (8 slots) for a model, as the pedal loads them on a model change (per Suite data). */
export function defaultParams(fxid) {
  const out = new Array(8).fill(0);
  for (const p of modelByFxid(fxid)?.params ?? []) out[p.index] = p.default;
  return out;
}

/** Human-readable view of a parsed preset (from prst.parsePrst). */
export function describePreset(parsed) {
  return parsed.blocks.map((b) => {
    const m = modelByFxid(b.fxid);
    return {
      block: b.name,
      enabled: b.enabled,
      fxid: `0x${b.fxid.toString(16).padStart(8, "0")}`,
      model: m ? m.title : "unknown",
      params: Object.fromEntries((m?.params ?? []).map((p) => [p.name, b.params[p.index]])),
    };
  });
}

export { MODELS };
