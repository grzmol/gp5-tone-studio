// Multi-slot write plans (copy, move, swap, clear) as lists of "slot ← content of another slot" steps.
// Only slots whose content changes get a step; everything is read up front, then written one by one.

export interface Step {
  /** Slot that gets written */
  slot: number;
  /** Slot whose current preset goes there, or "blank" for an empty preset */
  from: number | "blank";
}

const SLOTS = 100;

/** Copy `sources` (ascending) into consecutive slots starting at `target`. Null when it would run past slot 99. */
export function copySteps(sources: number[], target: number): Step[] | null {
  if (!sources.length || target < 0 || target + sources.length > SLOTS) return null;
  return sources.map((from, i) => ({ slot: target + i, from })).filter((s) => s.slot !== s.from);
}

/**
 * Move `selected` (ascending) so they sit together from `target` on; the slots in between shift to close the gap,
 * like dragging rows in a list. Null when it would run past slot 99.
 */
export function moveSteps(selected: number[], target: number): Step[] | null {
  const k = selected.length;
  if (!k || target < 0 || target + k > SLOTS) return null;
  const lo = Math.min(selected[0], target);
  const hi = Math.max(selected[k - 1], target + k - 1);
  const rest: number[] = [];
  for (let s = lo; s <= hi; s++) if (!selected.includes(s)) rest.push(s);
  const arranged = [...rest.slice(0, target - lo), ...selected, ...rest.slice(target - lo)];
  return arranged.flatMap((from, i) => (from === lo + i ? [] : [{ slot: lo + i, from }]));
}

export function swapSteps(a: number, b: number): Step[] {
  return a === b ? [] : [
    { slot: a, from: b },
    { slot: b, from: a },
  ];
}

export function clearSteps(slots: number[]): Step[] {
  return slots.map((slot) => ({ slot, from: "blank" as const }));
}

/** Slots whose current content must be read before writing (sources), in ascending order. */
export function slotsToRead(steps: Step[]): number[] {
  return [...new Set(steps.flatMap((s) => (s.from === "blank" ? [] : [s.from])))].sort((a, b) => a - b);
}
