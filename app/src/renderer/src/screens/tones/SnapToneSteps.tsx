import { useEffect, useRef } from "react";
import { FileAudio, RotateCcw } from "lucide-react";
import { SIGNAL_IN_SUITE } from "@shared/host/snaptone";
import type { T3kModel } from "@shared/host/tones";
import { firstEmptySlot, isEmptySlotName, sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { host, isElectron } from "@/host";
import { checkTestSignal, chooseTestSignal, useTestSignal } from "@/snaptone/signal";
import { useDevice } from "@/state/device";
import { readSlots, runSend, updateDraft, writeSnapTone, type SendState } from "./store";
import { Step, StepError, UseOnGp5, kb, type StepStatus } from "./SendSteps";

const USER_SLOTS = Array.from({ length: 30 }, (_, i) => 50 + i);

/**
 * Send a NAM capture to the GP-5 as a SnapTone (tones.md "The Send to GP-5 flow"): download, check, convert
 * in the app, write the chosen user slot over USB, link. No Valeton Suite involved.
 */
export function SnapToneSteps({ send, model }: { send: SendState; model: T3kModel | undefined }) {
  const { phase, step, error } = send;
  const listRef = useRef<HTMLOListElement>(null);
  const connected = useDevice((s) => s.status === "connected");
  const snapTones = useDevice((s) => s.snapTones);
  const busy = useDevice((s) => s.busy);
  const hasSignal = useTestSignal((s) => s.has);

  useEffect(() => {
    if (phase === "idle") return;
    listRef.current?.querySelector('[data-step-status="current"], [data-step-status="fault"]')?.scrollIntoView({ block: "nearest" });
  }, [phase, step]);
  // The slot list comes from the pedal; propose the first free user slot once it is known.
  useEffect(() => {
    if (connected && !snapTones && !busy) void readSlots();
  }, [connected, snapTones, busy]);
  useEffect(() => {
    if (send.proposedSlot === null && snapTones) updateDraft(send.toneId, { proposedSlot: firstEmptySlot("snaptone", snapTones) });
  }, [send.proposedSlot, send.toneId, snapTones]);

  const status = (n: number): StepStatus => {
    if (phase === "linked") return "done";
    if (phase === "error" && n === step) return "fault";
    if (n < step) return "done";
    if (n === step && phase !== "idle") return "current";
    if (n === 1 && phase === "idle") return "current";
    return "pending";
  };
  const slot = send.proposedSlot;
  const occupant = slot === null ? null : snapTones?.find((s) => s.slot === slot)?.name;
  const replacing = occupant && !isEmptySlotName(occupant) ? occupant : null;
  const slotText = slot === null ? "a user slot" : `slot ${slot}`;
  const writeLabel = replacing ? `Replace ${replacing} in slot ${slot}` : `Write to ${slotText}`;
  const canEdit = phase === "idle" || phase === "ready" || (phase === "error" && step !== 3);
  const canWrite = connected && slot !== null && !busy;
  const modelLabel = model ? `${model.name}, A1 standard` : "the model";

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
            <SnapToneSlotPicker value={send.proposedSlot} onChange={(slot) => updateDraft(send.toneId, { proposedSlot: slot })} />
          </span>
        )}
        {(phase === "idle" || (phase === "error" && step < 4)) && (
          <span className="mt-2 flex flex-col items-start gap-1">
            <Button size="sm" disabled={!send.name || !model || hasSignal === false} onClick={() => void runSend(send.toneId)}>
              {phase === "error" && <RotateCcw data-icon="inline-start" />}
              {phase === "error" ? "Retry" : replacing && connected ? `Send, replacing ${replacing}` : "Send to GP-5"}
            </Button>
            {!connected && <span className="text-[11px] text-silkscreen-3">Connect the GP-5 to write it; the conversion runs without it.</span>}
            <TestSignalNotice />
          </span>
        )}
      </Step>

      <Step n={2} status={status(2)} title={send.check ? "Checked the file" : "Check the file"}>
        {send.check?.reshaped && <span className="text-silkscreen-3">Updated from NAM {send.check.version} to the 0.5.x layout</span>}
        {send.check && !send.check.reshaped && <span className="text-silkscreen-3">NAM {send.check.version}, A1 standard</span>}
        {!send.check && phase !== "error" && <span className="text-silkscreen-3">Confirm it's NAM A1 standard</span>}
        {phase === "running" && step === 2 && <Spinner className="mt-1" />}
        {phase === "error" && step === 2 && <StepError error={error} />}
      </Step>

      <Step n={3} status={status(3)} title={send.file ? "Made the SnapTone" : "Make the SnapTone"}>
        <span className="text-silkscreen-3">Plays the test signal through the capture and measures it, like Valeton Suite does. Takes about 10 seconds.</span>
        {phase === "converting" && <Progress value={send.progress * 100} className="mt-1 w-56" aria-label="SnapTone conversion progress" />}
        {phase === "error" && step === 3 && <StepError error={error} />}
      </Step>

      <Step n={4} status={status(4)} title={phase === "linked" ? `Wrote slot ${send.linkedSlot}` : `Write ${slotText} on the GP-5`}>
        {replacing && phase !== "linked" && <span className="text-silkscreen-2">Replaces {replacing}. A SnapTone can't be read back from the pedal, so keep the original file if you want it again.</span>}
        {phase === "writing" && <Progress value={send.progress * 100} className="mt-1 w-56" aria-label="SnapTone write progress" />}
        {phase === "error" && step === 4 && <StepError error={error} />}
        {send.file && (phase === "ready" || (phase === "error" && step === 4)) && (
          <span className="mt-2 flex flex-col items-start gap-1">
            <Button size="sm" disabled={!canWrite} onClick={() => void writeSnapTone(send.toneId)}>
              {phase === "error" && <RotateCcw data-icon="inline-start" />}
              {writeLabel}
            </Button>
            {!connected && <span className="text-[11px] text-silkscreen-3">Connect the GP-5 to write it.</span>}
            {connected && slot === null && <span className="text-[11px] text-silkscreen-3">Choose a slot above.</span>}
          </span>
        )}
      </Step>

      <Step n={5} status={status(5)} title={phase === "linked" ? `Linked to slot ${send.linkedSlot} on your GP-5` : "Link the new SnapTone"}>
        {phase !== "linked" && <span className="text-pretty text-silkscreen-3">The NS block then shows this tone's image for that slot.</span>}
        {phase === "linked" && send.linkedSlot !== null && <UseOnGp5 isIr={false} slot={send.linkedSlot} />}
      </Step>
    </ol>
  );
}

/** User SnapTone slot (50–79) with what it holds now; nothing when the pedal's list isn't read. */
export function SnapToneSlotPicker({ value, onChange, disabled }: { value: number | null; onChange: (slot: number) => void; disabled?: boolean }) {
  const snapTones = useDevice((s) => s.snapTones);
  if (!snapTones) return null;
  const label = (slot: number) => {
    const name = snapTones.find((s) => s.slot === slot)?.name ?? "";
    return `Slot ${slot}${isEmptySlotName(name) ? ", empty" : `, ${name}`}`;
  };
  return (
    <Select value={value === null ? "" : String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger className="h-8 w-48" aria-label="SnapTone slot on the pedal">
        <SelectValue placeholder="Choose a slot" />
      </SelectTrigger>
      <SelectContent>
        {USER_SLOTS.map((slot) => (
          <SelectItem key={slot} value={String(slot)}>
            {label(slot)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Where to find nam_input_wav.wav, for this platform. */
function signalWhere(): string {
  if (host.platform === "win32" || host.platform === "darwin") return `In Valeton Suite: ${SIGNAL_IN_SUITE[host.platform]}.`;
  return `In Valeton Suite: ${SIGNAL_IN_SUITE.win32} on Windows, or ${SIGNAL_IN_SUITE.darwin} on macOS. The Windows installer opens with 7-Zip.`;
}

/**
 * Shown while Tone Studio doesn't have Valeton's test signal: making a SnapTone plays it through the capture, and
 * it is Valeton's file, so the user points to it once.
 */
export function TestSignalNotice() {
  const has = useTestSignal((s) => s.has);
  const choosing = useTestSignal((s) => s.choosing);
  useEffect(() => void checkTestSignal(), []);
  if (has !== false) return null;
  return (
    <span className="mt-1 flex flex-col items-start gap-1">
      <span className="text-pretty text-silkscreen-2">
        Making a SnapTone needs Valeton's test signal, nam_input_wav.wav. It is Valeton's file, so Tone Studio doesn't include it.{" "}
        {isElectron ? "Choose it once and Tone Studio keeps a copy." : "Choose it once per visit."}
      </span>
      <span className="text-[11px] break-all text-silkscreen-3">{signalWhere()}</span>
      <Button size="sm" variant="outline" disabled={choosing} onClick={() => void chooseTestSignal()}>
        {choosing ? <Spinner data-icon="inline-start" /> : <FileAudio data-icon="inline-start" />}
        Choose nam_input_wav.wav…
      </Button>
    </span>
  );
}
