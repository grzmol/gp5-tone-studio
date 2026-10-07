import type { CSSProperties } from "react";
import type { ParamInfo } from "@/state/device-types";

/** One control printed on a drawing. Values are in display units. */
export interface GearKnob {
  /** Stable key, passed back to onKnobChange (Rig uses the catalog param index) */
  id: string;
  /** Label as the catalog names it ("Gain", "VOL", "1.6kHz") */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Renders as a switch (catalog toggle params: +3dB, Bright, Trail…) */
  toggle?: boolean;
}

export interface GearBaseProps {
  /** Model name printed on the device */
  name: string;
  /** Engaged (default true); bypassed gear dims its LED */
  on?: boolean;
  knobs?: GearKnob[];
  /** Adds the accessible control layer */
  interactive?: boolean;
  /** Control layer present but read-only (disconnected) */
  disabled?: boolean;
  /** Print values under the knob labels */
  showValues?: boolean;
  /** Knob id drawn focused (halo + value bubble) without keyboard focus */
  focus?: string;
  onKnobChange?: (id: string, value: number) => void;
  /** Footswitch / power switch */
  onToggleOn?: (on: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

const LONG: Record<string, string> = {
  VOL: "Volume",
  PRES: "Presence",
  THRE: "Threshold",
  "F.Back": "Feedback",
  "P.Delay": "Pre-delay",
  "H-VOL": "High volume",
  "L-VOL": "Low volume",
  "S-Depth": "Spring depth",
  "S-Rate": "Spring rate",
  "R-Mix": "Reverb mix",
  Char: "Character",
};

/** Readable parameter name for labels read aloud and value captions ("VOL" → "Volume"). */
export const paramTitle = (label: string) => LONG[label] ?? label;

const TOGGLE_RE = /^(\+3dB|Bright|Trail|Sync|Mode|Character|Mute)$/i;

/** Catalog param → GearKnob (the raw catalog entry may carry `toggle: true`). */
export function knobFromParam(p: ParamInfo, value: number): GearKnob {
  const flagged = (p as ParamInfo & { toggle?: boolean }).toggle;
  const toggle = flagged ?? (p.min === 0 && p.max === 1 && (p.step === 1 || TOGGLE_RE.test(p.name)));
  return { id: String(p.index), label: p.name, value, min: p.min, max: p.max, step: p.step, unit: p.unit, toggle };
}
