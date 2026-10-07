// Chain order helpers for the Rig. Order = permutation of block indices (0 NR, 1 PRE, 2 DST, 3 AMP, 4 CAB, 5 EQ,
// 6 MOD, 7 DLY, 8 RVB, 9 NS). NR/PRE/MOD/DLY/RVB can move; the core DST, NS, AMP, CAB, EQ stays contiguous.
import { validateOrder } from "@/gp5/lib/prst.mjs";

export const MOVABLE: readonly number[] = [0, 1, 6, 7, 8];
export const AMP = 3;
export const CAB = 4;

export type GroupId = "before" | "amp" | "after";
export const GROUPS: readonly GroupId[] = ["before", "amp", "after"];
export const GROUP_TITLE: Record<GroupId, string> = { before: "Before the amp", amp: "Amp & cab", after: "After the amp" };

export const isMovable = (block: number) => MOVABLE.includes(block);

/** Blocks of each group in signal order: before = everything ahead of AMP, after = everything behind CAB. */
export function groupsOf(order: readonly number[]): Record<GroupId, number[]> {
  const a = order.indexOf(AMP);
  const c = order.indexOf(CAB);
  return { before: order.slice(0, a), amp: [AMP, CAB], after: order.slice(c + 1) };
}

export function groupOf(order: readonly number[], block: number): GroupId {
  const g = groupsOf(order);
  return g.before.includes(block) ? "before" : g.after.includes(block) ? "after" : "amp";
}

/** Insert `block` at `index` of the order without it; null when not a legal chain. */
function insertAt(order: readonly number[], block: number, index: number): number[] | null {
  const rest = order.filter((b) => b !== block);
  const next = [...rest.slice(0, index), block, ...rest.slice(index)];
  return validateOrder(next) === null ? next : null;
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Move `block` next to `target` (before or after it). Null when the block is fixed, the drop would split the
 * core, or nothing changes.
 */
export function moveBlock(order: readonly number[], block: number, target: number, side: "before" | "after"): number[] | null {
  if (!isMovable(block) || block === target || validateOrder([...order]) !== null) return null;
  const rest = order.filter((b) => b !== block);
  const t = rest.indexOf(target);
  if (t < 0) return null;
  const next = insertAt(order, block, side === "before" ? t : t + 1);
  return next && !same(next, order) ? next : null;
}

/** Move `block` to the end of a group (overview drop): last before AMP, or last in the chain. */
export function moveToGroup(order: readonly number[], block: number, group: GroupId): number[] | null {
  if (!isMovable(block) || group === "amp") return null;
  const rest = order.filter((b) => b !== block);
  const index = group === "before" ? rest.indexOf(2) : rest.length; // just ahead of the core (DST) / chain end
  const next = insertAt(order, block, index);
  return next && !same(next, order) ? next : null;
}

/** Keyboard reorder: the next legal position left (-1) or right (+1), jumping over the core as a unit. */
export function nudge(order: readonly number[], block: number, dir: -1 | 1): number[] | null {
  if (!isMovable(block)) return null;
  const i = order.indexOf(block);
  for (let j = i + dir; j >= 0 && j <= order.length - 1; j += dir) {
    const next = insertAt(order, block, j);
    if (next && !same(next, order)) return next;
  }
  return null;
}
