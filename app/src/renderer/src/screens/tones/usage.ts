import { parsePrst } from "@/gp5/lib/prst.mjs";

/** GP-5 storage block indices and the fxid ranges that point at pedal slots. */
const CAB = 4;
const NS = 9;
const SNAPTONE_BASE = 0x0f000000;
const USER_IR_BASE = 0x0a100000;

export interface PresetRef {
  slot: number;
  name: string;
}

export interface UsageIndex {
  /** SnapTone slot (0–79) → presets whose engaged NS block plays it */
  snaptone: Map<number, PresetRef[]>;
  /** User IR slot (0–19) → presets whose engaged CAB block plays it */
  ir: Map<number, PresetRef[]>;
}

/** Which pedal slot a block's fxid points at, if any. */
export function slotOfFxid(fxid: number): { kind: "snaptone" | "ir"; slot: number } | null {
  const id = fxid >>> 0;
  if (id >>> 24 === SNAPTONE_BASE >>> 24 && (id & 0xffffff) < 80) return { kind: "snaptone", slot: id & 0xff };
  if (id >= USER_IR_BASE && id < USER_IR_BASE + 20) return { kind: "ir", slot: id - USER_IR_BASE };
  return null;
}

/**
 * Index which presets use which SnapTone / User IR slot. A SnapTone counts only when NS is engaged: a
 * bypassed NS block still stores some SnapTone number the preset never plays. A User IR counts whenever
 * CAB selects it, because an engaged SnapTone bypasses CAB and the IR comes back when NS is off.
 */
export function buildUsage(presets: { slot: number | null; name: string; prst: Uint8Array }[]): UsageIndex {
  const index: UsageIndex = { snaptone: new Map(), ir: new Map() };
  for (const p of presets) {
    if (p.slot === null || p.slot < 0) continue;
    let blocks: { enabled: boolean; fxid: number }[];
    try {
      blocks = parsePrst(p.prst).blocks;
    } catch {
      continue;
    }
    for (const b of [blocks[NS], blocks[CAB]]) {
      if (!b || (b === blocks[NS] && !b.enabled)) continue;
      const hit = slotOfFxid(b.fxid);
      if (!hit) continue;
      const map = hit.kind === "snaptone" ? index.snaptone : index.ir;
      map.set(hit.slot, [...(map.get(hit.slot) ?? []), { slot: p.slot, name: p.name }]);
    }
  }
  for (const map of [index.snaptone, index.ir]) for (const list of map.values()) list.sort((a, b) => a.slot - b.slot);
  return index;
}
