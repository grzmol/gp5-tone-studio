// Value math for gear knobs and dials: stepping by key, drag and wheel, typed values, display formatting.
// Values are in display units (the catalog's min/max/step, e.g. 20..1000 ms).

export interface ValueSpec {
  min: number;
  max: number;
  /** Smallest increment; 0 or absent means 1 */
  step?: number;
  unit?: string;
}

/** Pixels of vertical drag for the full range (Shift multiplies by FINE_FACTOR). */
export const DRAG_RANGE_PX = 200;
export const FINE_FACTOR = 10;

const stepOf = (s: ValueSpec) => (s.step && s.step > 0 ? s.step : 1);
const decimalsOf = (step: number) => {
  const t = String(step);
  const dot = t.indexOf(".");
  return dot < 0 ? 0 : t.length - dot - 1;
};

/** Clamp into [min, max] and snap to the step grid anchored at min. */
export function clampStep(value: number, spec: ValueSpec): number {
  const step = stepOf(spec);
  if (!Number.isFinite(value)) return spec.min;
  const v = Math.min(spec.max, Math.max(spec.min, value));
  // toFixed first: (2.25 - 0.1) / 0.1 is 21.4999… in floating point and must snap to 22
  const snapped = spec.min + Math.round(Number(((v - spec.min) / step).toFixed(9))) * step;
  return Number(Math.min(spec.max, snapped).toFixed(decimalsOf(step)));
}

/**
 * New value for a key press, or null when the key does not adjust values.
 * Arrows ±1 step (Shift: same), PageUp/PageDown ±10 steps, Home/End the limits.
 */
export function keyValue(key: string, value: number, spec: ValueSpec): number | null {
  const step = stepOf(spec);
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return clampStep(value + step, spec);
    case "ArrowDown":
    case "ArrowLeft":
      return clampStep(value - step, spec);
    case "PageUp":
      return clampStep(value + 10 * step, spec);
    case "PageDown":
      return clampStep(value - 10 * step, spec);
    case "Home":
      return spec.min;
    case "End":
      return spec.max;
    default:
      return null;
  }
}

/** Value after dragging `dy` pixels from a drag that started at `start` (up = positive turn). */
export function dragValue(start: number, dy: number, spec: ValueSpec, fine = false): number {
  const px = DRAG_RANGE_PX * (fine ? FINE_FACTOR : 1);
  return clampStep(start + (-dy / px) * (spec.max - spec.min), spec);
}

/** Value after one wheel event: 1% of the range per notch (at least one step), Shift = one step. */
export function wheelValue(value: number, deltaY: number, spec: ValueSpec, fine = false): number {
  if (deltaY === 0) return value;
  const step = stepOf(spec);
  const notch = fine ? step : Math.max(step, Math.round((spec.max - spec.min) / 100 / step) * step);
  return clampStep(value + (deltaY < 0 ? notch : -notch), spec);
}

/** Parse a typed value ("320", "320 ms", "-3,5"); null when not a number. */
export function parseTyped(text: string, spec: ValueSpec): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text.trim());
  if (!m) return null;
  return clampStep(Number(m[0].replace(",", ".")), spec);
}

/** Display string without unit, using the step's decimals. */
export function formatValue(value: number, spec: ValueSpec): string {
  return value.toFixed(decimalsOf(stepOf(spec)));
}

/** Value text for assistive tech, e.g. "320 ms". */
export function valueText(value: number, spec: ValueSpec): string {
  return spec.unit ? `${formatValue(value, spec)} ${spec.unit}` : formatValue(value, spec);
}
