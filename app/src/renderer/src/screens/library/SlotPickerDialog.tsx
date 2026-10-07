import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import type { Step } from "./plans";
import { isEmptyName } from "./store";

export interface SlotPick {
  title: string;
  description: string;
  confirmLabel: (slot: number) => string;
  /** Pre-selected target */
  initial: number | null;
  /** Steps the choice would write (null = not possible from there, e.g. past slot 99) */
  preview: (target: number) => Step[] | null;
  /** Content name for "blank"/file sources in the preview */
  sourceName?: (from: Step["from"]) => string;
  onPick(slot: number): void;
}

/** Choose a target slot and preview what changes before the confirmation dialog. */
export function SlotPickerDialog({ pick, onOpenChange }: { pick: SlotPick | null; onOpenChange(open: boolean): void }) {
  const names = useDevice((s) => s.names);
  const [target, setTarget] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTarget(pick?.initial ?? null);
    if (pick?.initial != null) requestAnimationFrame(() => listRef.current?.querySelector(`[data-slot-pick="${pick.initial}"]`)?.scrollIntoView({ block: "center" }));
  }, [pick]);

  if (!pick) return null;
  const nameOf = (slot: number) => names[slot]?.name ?? "GP-5";
  const steps = target === null ? null : pick.preview(target);
  const label = (from: Step["from"]) => (typeof from === "number" ? `${String(from).padStart(2, "0")} ${nameOf(from)}` : (pick.sourceName?.(from) ?? "Empty preset"));

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,calc(100vh-64px))] max-w-[520px] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{pick.title}</DialogTitle>
          <DialogDescription>{pick.description}</DialogDescription>
        </DialogHeader>
        <div
          ref={listRef}
          role="listbox"
          aria-label="Target slot"
          className="grid min-h-0 flex-1 grid-cols-2 gap-0.5 overflow-auto rounded-lg bg-well p-1.5"
        >
          {Array.from({ length: 100 }, (_, slot) => {
            const empty = isEmptyName(nameOf(slot));
            const possible = pick.preview(slot) !== null;
            return (
              <button
                key={slot}
                type="button"
                role="option"
                aria-selected={target === slot}
                data-slot-pick={slot}
                disabled={!possible}
                onClick={() => setTarget(slot)}
                onDoubleClick={() => possible && pick.onPick(slot)}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-left text-sm hover:bg-accent disabled:opacity-40",
                  target === slot && "bg-lamp-glow shadow-[inset_0_0_0_1.5px_var(--lamp)] hover:bg-lamp-glow",
                )}
              >
                <span className="w-5 text-xs font-semibold text-silkscreen-3 tabular-nums">{String(slot).padStart(2, "0")}</span>
                <span className={cn("truncate", empty ? "text-silkscreen-4" : "font-semibold text-silkscreen")}>{empty ? "Empty" : nameOf(slot)}</span>
              </button>
            );
          })}
        </div>
        <div className="min-h-[52px] text-sm" aria-live="polite">
          {steps === null ? (
            <p className="text-silkscreen-3">{target === null ? "Choose a slot." : "That runs past slot 99. Choose an earlier slot."}</p>
          ) : steps.length === 0 ? (
            <p className="text-silkscreen-3">Nothing changes from there. Choose another slot.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {steps.slice(0, 4).map((s) => (
                <li key={s.slot} className="truncate text-silkscreen-2">
                  <span className="text-silkscreen-3 tabular-nums">Slot {String(s.slot).padStart(2, "0")}:</span> {label(s.from)}
                  {!isEmptyName(nameOf(s.slot)) && <span className="text-silkscreen-3"> (was {nameOf(s.slot)})</span>}
                </li>
              ))}
              {steps.length > 4 && <li className="text-silkscreen-3">and {steps.length - 4} more slots</li>}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={target === null || !steps?.length} onClick={() => target !== null && pick.onPick(target)}>
            {target === null ? "Choose a slot" : pick.confirmLabel(target)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
