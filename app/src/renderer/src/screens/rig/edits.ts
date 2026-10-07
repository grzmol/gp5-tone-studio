// Rig edit actions: every user edit goes through here so it lands in the undo history, then plays on the pedal
// through the device store (live edits) or changes the preset locally (order, footswitches).
import { defaultParams } from "@/gp5/lib/catalog.mjs";
import { useDevice } from "@/state/device";
import type { BlockState, PresetState } from "@/state/device-types";
import { invert, useHistory, type BlockSnapshot, type Edit } from "./history";

const dev = () => useDevice.getState();

export const snapshot = (b: BlockState): BlockSnapshot => ({ index: b.index, fxid: b.fxid, enabled: b.enabled, params: [...b.params] });

export function editParam(block: number, index: number, value: number) {
  const p = dev().preset;
  if (!p) return;
  const from = p.blocks[block].params[index];
  dev().setParam(block, index, value);
  const to = dev().preset?.blocks[block].params[index] ?? value;
  if (to !== from) useHistory.getState().record({ kind: "param", block, index, from, to, at: performance.now() });
}

export function editEnabled(block: number, on: boolean) {
  const p = dev().preset;
  if (!p || p.blocks[block].enabled === on) return;
  dev().setBlockEnabled(block, on);
  useHistory.getState().record({ kind: "enabled", block, from: !on, to: on });
}

export function editOrder(order: number[]) {
  const p = dev().preset;
  if (!p) return;
  const from = [...p.order];
  dev().setOrder(order);
  useHistory.getState().record({ kind: "order", from, to: [...order] });
}

export function editVolume(volume: number) {
  const p = dev().preset;
  if (!p || p.volume === volume) return;
  const from = p.volume;
  dev().setVolume(volume);
  useHistory.getState().record({ kind: "volume", from, to: volume, at: performance.now() });
}

export function editFootswitches(fs: { fs1: number[]; fs2: number[] }) {
  const p = dev().preset;
  if (!p) return;
  const from = { fs1: [...p.footswitches.fs1], fs2: [...p.footswitches.fs2] };
  dev().setFootswitches(fs);
  useHistory.getState().record({ kind: "footswitches", from, to: fs });
}

/** Toggle `block` in FS1 or FS2. */
export function toggleFootswitch(which: "fs1" | "fs2", block: number) {
  const p = dev().preset;
  if (!p) return;
  const list = p.footswitches[which];
  const next = list.includes(block) ? list.filter((b) => b !== block) : [...list, block].sort((a, b) => a - b);
  editFootswitches({ ...p.footswitches, [which]: next });
}

/**
 * Put a block back to `target` with live edits: model (the pedal loads its defaults), then every catalog param
 * that differs, then on/off.
 */
export async function applyBlock(target: BlockSnapshot) {
  let cur = dev().preset?.blocks[target.index];
  if (!cur) return;
  if (cur.fxid !== target.fxid) {
    await dev().setModel(target.index, target.fxid);
    cur = dev().preset?.blocks[target.index];
    if (!cur) return;
  }
  for (const p of cur.model?.params ?? []) if (Math.abs(cur.params[p.index] - target.params[p.index]) > 1e-3) dev().setParam(target.index, p.index, target.params[p.index]);
  if (cur.enabled !== target.enabled) dev().setBlockEnabled(target.index, target.enabled);
}

/** Record a whole-block change made elsewhere (model picker keep). */
export function recordBlock(label: string, from: BlockSnapshot, to: BlockSnapshot) {
  if (from.fxid === to.fxid && from.enabled === to.enabled && from.params.every((v, i) => Math.abs(v - to.params[i]) < 1e-3)) return;
  useHistory.getState().record({ kind: "block", label, from, to });
}

/** Apply a whole-block change and record it (paste settings, reset to defaults). */
export async function editBlock(label: string, to: BlockSnapshot) {
  const cur = dev().preset?.blocks[to.index];
  if (!cur) return;
  const from = snapshot(cur);
  await applyBlock(to);
  const after = dev().preset?.blocks[to.index];
  if (after) recordBlock(label, from, snapshot(after));
}

export function resetToDefaults(block: BlockState) {
  return editBlock("Reset to defaults", { ...snapshot(block), params: defaultParams(block.fxid) });
}

/** Apply an edit as described (redo) — the caller inverts it for undo. */
async function apply(e: Edit) {
  switch (e.kind) {
    case "param":
      return dev().setParam(e.block, e.index, e.to);
    case "enabled":
      return dev().setBlockEnabled(e.block, e.to);
    case "order":
      return dev().setOrder(e.to);
    case "volume":
      return dev().setVolume(e.to);
    case "footswitches":
      return dev().setFootswitches(e.to);
    case "block":
      return applyBlock(e.to);
  }
}

export async function undo() {
  const e = useHistory.getState().takeUndo();
  if (e) await apply(invert(e));
}

export async function redo() {
  const e = useHistory.getState().takeRedo();
  if (e) await apply(e);
}

/**
 * Play `target` on the pedal with live edits (Compare with saved). Order has no live command, so it is left as
 * is; volume and every block are applied.
 */
export async function playPreset(target: PresetState) {
  for (const b of target.blocks) await applyBlock(snapshot(b));
  if (dev().preset?.volume !== target.volume) dev().setVolume(target.volume);
}
