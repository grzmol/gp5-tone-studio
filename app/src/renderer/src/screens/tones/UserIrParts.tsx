import { isEmptySlotName } from "@shared/tone3000";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { USER_IR } from "@/gp5/lib/userir.mjs";
import { useDevice } from "@/state/device";
import type { SlotName } from "@/state/device-types";
import type { UserIrFile } from "@/userir/convert";
import { irSlotLabel } from "./store";

const IR_SLOTS = Array.from({ length: USER_IR.SLOTS }, (_, i) => i);
const KEPT_MS = (USER_IR.SAMPLES / USER_IR.RATE) * 1000;

/** What the slot holds now, or null when it is empty (or the pedal's list isn't read). */
export function irOccupant(userIRs: SlotName[] | null, slot: number | null): string | null {
  if (slot === null || !userIRs) return null;
  const s = userIRs.find((x) => x.slot === slot);
  return s && s.kind !== "empty" && !isEmptySlotName(s.name) ? s.name : null;
}

/** What the converter kept of the file: the GP-5 convolves 512 samples at 44.1 kHz (11.6 ms). */
export function irSummary(ir: UserIrFile): string {
  const lengthMs = (ir.sourceFrames / ir.sourceRate) * 1000;
  const kept = `${KEPT_MS.toFixed(1)} ms (${USER_IR.SAMPLES} samples at 44.1 kHz)`;
  const used = ir.truncated
    ? `Uses the first ${kept} of this ${lengthMs.toFixed(1)} ms IR; the GP-5 keeps no more.`
    : `Uses all ${lengthMs.toFixed(1)} ms of it; the GP-5 keeps up to ${kept}.`;
  return ir.sourceRate === USER_IR.RATE ? used : `${used} Resampled from ${ir.sourceRate / 1000} kHz.`;
}

/** Why a User IR can't be written right now, or null when it can. */
export function useIrWriteBlocker(slot: number | null): string | null {
  const connected = useDevice((s) => s.status === "connected");
  const busy = useDevice((s) => s.busy);
  const userIRs = useDevice((s) => s.userIRs);
  if (!connected) return "Connect the GP-5 to write it.";
  if (busy) return `Wait until the pedal is free (${busy.label.toLowerCase()}).`;
  if (!userIRs) return "Reading the pedal's User IR slots…";
  if (slot === null) return "Choose a slot.";
  return null;
}

/** Warning for an occupied slot: IR content can't be downloaded from the pedal, so it can't be backed up. */
export function ReplaceIrNote({ name }: { name: string }) {
  return <span className="text-pretty text-silkscreen-2">Replaces {name}. An IR can't be read back from the pedal, so it is gone unless you have its file.</span>;
}

/** The 20 User IR slots (shown 1-based, like the pedal) with what each holds; nothing when the list isn't read. */
export function UserIrSlotPicker({ value, onChange, disabled }: { value: number | null; onChange: (slot: number) => void; disabled?: boolean }) {
  const userIRs = useDevice((s) => s.userIRs);
  if (!userIRs) return null;
  const label = (slot: number) => {
    const name = irOccupant(userIRs, slot);
    return `${irSlotLabel(slot)}${name ? `, ${name}` : ", empty"}`;
  };
  return (
    <Select value={value === null ? "" : String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger className="h-8 w-48" aria-label="User IR slot on the pedal">
        <SelectValue placeholder="Choose a slot" />
      </SelectTrigger>
      <SelectContent>
        {IR_SLOTS.map((slot) => (
          <SelectItem key={slot} value={String(slot)}>
            {label(slot)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
