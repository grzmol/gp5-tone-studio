import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, RotateCcw, Send, TriangleAlert } from "lucide-react";
import type { T3kModel } from "@shared/host/tones";
import { prepareNam } from "@shared/nam";
import { firstEmptySlot, isEmptySlotName, isGp5Model, proposeSlotName, sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Capture } from "@/components/gear";
import { host } from "@/host";
import { notifySuccess } from "@/app/notify";
import { cn } from "@/lib/utils";
import { convertToSnapTone } from "@/snaptone/convert";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import { UseOnGp5 } from "@/screens/tones/SendSteps";
import { SnapToneSlotPicker } from "@/screens/tones/SnapToneSteps";
import { openSheet, startSendDraft, useTones } from "@/screens/tones/store";
import { isFlat } from "./nam/shaping";
import { exportText, useCapture } from "./store";
import { Led, PANEL, useCaptureTitle, useToneRecord } from "./parts";
import { verdictOf } from "./Head";

type StepStatus = "done" | "current" | "pending" | "fault";

function Step({ n, status, title, children }: { n: number; status: StepStatus; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-2.5 last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:top-6 [&:not(:last-child)]:before:bottom-0.5 [&:not(:last-child)]:before:left-2.5 [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-seam-strong">
      <span
        aria-hidden
        className={cn(
          "grid size-[21px] flex-none place-items-center rounded-full text-[11px] font-bold",
          status === "done" && "bg-muted text-led-on",
          status === "current" && "text-silkscreen shadow-[inset_0_0_0_1.5px_var(--silkscreen)]",
          status === "pending" && "text-silkscreen-3 shadow-[inset_0_0_0_1px_var(--seam-strong)]",
          status === "fault" && "bg-led-fault/15 text-led-fault",
        )}
      >
        {status === "done" ? <Check className="size-3" strokeWidth={2.5} /> : status === "fault" ? <TriangleAlert className="size-3" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px text-[12px]">
        <b className={cn("font-semibold", status === "pending" ? "text-silkscreen-2" : "text-silkscreen")}>
          <span className="sr-only">{`Step ${n}, ${status === "fault" ? "can't run" : status}: `}</span>
          {title}
        </b>
        {children}
      </div>
    </li>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <span className="text-pretty text-silkscreen-3">{children}</span>;

function Stop({ name, title, sub, lit, caption, image }: { name: string; title: string; sub: string; lit: boolean; caption?: string; image?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <Capture name={name} on={lit} caption={caption} image={image} className={cn("w-[34px]", !lit && "brightness-70 saturate-40")} />
      <b className="text-[11px] font-semibold text-silkscreen">{title}</b>
      <span className="text-[11px] leading-tight text-balance text-silkscreen-3">{sub}</span>
    </div>
  );
}

function Hop({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 pt-3 text-[11px] whitespace-nowrap text-silkscreen-3">
      <ArrowRight className="size-3.5" aria-hidden />
      {top}
      <b className="font-semibold text-silkscreen-2">{bottom}</b>
    </div>
  );
}

/** TONE3000 A1 standard model of this tone, if any (step 1). */
function useLegacyA1(toneId: number | null) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; model: T3kModel | null; error: string | null }>({ status: "idle", model: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (toneId === null) return;
    let live = true;
    setState({ status: "loading", model: null, error: null });
    host.tones.models(toneId).then(
      (models) => live && setState({ status: "done", model: models.find(isGp5Model) ?? null, error: null }),
      (e: Error) => live && setState({ status: "error", model: null, error: e?.message ?? String(e) }),
    );
    return () => {
      live = false;
    };
  }, [toneId, nonce]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}

export function Pipeline() {
  const loaded = useCapture((s) => s.loaded)!;
  const recipe = useCapture((s) => s.recipe)!;
  const base = useCapture((s) => s.base);
  const record = useToneRecord();
  const title = useCaptureTitle();
  const image = useTones((s) => (record?.image_url ? (s.images[record.image_url] ?? undefined) : undefined));
  const { info } = loaded;
  const verdict = verdictOf(info, record?.gp5.snaptoneSlot ?? null);
  const blocked = info.unsupported !== null || (info.arch.kind === "A1" && info.arch.size !== "standard");
  const versionLabel = base === 0 ? "Original" : `Version ${base}`;

  return (
    <section
      aria-label="Make it GP-5 ready"
      className={cn(
        PANEL,
        "relative col-start-2 row-span-2 row-start-1 flex flex-col overflow-hidden shadow-[var(--glass-shine),0_0_0_1px_rgb(255_255_255/0.2)] min-[1421px]:col-start-3",
        "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-block-ns",
      )}
    >
      <div className="px-5 pt-4 pb-2">
        <p className="m-0 mb-1 text-[12px] text-silkscreen-2">GP-5 version · user SnapTone</p>
        <h2 className="m-0 mb-1.5 text-[24px] leading-[1.1] font-bold tracking-[-0.01em]">Make it GP-5 ready</h2>
        <p className="m-0 text-[12px] text-pretty text-silkscreen-3">
          {info.arch.kind === "A1" && !blocked
            ? "The GP-5 loads NAM A1 standard only, and this capture is one. Tone Studio turns it into a SnapTone and writes it to the pedal."
            : "The GP-5 loads NAM A1 standard only. An A2 capture needs an A1 learned from it first."}
        </p>
      </div>

      {blocked ? (
        <div className="mx-5 mt-2 flex gap-2.5 rounded-lg bg-well p-3 text-[12px]">
          <Led tone="fault" className="mt-1" />
          <div className="flex flex-col gap-0.5">
            <b className="font-semibold text-silkscreen">{verdict.label}</b>
            <span className="text-pretty text-silkscreen-2">{verdict.reason}</span>
          </div>
        </div>
      ) : info.arch.kind === "A2" ? (
        <A2Pipeline title={title} image={image} versionLabel={versionLabel} shaped={!isFlat(recipe.shaping)} />
      ) : (
        <A1Pipeline title={title} image={image} shaped={!isFlat(recipe.shaping)} exportFile={() => exportText(loaded, recipe)} />
      )}
    </section>
  );
}

function A2Pipeline({ title, image, versionLabel, shaped }: { title: string; image?: string; versionLabel: string; shaped: boolean }) {
  const loaded = useCapture((s) => s.loaded)!;
  const record = useToneRecord();
  const toneId = loaded.source.kind === "tone" ? Number(loaded.source.ref) : null;
  const legacy = useLegacyA1(toneId);
  const go = useNav((s) => s.go);

  const sendLegacy = () => {
    if (toneId === null || !legacy.model) return;
    startSendDraft(toneId, legacy.model.id, proposeSlotName(record?.title ?? title, legacy.model.name), "snaptone");
    openSheet(toneId);
    go("tones", String(toneId));
  };

  let step1: ReactNode;
  let step1Status: StepStatus = "done";
  if (toneId === null) {
    step1 = <Step n={1} status="done" title="Not a TONE3000 tone"><Sub>This file was opened from disk, so there's no A1 model to look up.</Sub></Step>;
  } else if (legacy.status === "loading" || legacy.status === "idle") {
    step1Status = "current";
    step1 = (
      <Step n={1} status="current" title="Looking for an A1 model on TONE3000">
        <span className="flex items-center gap-2 text-silkscreen-3">
          <Spinner className="size-3" />
          Checking this tone's models
        </span>
      </Step>
    );
  } else if (legacy.status === "error") {
    step1Status = "fault";
    step1 = (
      <Step n={1} status="fault" title="Couldn't check TONE3000">
        <Sub>{legacy.error}</Sub>
        <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={legacy.retry}>
          <RotateCcw className="size-3.5" aria-hidden />
          Retry
        </Button>
      </Step>
    );
  } else if (legacy.model) {
    step1Status = "current";
    step1 = (
      <Step n={1} status="current" title="TONE3000 has an A1 model of this tone">
        <Sub>
          {shaped
            ? "TONE3000's A1 doesn't include your shaping. It can still go to the GP-5 as it was captured."
            : `“${legacy.model.name}” is A1 standard, so it can go to the GP-5 without training.`}
        </Sub>
        <Button variant="default" size="sm" className="mt-2 self-start" onClick={sendLegacy}>
          <Send className="size-3.5" aria-hidden />
          Send it to the GP-5
        </Button>
      </Step>
    );
  } else {
    step1 = <Step n={1} status="done" title="No A1 model on TONE3000"><Sub>This tone is A2 only.</Sub></Step>;
  }

  return (
    <>
      <div className="mx-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-1 rounded-lg bg-well px-1.5 py-2.5" aria-label="Chain of approximations">
        <Stop name={title} title="A2-Full" sub={versionLabel} lit caption="NAM A2" image={image} />
        <Hop top="distilled" bottom="not run" />
        <Stop name="A1" title="A1 standard" sub="Not made" lit={false} caption="NAM A1" />
        <Hop top="Tone Studio" bottom="converts" />
        <Stop name="SnapTone" title="SnapTone" sub="Can't be measured here" lit={false} />
      </div>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-auto px-5 pt-3 pb-3">
        {step1}
        <Step n={2} status={step1Status === "current" && legacy.model ? "pending" : "fault"} title="Learn the A1 from your A2">
          <Sub>
            Learning an A1 needs the capture trainer (Python, PyTorch and the NAM trainer, run on this computer). This version of Tone Studio doesn't include it,
            so this step can't run here.
          </Sub>
        </Step>
        <Step n={3} status="pending" title="Check how close it is">
          <Sub>ESR and null test against the A2 on clips it hasn't heard.</Sub>
        </Step>
        <Step n={4} status="pending" title="Make the SnapTone">
          <Sub>Tone Studio converts the A1 the way Valeton Suite does.</Sub>
        </Step>
        <Step n={5} status="pending" title="Write it to the GP-5 and link the slot">
          <Sub>Written to a user SnapTone slot over USB and linked to this tone.</Sub>
        </Step>
      </ol>
    </>
  );
}

function A1Pipeline({ title, image, shaped, exportFile }: { title: string; image?: string; shaped: boolean; exportFile: () => string }) {
  const loaded = useCapture((s) => s.loaded)!;
  const record = useToneRecord();
  const go = useNav((s) => s.go);
  const toneId = loaded.source.kind === "tone" ? Number(loaded.source.ref) : null;
  const linked = record?.gp5.snaptoneSlot ?? null;

  const sendViaTones = () => {
    if (toneId === null || loaded.key.modelId === null) return;
    startSendDraft(toneId, loaded.key.modelId, proposeSlotName(record?.title ?? title), "snaptone", { text: exportFile() });
    openSheet(toneId);
    go("tones", String(toneId));
  };

  return (
    <>
      <div className="mx-5 grid grid-cols-[1fr_auto_1fr] items-start gap-1 rounded-lg bg-well px-1.5 py-2.5" aria-label="Chain of approximations">
        <Stop name={title} title="A1 standard" sub="This capture" lit caption="NAM A1" image={image} />
        <Hop top="Tone Studio" bottom="converts" />
        <Stop name={linked !== null ? `Slot ${linked}` : "SnapTone"} title="SnapTone" sub={linked !== null ? `Slot ${linked}` : "Can't be measured here"} lit={linked !== null} />
      </div>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-auto px-5 pt-3 pb-3">
        <Step n={1} status="done" title="Already A1 standard">
          <Sub>{shaped ? "Your shaping isn't in the file sent to the GP-5: baking it in needs the capture trainer, which this version doesn't include." : "No conversion needed. Your level and info edits go with it."}</Sub>
        </Step>
        {toneId !== null ? (
          <Step n={2} status={linked !== null ? "done" : "current"} title={linked !== null ? `Linked to slot ${linked} on your GP-5` : "Send to the GP-5"}>
            <Sub>Tone Studio turns your version into a SnapTone, writes it to a user slot over USB and links the slot to this tone.</Sub>
            <Button variant={linked !== null ? "outline" : "default"} size="sm" className="mt-2 self-start" onClick={sendViaTones}>
              <Send className="size-3.5" aria-hidden />
              {linked !== null ? "Send again" : "Send to GP-5…"}
            </Button>
          </Step>
        ) : (
          <LocalSend title={title} exportFile={exportFile} />
        )}
      </ol>
    </>
  );
}

type LocalPhase = "idle" | "converting" | "writing";

/** A file opened from disk: convert it and write a user SnapTone slot directly (no TONE3000 tone to link). */
function LocalSend({ title, exportFile }: { title: string; exportFile: () => string }) {
  const connected = useDevice((s) => s.status === "connected");
  const snapTones = useDevice((s) => s.snapTones);
  const deviceBusy = useDevice((s) => s.busy);
  const [name, setName] = useState(() => proposeSlotName(title));
  const [slot, setSlot] = useState<number | null>(null);
  const [phase, setPhase] = useState<LocalPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState<{ slot: number; name: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (connected && !snapTones && !deviceBusy) void useDevice.getState().readSnapTones().catch(() => {});
  }, [connected, snapTones, deviceBusy]);
  useEffect(() => {
    if (slot === null && snapTones) setSlot(firstEmptySlot("snaptone", snapTones));
  }, [slot, snapTones]);

  const occupant = slot === null ? null : snapTones?.find((s) => s.slot === slot)?.name;
  const replacing = occupant && !isEmptySlotName(occupant) ? occupant : null;

  const send = async () => {
    if (slot === null) return;
    abort.current = new AbortController();
    setError(null);
    setWritten(null);
    setProgress(0);
    setPhase("converting");
    try {
      const file = await convertToSnapTone(prepareNam(exportFile()).json, setProgress, abort.current.signal);
      setPhase("writing");
      setProgress(0);
      const stored = await useDevice.getState().uploadSnapTone(slot, name, file, { onProgress: setProgress });
      setWritten({ slot, name: stored });
      notifySuccess(`Wrote SnapTone slot ${slot} on your GP-5`, `The pedal calls it ${stored}.`);
    } catch (e) {
      if (!abort.current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  const working = phase !== "idle";
  return (
    <>
      <Step n={2} status={written ? "done" : error ? "fault" : "current"} title={written ? `Wrote slot ${written.slot} as ${written.name}` : "Write it to the GP-5"}>
        <Sub>Tone Studio turns it into a SnapTone (about 10 seconds) and writes a user slot over USB. GP-5 names hold 10 characters.</Sub>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <InputGroup className="w-36">
            <InputGroupInput
              aria-label="Name on the GP-5"
              value={name}
              maxLength={10}
              disabled={working}
              onChange={(e) => setName(sanitizeSlotName(e.target.value.toUpperCase()))}
              className="font-semibold tracking-[0.04em]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText className="tabular-nums">{name.length}/10</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <SnapToneSlotPicker value={slot} onChange={setSlot} disabled={working} />
        </div>
        {replacing && !working && written?.slot !== slot && <Sub>Replaces {replacing}. A SnapTone can't be read back from the pedal.</Sub>}
        {working && <Progress value={progress * 100} className="mt-2 w-56" aria-label={phase === "converting" ? "SnapTone conversion progress" : "SnapTone write progress"} />}
        {working && <Sub>{phase === "converting" ? "Making the SnapTone…" : `Writing slot ${slot}…`}</Sub>}
        <Button variant="default" size="sm" className="mt-2 self-start" disabled={!connected || slot === null || !name || working || Boolean(deviceBusy)} onClick={() => void send()}>
          {working ? <Spinner className="size-3.5" /> : <Send className="size-3.5" aria-hidden />}
          {replacing ? `Replace ${replacing} in slot ${slot}` : slot !== null ? `Write to slot ${slot}` : "Write to the GP-5"}
        </Button>
        {!connected && <Sub>Connect the GP-5 to write it.</Sub>}
        {error && (
          <span className="text-led-fault" role="alert">
            {error}
          </span>
        )}
      </Step>
      <Step n={3} status={written ? "done" : "pending"} title="Use it in a preset">
        <Sub>Files opened from disk aren't TONE3000 tones, so there's nothing to link back. Pick the slot in a preset's NS block.</Sub>
        {written && <UseOnGp5 isIr={false} slot={written.slot} />}
      </Step>
    </>
  );
}
