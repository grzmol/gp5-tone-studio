import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FolderOpen, RotateCcw, TriangleAlert } from "lucide-react";
import type { T3kModel } from "@shared/host/tones";
import { sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { notifyError } from "@/app/notify";
import { finishSuite, openSuite, runSend, updateDraft, type SendState } from "./store";

export const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

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
 * Send an IR to the GP-5 (tones.md "The Send to GP-5 flow"): download, check, save to the hand-off folder,
 * import in Valeton Suite, link. IR upload isn't known yet, so Suite writes the slot. SnapTones: SnapToneSteps.
 */
export function SendSteps({ send, model }: { send: SendState; model: T3kModel | undefined }) {
  const { phase, step, error, result } = send;
  const [suitePath, setSuitePath] = useState<string | null | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // Keep the current step (and its one action) in view as the flow advances, also in short windows.
  useEffect(() => {
    if (phase === "idle") return;
    listRef.current?.querySelector('[data-step-status="current"], [data-step-status="fault"]')?.scrollIntoView({ block: "nearest" });
  }, [phase, step]);
  const deviceStatus = useDevice((s) => s.status);
  const slotWord = "User IR slot";
  const fileWord = result?.fileName ?? `${send.name || "…"}.wav`;

  useEffect(() => {
    host.app.getSettings().then((s) => setSuitePath(s.valetonSuitePath), () => setSuitePath(null));
  }, []);

  const status = (n: number): StepStatus => {
    if (phase === "linked") return "done";
    if (phase === "error" && n === step) return "fault";
    if (n < step) return "done";
    if (n === step && phase !== "idle") return "current";
    if (n === 1 && phase === "idle") return "current";
    return "pending";
  };
  const running = phase === "running";
  const modelLabel = model ? model.name : "the model";

  const chooseSuite = async () => {
    try {
      const path = await host.tones.pickSuite();
      if (!path) return;
      await host.app.setSettings({ valetonSuitePath: path });
      setSuitePath(path);
    } catch (e) {
      notifyError("Couldn't set the Valeton Suite location", e);
    }
  };
  const launch = async () => {
    setOpening(true);
    try {
      await openSuite(send.toneId);
    } catch (e) {
      notifyError("Couldn't open Valeton Suite", e);
    } finally {
      setOpening(false);
    }
  };
  const showFile = () => result && host.app.showItemInFolder(result.path).catch((e) => notifyError("Couldn't show the file", e));
  const linux = host.platform === "linux";
  const slotText = send.proposedSlot !== null ? `${slotWord} ${send.proposedSlot}` : `a free ${slotWord}`;

  return (
    <ol ref={listRef} className="flex flex-col">
      <Step n={1} status={status(1)} title={step > 1 || phase === "linked" ? `Downloaded ${modelLabel}` : `Download ${modelLabel}`}>
        {running && step === 1 && (
          <>
            <span className="text-silkscreen-3">{send.total ? `${kb(send.received)} of ${kb(send.total)}` : send.received ? kb(send.received) : "Starting the download…"}</span>
            <Progress value={send.total ? (send.received / send.total) * 100 : undefined} className="mt-1 w-56" aria-label="Download progress" />
          </>
        )}
        {result && <span className="text-silkscreen-3">{kb(result.bytes)} from TONE3000</span>}
        {phase === "error" && step === 1 && <StepError error={error} />}
        {(phase === "idle" || phase === "error") && (
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
            <Button size="sm" disabled={!send.name || !model} onClick={() => void runSend(send.toneId)}>
              {phase === "error" && <RotateCcw data-icon="inline-start" />}
              {phase === "error" ? "Retry" : "Send to GP-5"}
            </Button>
          </span>
        )}
      </Step>

      <Step n={2} status={status(2)} title={result ? "Checked the file" : "Check the file"}>
        {result && <span className="text-silkscreen-3">A WAV impulse response</span>}
        {!result && phase !== "error" && <span className="text-silkscreen-3">Confirm it's a WAV file</span>}
        {running && step === 2 && <Spinner className="mt-1" />}
        {phase === "error" && step === 2 && <StepError error={error} />}
      </Step>

      <Step n={3} status={status(3)} title={result ? `Saved as ${result.fileName}` : "Save it for Valeton Suite"}>
        <span className="[overflow-wrap:anywhere] text-silkscreen-3">{result ? dirOf(result.path) : `As ${fileWord} in the Ready for Valeton Suite folder`}</span>
        {phase === "error" && step === 3 && <StepError error={error} />}
      </Step>

      <Step n={4} status={status(4)} title="Import it in Valeton Suite">
        {linux ? (
          <span className="text-pretty text-silkscreen-2">
            Valeton Suite runs on Windows and macOS. Copy {fileWord} to a computer with Suite, import it into {slotText}, then reconnect the pedal here.
          </span>
        ) : phase === "suite" ? (
          <span className="text-pretty text-silkscreen-2">
            Valeton Suite is open. Import {fileWord} into {slotText}, then close Suite. Tone Studio reconnects {send.watched ? "when Suite closes" : "when you say it's done"}.
          </span>
        ) : (
          <span className="text-pretty text-silkscreen-2">
            In Suite, import {fileWord} into {slotText}. Tone Studio lets go of the USB connection while Suite is open.
          </span>
        )}
        {phase === "ready" && (
          <span className="mt-2 flex flex-wrap gap-2">
            {linux ? (
              <Button size="sm" onClick={showFile}>
                <FolderOpen data-icon="inline-start" />
                Show file
              </Button>
            ) : suitePath ? (
              <>
                <Button size="sm" disabled={opening} onClick={launch}>
                  {opening ? <Spinner data-icon="inline-start" /> : <ExternalLink data-icon="inline-start" />}
                  Open Valeton Suite
                </Button>
                <Button variant="ghost" size="sm" onClick={showFile}>
                  <FolderOpen data-icon="inline-start" />
                  Show file
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={suitePath === undefined} onClick={chooseSuite}>
                  Choose Valeton Suite…
                </Button>
                <Button variant="ghost" size="sm" onClick={showFile}>
                  <FolderOpen data-icon="inline-start" />
                  Show file
                </Button>
              </>
            )}
          </span>
        )}
      </Step>

      <Step
        n={5}
        status={status(5)}
        title={phase === "linked" && send.linkedSlot !== null ? `Linked to slot ${send.linkedSlot} on your GP-5` : "Link the new IR"}
      >
        {phase !== "linked" && (
          <span className="text-pretty text-silkscreen-3">
            When Suite closes, Tone Studio reads the pedal's User IR list and links {send.proposedSlot !== null ? `slot ${send.proposedSlot}` : "the new slot"} to this tone, so the CAB
            block shows its image.
          </span>
        )}
        {(phase === "suite" || (linux && phase === "ready")) && (
          <span className="mt-2 flex gap-2">
            <Button size="sm" variant={phase === "suite" ? "default" : "outline"} onClick={() => void finishSuite(send.toneId)}>
              {deviceStatus === "connected" ? "Find it on the pedal" : "Reconnect and find it"}
            </Button>
          </span>
        )}
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
      await d.setModel(block, isIr ? 0x0a100000 + slot : 0x0f000000 | slot);
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
