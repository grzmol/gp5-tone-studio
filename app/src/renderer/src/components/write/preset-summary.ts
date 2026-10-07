// Read-only summary of a .prst (GP-5 or GP-50) for lists, chain previews and write confirmations.
import { parsePrst, GP50_ONLY_FXIDS } from "@/gp5/lib/prst.mjs";
import { modelByFxid } from "@/gp5/lib/catalog.mjs";
import { BLOCK_CODES, type BlockCode, type ModelInfo, type SlotName } from "@/state/device-types";

export interface SummaryBlock {
  index: number;
  code: BlockCode;
  enabled: boolean;
  fxid: number;
  model: ModelInfo | undefined;
  params: number[];
}

export interface PresetSummary {
  device: "gp5" | "gp50";
  name: string;
  /** Storage order NR..NS */
  blocks: SummaryBlock[];
  /** Chain order (block indices) */
  order: number[];
  volume: number;
  bpm: number;
  footswitches: { fs1: number[]; fs2: number[] };
  /** Blocks whose model only exists on the GP-50, e.g. "PRE (PRE C-Wah)"; dropped when converting */
  gp50Only: string[];
}

const NS = 9;
const AMP = 3;

const cache = new WeakMap<Uint8Array, PresetSummary | null>();

/** Parse once per byte array; null when the bytes are not a valid preset. */
export function summarize(prst: Uint8Array): PresetSummary | null {
  if (cache.has(prst)) return cache.get(prst)!;
  let out: PresetSummary | null = null;
  try {
    const p = parsePrst(prst);
    const gp50Only: string[] = [];
    const blocks = p.blocks.map((b: { enabled: boolean; fxid: number; params: number[] }, index: number) => {
      const fxid = b.fxid >>> 0;
      const only = (GP50_ONLY_FXIDS as Record<number, string>)[fxid];
      if (only) gp50Only.push(`${BLOCK_CODES[index]} (${only})`);
      return { index, code: BLOCK_CODES[index], enabled: b.enabled, fxid, model: modelByFxid(fxid) as ModelInfo | undefined, params: b.params };
    });
    out = {
      device: p.device,
      name: p.name,
      blocks,
      order: p.order,
      volume: p.settings.volume,
      bpm: p.settings.bpm,
      footswitches: { fs1: p.footswitches.fs1, fs2: p.footswitches.fs2 },
      gp50Only,
    };
  } catch {
    out = null;
  }
  cache.set(prst, out);
  return out;
}

/** SnapTone slot (0-based) for an NS fxid ("Tone Catch N" = slot N−1). */
export function snapToneIndex(fxid: number): number | null {
  return fxid >>> 24 === 0x0f ? fxid & 0xff : null;
}

/**
 * The "Amp or SnapTone" column: with NS on, the SnapTone slot name (user names when read), otherwise the amp.
 */
export function ampOrSnapTone(s: PresetSummary, snapTones: SlotName[] | null): { kind: "snaptone" | "amp"; title: string } | null {
  const ns = s.blocks[NS];
  if (ns.enabled) {
    const idx = snapToneIndex(ns.fxid);
    const named = idx === null ? undefined : snapTones?.find((t) => t.slot === idx)?.name;
    return { kind: "snaptone", title: named || ns.model?.title || "SnapTone" };
  }
  const amp = s.blocks[AMP];
  return amp.model ? { kind: "amp", title: amp.model.title } : null;
}

/** Plain description for confirmations: "Rector Dual V, 7 of 10 blocks on". */
export function describeSummary(s: PresetSummary, snapTones: SlotName[] | null): string {
  const lead = ampOrSnapTone(s, snapTones)?.title;
  const on = s.blocks.filter((b) => b.enabled).length;
  return [lead, `${on} of 10 blocks on`].filter(Boolean).join(", ");
}
