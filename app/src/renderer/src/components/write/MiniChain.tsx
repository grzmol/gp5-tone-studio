import { cn } from "@/lib/utils";
import { BLOCK_CODES } from "@/state/device-types";

const CORE = [2, 9, 3, 4, 5];
const DEFAULT_ORDER = [0, 1, 2, 9, 3, 4, 5, 6, 7, 8];

/**
 * Ten 11px chips in the preset's chain order with the fixed core (DST NS AMP CAB EQ) bracketed.
 * Engaged = filled in the block color; bypassed = hollow on the cable. `enabled` null = no data (dashed cable).
 */
export function MiniChain({ order, enabled, className }: { order?: number[]; enabled: boolean[] | null; className?: string }) {
  if (!enabled) {
    return (
      <span className={cn("relative inline-flex h-[18px] w-[150px] items-center", className)} aria-label="Chain not read yet">
        <span className="h-0 w-full border-t border-dashed border-seam-strong" />
      </span>
    );
  }
  const seq = order && order.length === 10 ? order : DEFAULT_ORDER;
  const coreStart = seq.findIndex((i) => CORE.includes(i));
  const before = seq.slice(0, coreStart);
  const core = seq.slice(coreStart, coreStart + CORE.length);
  const after = seq.slice(coreStart + CORE.length);
  const chip = (i: number) => (
    <span
      key={i}
      className={cn("relative size-[11px] rounded-[2px]", enabled[i] ? "" : "bg-enclosure shadow-[inset_0_0_0_1px_var(--seam-strong)]")}
      style={enabled[i] ? { background: `var(--block-${BLOCK_CODES[i].toLowerCase()})` } : undefined}
    />
  );
  const on = seq.filter((i) => enabled[i]).map((i) => BLOCK_CODES[i]);
  return (
    <span
      role="img"
      aria-label={on.length ? `Chain: ${on.join(", ")} on` : "Chain: all blocks off"}
      className={cn(
        "relative inline-flex h-[18px] flex-none items-center gap-[3px] before:absolute before:inset-x-0.5 before:top-1/2 before:h-px before:bg-cable before:opacity-60",
        className,
      )}
    >
      {before.map(chip)}
      <span className="relative inline-flex gap-[3px] rounded-[10px] bg-well px-[3px] py-0.5 shadow-[inset_0_0_0_1px_var(--seam-strong)]">{core.map(chip)}</span>
      {after.map(chip)}
    </span>
  );
}
