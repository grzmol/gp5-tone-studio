import type { BlockCode, ParamInfo, PresetState } from "@/state/device-types";

/** One row of the unsaved-changes table (overlays.md B): Block, Parameter, Saved, Now. */
export interface ChangeRow {
  /** null for preset-wide rows (chain order, volume, footswitches) */
  block: { code: BlockCode; model: string } | null;
  parameter: string;
  saved: string;
  now: string;
}

const formatValue = (info: ParamInfo | undefined, v: number): string => {
  if (info?.options?.[v] !== undefined) return info.options[v];
  const n = Math.round(v * 10) / 10;
  return info?.unit ? `${n} ${info.unit}` : String(n);
};

/** Differences between the live preset and the saved one, in chain-storage order. */
export function diffPresets(saved: PresetState, now: PresetState): ChangeRow[] {
  const rows: ChangeRow[] = [];
  now.blocks.forEach((b, i) => {
    const s = saved.blocks[i];
    if (!s) return;
    const block = { code: b.code, model: b.model?.title ?? s.model?.title ?? "Unknown model" };
    if (s.fxid !== b.fxid) {
      rows.push({ block, parameter: "Model", saved: s.model?.title ?? "Unknown model", now: b.model?.title ?? "Unknown model" });
    } else {
      b.params.forEach((v, p) => {
        if (v === s.params[p]) return;
        const info = b.model?.params.find((x) => x.index === p);
        rows.push({ block, parameter: info?.name ?? `Parameter ${p + 1}`, saved: formatValue(info, s.params[p]), now: formatValue(info, v) });
      });
    }
    if (s.enabled !== b.enabled) rows.push({ block, parameter: "On/off", saved: s.enabled ? "On" : "Off", now: b.enabled ? "On" : "Off" });
  });
  if (saved.order.join() !== now.order.join()) rows.push({ block: null, parameter: "Chain order", saved: "", now: "Changed" });
  if (saved.volume !== now.volume) rows.push({ block: null, parameter: "Volume", saved: String(saved.volume), now: String(now.volume) });
  if (saved.footswitches.fs1.join() !== now.footswitches.fs1.join() || saved.footswitches.fs2.join() !== now.footswitches.fs2.join())
    rows.push({ block: null, parameter: "Footswitches", saved: "", now: "Changed" });
  return rows;
}
