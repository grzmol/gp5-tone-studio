import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Info, Wand2 } from "lucide-react";
import type { T3kModel, T3kTone } from "@shared/host/tones";
import { HostError } from "@shared/ipc";
import { ARCH_LABEL, gearLabel, gp5Models, isGp5Model, licenseLabel, modelsVerdict, proposeSlotName, verdictLabel } from "@shared/tone3000";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { notifyError } from "@/app/notify";
import { browse, cancelSend, closeSheet, loadAccount, startSendDraft, updateDraft, useTones } from "./store";
import { CreatorAvatar } from "./ToneCard";
import { UserIrSteps, UseOnGp5 } from "./SendSteps";
import { SnapToneSteps } from "./SnapToneSteps";
import { ToneImage } from "./ToneImage";

/** Tone detail (TONE3000 requirement 6) with the model picker and the Send to GP-5 flow. */
export function ToneSheet() {
  const sheet = useTones((s) => s.sheet);
  return (
    <Sheet open={sheet !== null} onOpenChange={(open) => !open && closeSheet()}>
      <SheetContent side="right" className="w-[520px] gap-0 rounded-l-xl border-l-0 p-0 sm:max-w-[520px]" aria-describedby={undefined}>
        {sheet && <SheetBody key={sheet.toneId} toneId={sheet.toneId} initial={sheet.tone} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ toneId, initial }: { toneId: number; initial: T3kTone | null }) {
  const account = useTones((s) => s.account);
  const record = useTones((s) => s.records[toneId]);
  const send = useTones((s) => s.send[toneId]);
  const signedIn = account?.status === "signed-in";
  const [tone, setTone] = useState<T3kTone | null>(initial);
  const [models, setModels] = useState<T3kModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    Promise.all([initial ? Promise.resolve(initial) : host.tones.tone(toneId), host.tones.models(toneId)]).then(
      ([t, m]) => {
        if (!live) return;
        setTone(t);
        setModels(m);
      },
      (e) => {
        if (!live) return;
        if (e instanceof HostError && e.code === "unauthorized") void loadAccount();
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [toneId, initial, signedIn]);

  // Without TONE3000 data (signed out), the local record still describes the tone.
  const title = tone?.title ?? record?.title ?? "Tone";
  const gear = tone?.gear ?? record?.gear ?? "amp";
  const format = tone?.format ?? record?.format ?? "nam";
  const isIr = format === "ir";
  const creator = tone ? { username: tone.user.display_name ?? tone.user.username, avatar_url: tone.user.avatar_url } : record?.creator;
  const image = tone?.images?.[0] ?? record?.image_url ?? null;
  const url = tone?.url ?? record?.url ?? null;
  const verdict = models ? modelsVerdict(format, models, record) : null;
  const sendable = useMemo(() => (isIr ? (models ?? []) : gp5Models(models ?? [])), [models, isIr]);

  // A draft send exists as soon as the models are known, so the model radio and name drive it.
  useEffect(() => {
    if (!models || !tone || send || sendable.length === 0) return;
    startSendDraft(toneId, sendable[0].id, proposeSlotName(tone.title, isIr ? undefined : sendable[0].name), isIr ? "ir" : "snaptone");
  }, [models, tone, send, sendable, toneId, isIr]);

  const selected = models?.find((m) => m.id === send?.modelId);
  const locked = send && send.phase !== "idle" && send.phase !== "error";
  const stepNo = send ? (send.phase === "linked" ? 5 : send.phase === "idle" ? 1 : send.step) : 1;
  const editCapture = () => {
    closeSheet();
    useNav.getState().go("capture", String(toneId));
  };
  const linkedSlot = record?.gp5.snaptoneSlot ?? record?.gp5.irSlot;

  return (
    <>
      <SheetHeader className="flex-row items-start gap-4 border-b border-border py-5 pr-12 pl-6 [@media(max-height:800px)]:py-4">
        <ToneImage url={image} gear={gear} format={format} alt="" square className="w-[104px]" />
        <div className="flex min-w-0 grow flex-col">
          <SheetTitle className="mt-0.5 mb-2 text-[24px] leading-[1.15] font-[680] tracking-[-0.01em] text-balance">{title}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 [@media(max-height:800px)]:gap-y-1">
              <span className="mr-1 text-[11px] font-extrabold tracking-[0.02em] text-silkscreen-2">TONE3000</span>
              {creator && (
                <span className="mr-1 flex items-center gap-1.5 text-[12px] text-silkscreen-2">
                  <CreatorAvatar username={creator.username} url={creator.avatar_url} />
                  {creator.username}
                </span>
              )}
              <Badge variant="outline">{gearLabel(gear)}</Badge>
              <Badge variant="outline">{isIr ? "IR" : format.toUpperCase()}</Badge>
              {url && (
                <Button variant="link" size="sm" className="h-8 px-1" onClick={() => host.app.openExternal(url).catch((e) => notifyError("Couldn't open the tone page", e))}>
                  <ExternalLink data-icon="inline-start" />
                  Tone page
                </Button>
              )}
            </div>
          </SheetDescription>
        </div>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-6 pt-4 pb-5 [@media(max-height:800px)]:gap-3.5 [@media(max-height:800px)]:pt-3">
        <dl className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-5 gap-y-2.5">
          <Fact label="License" value={licenseLabel(tone?.license ?? record?.license ?? "")} />
          <Fact label="Updated" value={tone ? tone.updated_at.slice(0, 10) : record ? record.savedAt.slice(0, 10) : "—"} />
          <Fact label="Downloads" value={tone ? tone.downloads_count.toLocaleString() : "—"} />
        </dl>
        {gear === "amp-cab" && !isIr && (
          <p className="-mt-1.5 flex gap-2 text-[12px] text-pretty text-silkscreen-3">
            <Info className="mt-0.5 size-3.5 flex-none" aria-hidden />
            This capture includes the cab. On the GP-5 a SnapTone replaces both AMP and CAB, so it plays complete.
          </p>
        )}
        {tone?.description && (
          <div className="flex flex-col items-start gap-1 text-[12px] text-silkscreen-2">
            <p className={cn("whitespace-pre-line text-pretty", !expanded && "line-clamp-3")}>{tone.description}</p>
            {tone.description.length > 220 && (
              <Button variant="link" size="sm" className="h-8 px-0" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Show less" : "Read more"}
              </Button>
            )}
          </div>
        )}

        {!signedIn ? (
          <section className="flex flex-col items-start gap-2 text-[12px] text-silkscreen-2">
            <p>{account?.status === "expired" ? "Your TONE3000 sign-in expired." : "Sign in to TONE3000 to see this tone's models and send one to the GP-5."}</p>
            {account?.configured && (
              <Button size="sm" onClick={() => browse({ prompt: "load_tone", toneId })}>
                {account?.status === "expired" ? "Sign in again" : "Sign in to TONE3000"}
              </Button>
            )}
            {linkedSlot !== undefined && <UseOnGp5 isIr={isIr} slot={linkedSlot} />}
          </section>
        ) : error ? (
          <p role="alert" className="text-[12px] text-led-fault">
            {error}
          </p>
        ) : (
          <section aria-label="Models" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <h3 className="text-[12px] font-semibold text-silkscreen-2">Models in this tone</h3>
              <span className="text-silkscreen-3">{isIr ? "WAV impulse responses" : "A1 and A2 become SnapTones"}</span>
            </div>
            {!models ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : models.length === 0 ? (
              <p className="text-[12px] text-silkscreen-3">This tone has no models you can download.</p>
            ) : (
              <RadioGroup
                aria-label="Model to send"
                value={send ? String(send.modelId) : ""}
                onValueChange={(v) => {
                  const m = models.find((x) => String(x.id) === v);
                  if (m && tone) updateDraft(toneId, { modelId: m.id, name: send?.name || proposeSlotName(tone.title, m.name) });
                }}
                disabled={Boolean(locked)}
                className="gap-0 border-y border-seam"
              >
                {models.map((m) => {
                  const ok = isIr || isGp5Model(m);
                  const id = `model-${m.id}`;
                  return (
                    <label
                      key={m.id}
                      htmlFor={id}
                      className={cn(
                        "flex h-8 items-center gap-3 px-3 text-[12px] [&+&]:border-t [&+&]:border-seam",
                        ok ? "cursor-pointer text-silkscreen" : "cursor-default text-silkscreen-3",
                        send?.modelId === m.id && "bg-faceplate",
                      )}
                    >
                      <RadioGroupItem id={id} value={String(m.id)} disabled={!ok} />
                      <span className="min-w-0 grow truncate">{m.name}</span>
                      {!isIr && <span className={cn("w-[92px]", ok ? "text-silkscreen-2" : "text-silkscreen-4")}>{ARCH_LABEL(m)}</span>}
                      <span className={cn("w-[104px]", ok ? "text-silkscreen-2" : "text-silkscreen-4")}>{ok ? "Works on GP-5" : "Not for GP-5"}</span>
                    </label>
                  );
                })}
              </RadioGroup>
            )}
            {!isIr && models && (
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-silkscreen-3">
                {verdict?.kind === "not-loadable" && <span className="grow">{verdictLabel(verdict)}.</span>}
                <Button variant="ghost" size="sm" onClick={editCapture}>
                  <Wand2 data-icon="inline-start" />
                  Edit capture
                </Button>
              </div>
            )}
          </section>
        )}

        {signedIn && send && (
          <section aria-label="Send to GP-5" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <h3 className="text-[12px] font-semibold text-silkscreen-2">Send to GP-5</h3>
              <span className="text-silkscreen-3">Step {stepNo} of 5</span>
            </div>
            {send.text && <p className="text-[12px] text-silkscreen-2">Sends your edited version from the capture editor, made from the selected model.</p>}
            {isIr ? <UserIrSteps send={send} model={selected} /> : <SnapToneSteps send={send} model={selected} />}
          </section>
        )}
      </div>

      <SheetFooter className="mt-0 flex-row items-center gap-4 border-t border-border py-3 pr-5 pl-6 text-[11px] [@media(max-height:800px)]:py-2.5">
        <span className="flex-1 text-pretty text-silkscreen-3">
          {isIr ? "Tone Studio writes the IR to a User IR slot over USB. Valeton Suite isn't needed." : "Tone Studio writes the SnapTone over USB. Valeton Suite isn't needed."}
        </span>
        {send && send.phase !== "idle" && send.phase !== "linked" && (
          <Button variant="ghost" size="sm" disabled={send.phase === "running" || send.phase === "writing"} onClick={() => cancelSend(toneId)}>
            Cancel send
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-silkscreen-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[12px] text-silkscreen">{value || "—"}</dd>
    </div>
  );
}
