import type { BlockState } from "@/state/device-types";
import { AmpHead, Cab } from "./Amp";
import { Capture, EqPedal } from "./EqPedal";
import { Pedal } from "./Pedal";
import { knobFromParam, type GearBaseProps, type GearKnob } from "./types";

/** Knobs of a block from its catalog params (values in display units). */
export function knobsForBlock(block: BlockState): GearKnob[] {
  return (block.model?.params ?? []).map((p) => knobFromParam(p, block.params[p.index] ?? p.default));
}

/** Display name of a block's model (catalog title), or a fallback for fxids missing from the catalog. */
export function modelTitle(block: BlockState): string {
  return block.model?.title ?? `Unknown ${block.code} model`;
}

export interface GearForProps extends Omit<GearBaseProps, "name" | "knobs" | "on" | "onKnobChange"> {
  block: BlockState;
  /** Called with the catalog param index and the new value */
  onParam?: (paramIndex: number, value: number) => void;
}

/** The drawing for any GP-5 block: pedal, EQ, capture (NS), amp head or cab. */
export function GearFor({ block, onParam, ...rest }: GearForProps) {
  const name = modelTitle(block);
  const knobs = knobsForBlock(block);
  const onKnobChange = onParam && ((id: string, v: number) => onParam(Number(id), v));
  const common = { name, knobs, on: block.enabled, onKnobChange, ...rest };
  switch (block.code) {
    case "NS":
      return <Capture {...common} />;
    case "EQ":
      return <EqPedal {...common} />;
    case "AMP":
      return <AmpHead {...common} type={block.model?.type} />;
    case "CAB":
      return <Cab name={name} className={rest.className} style={rest.style} />;
    default:
      return <Pedal {...common} block={block.code} />;
  }
}
