import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";
import type { T3kModel } from "@shared/host/tones";
import { firstEmptySlot, sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { userIrFxId } from "@/gp5/lib/userir.mjs";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { notifyError } from "@/app/notify";
import { irSlotLabel, readSlots, runSend, updateDraft, writeUserIr, type SendState } from "./store";
import { irOccupant, irSummary, ReplaceIrNote, UserIrSlotPicker, useIrWriteBlocker } from "./UserIrParts";

export const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export type StepStatus = "done" | "current" | "pending" | "fault";

export function Step({ n, status, title, children }: { n: number; status: StepStatus; title: string; children?: React.ReactNode }) {
  return (
    <li
      data-step-status={status}
      className="relative flex gap-3 pb-3.5 last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:top-6 [&:not(:last-child)]:before:bottom-0.5 [&:not(:last-child)]:before:left-2.5 [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-seam-strong"
    >
      <span
        className={cn(
          "grid size-[21px] flex-none place-items-center rounded-full text-[11px] font-bold",
          status === "done" && "bg-muted text-led-on",
          status === "current" && "text-silkscreen shadow-[inset_0_0_0_1.5px_var(--silkscreen)]",
          status === "pending" && "text-silkscreen-3 shadow-[inset_0_0_0_1px_var(--seam-strong)]",
          status === "fault" && "bg-led-fault/15 text-led-fault",
        )}
        aria-hidden
      >
        {status === "done" ? <Check className="size-3" strokeWidth={2.5} /> : status === "fault" ? <TriangleAlert className="size-3" /> : n}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-px text-[12px]">
        <b className={cn("font-semibold", status === "pending" ? "text-silkscreen-2" : "text-silkscreen")}>
          <span className="sr-only">{`Step ${n}, ${status}: `}</span>
          {title}
        </b>
        {children}
      </div>
    </li>
  );
}

/**
 * Send an IR to the GP-5 (tones.md "The Send to GP-5 flow"): download, check and convert in the app, pick a User IR
 * slot, write it over USB, link. No Valeton Suite involved. SnapTones: SnapToneSteps.
 */
export function UserIrSteps({ send, model }: { send: SendState; model: T3kModel | undefined }) {
  const { phase, step, error, ir } = send;
  const listRef = useRef<HTMLOListElement>(null);
  const connected = useDevice((s) => s.status === "connected");
  const userIRs = useDevice((s) => s.userIRs);
  const busy = useDevice((s) => s.busy);
  const slot = send.proposedSlot;
  const blocker = useIrWriteBlocker(slot);

  // Keep the current step (and its one action) in view as the flow advances, also in short windows.
  useEffect(() => {
    if (phase === "idle") return;
    listRef.current?.querySelector('[data-step-status="current"], [data-step-status="fault"]')?.scrollIntoView({ block: "nearest" });
  }, [phase, step]);
  // The slot list comes from the pedal; propose the first empty User IR slot once it is known.
  useEffect(() => {
    if (connected && !userIRs && !busy) void readSlots();
  }, [connected, userIRs, busy]);
  useEffect(() => {
    if (slot === null && userIRs) updateDraft(send.toneId, { proposedSlot: firstEmptySlot("ir", userIRs) });
  }, [slot, send.toneId, userIRs]);

  const status = (n: number): StepStatus => {
    if (phase === "linked") return "done";
    if (phase === "error" && n === step) return "fault";
    if (n < step) return "done";
    if (n === step && phase !== "idle") return "current";
    if (n === 1 && phase === "idle") return "current";
    return "pending";
  };
  const modelLabel = model ? model.name : "the model";
  const replacing = irOccupant(userIRs, slot);
  const slotText = slot === null ? "a User IR slot" : irSlotLabel(slot);
  const canEdit = phase === "idle" || phase === "ready" || (phase === "error" && step !== 2);
  const canWrite = Boolean(ir) && (phase === "ready" || (phase === "error" && step >= 3));

  return (
    <ol ref={listRef} className="flex flex-col">
      <Step n={1} status={status(1)} title={step > 1 || phase === "linked" ? `Downloaded ${modelLabel}` : `Download ${modelLabel}`}>
        {phase === "running" && step === 1 && (
          <>
            <span className="text-silkscreen-3">{send.total ? `${kb(send.received)} of ${kb(send.total)}` : send.received ? kb(send.received) : "Starting the download…"}</span>
            <Progress value={send.total ? (send.received / send.total) * 100 : undefined} className="mt-1 w-56" aria-label="Download progress" />
          </>
        )}
        {phase === "error" && step === 1 && <StepError error={error} />}
        {canEdit && (
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-silkscreen-2">
              <span>Name on the pedal</span>
              <Input
                value={send.name}
                maxLength={10}
                onChange={(e) => updateDraft(send.toneId, { name: sanitizeSlotName(e.target.value.toUpperCase()) })}
                className="h-8 w-32"
                aria-describedby={`name-hint-${send.toneId}`}
              />
            </label>
            <span id={`name-hint-${send.toneId}`} className="text-[11px] text-silkscreen-3">
              {send.name.length}/10
            </span>
          </span>
        )}
        {(phase === "idle" || (phase === "error" && step < 3)) && (
          <span className="mt-2 flex flex-col items-start gap-1">
            <Button size="sm" disabled={!send.name || !model} onClick={() => void runSend(send.toneId)}>
              {phase === "error" && <RotateCcw data-icon="inline-start" />}
              {phase === "error" ? "Retry" : "Download and check"}
            </Button>
            <span className="text-[11px] text-silkscreen-3">Nothing is written to the pedal until you choose a slot and press Write.</span>
          </span>
        )}
      </Step>

      <Step n={2} status={status(2)} title={ir ? "Checked the IR" : "Check the IR"}>
        {ir ? <span className="text-pretty text-silkscreen-3">{irSummary(ir)}</span> : phase !== "error" && <span className="text-silkscreen-3">Confirm it's a WAV file and convert it for the GP-5</span>}
        {phase === "running" && step === 2 && <Spinner className="mt-1" />}
        {phase === "error" && step === 2 && <StepError error={error} />}
      </Step>

      <Step n={3} status={status(3)} title={step > 3 || phase === "linked" ? `Chose ${slotText}` : "Choose a User IR slot"}>
        {canEdit && <UserIrSlotPicker value={slot} onChange={(s) => updateDraft(send.toneId, { proposedSlot: s })} />}
        {replacing && phase !== "linked" && phase !== "writing" && <ReplaceIrNote name={replacing} />}
      </Step>

      <Step n={4} status={status(4)} title={phase === "linked" ? `Wrote ${slotText}` : `Write ${slotText} on the GP-5`}>
        {phase === "writing" && <Progress value={send.progress * 100} className="mt-1 w-56" aria-label="User IR write progress" />}
        {phase === "error" && step === 4 && <StepError error={error} />}
        {canWrite && (
          <span className="mt-2 flex flex-col items-start gap-1">
            <Button size="sm" disabled={blocker !== null || !send.name} onClick={() => void writeUserIr(send.toneId)}>
              {phase === "error" && <RotateCcw data-icon="inline-start" />}
              {replacing ? `Replace ${replacing} in ${slotText}` : `Write to ${slotText}`}
            </Button>
            {blocker && <span className="text-[11px] text-silkscreen-3">{blocker}</span>}
          </span>
        )}
      </Step>

      <Step n={5} status={status(5)} title={phase === "linked" && send.linkedSlot !== null ? `Linked to ${irSlotLabel(send.linkedSlot)} on your GP-5` : "Link the new IR"}>
        {phase !== "linked" && <span className="text-pretty text-silkscreen-3">The slot map then shows this tone's image for that slot.</span>}
        {phase === "linked" && send.linkedSlot !== null && <UseOnGp5 isIr slot={send.linkedSlot} />}
      </Step>
    </ol>
  );
}

export function StepError({ error }: { error: string | null }) {
  return (
    <span role="alert" className="text-pretty text-led-fault">
      {error ?? "Something went wrong."}
    </span>
  );
}

/** Live edit only: select the linked slot in the current preset's NS (or CAB) block and engage it. */
export function UseOnGp5({ isIr, slot }: { isIr: boolean; slot: number }) {
  const connected = useDevice((s) => s.status === "connected");
  const hasPreset = useDevice((s) => s.preset !== null);
  const [busy, setBusy] = useState(false);
  const use = async () => {
    const d = useDevice.getState();
    setBusy(true);
    try {
      const block = isIr ? 4 : 9;
      await d.setModel(block, isIr ? userIrFxId(slot) : 0x0f000000 | slot);
      d.setBlockEnabled(block, true);
    } catch (e) {
      notifyError("Couldn't use it in the current preset", e);
    } finally {
      setBusy(false);
    }
  };
  if (!connected || !hasPreset) return null;
  return (
    <span className="mt-2 flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={use}>
        Use in current preset
      </Button>
      <span className="text-[11px] text-silkscreen-3">Plays now. It stays an unsaved change until you save the preset.</span>
    </span>
  );
}
