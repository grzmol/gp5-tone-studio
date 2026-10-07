import type { BlockState, SlotName } from "@/state/device-types";

/** SnapTone slot (0–79) of an NS fxid. */
export const snapToneIndex = (fxid: number) => fxid & 0xffffff;

/** "54 PNTR-CWBYS" from the pedal's SnapTone names when read, else the catalog title ("Tone Catch 55"). */
export function snapToneName(block: BlockState, snapTones: SlotName[] | null): string {
  const n = snapToneIndex(block.fxid);
  const name = snapTones?.find((s) => s.slot === n)?.name;
  return name ? `${n} ${name}` : (block.model?.title ?? `SnapTone ${n}`);
}
