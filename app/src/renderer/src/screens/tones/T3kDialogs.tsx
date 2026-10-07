import { useEffect, useLayoutEffect, useState } from "react";
import { Cable, Filter, FolderOpen, LogIn, X } from "lucide-react";
import type { ViewBounds } from "@shared/host/tones";
import { isEmptySlotName, sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import type { OpenFile } from "@/state/ui";
import { notifyError, notifySuccess } from "@/app/notify";
import { closeFlow, closeLinkChoice, closeSplash, continueFromSplash, finishSuite, linkSlot, loadAccount, loadAllCounts, loadList, openSheet, useTones } from "./store";
import { ToneImage } from "./ToneImage";

/** TONE3000 partnership splash (overlays.html E), before the first sign-in from any entry point. */
export function SplashDialog() {
  const open = useTones((s) => s.splashOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeSplash()}>
      <DialogContent className="max-w-[460px] gap-5 p-7" showCloseButton={false}>
        <DialogHeader className="gap-4">
          <DialogTitle className="flex items-center gap-3 text-[15px]">
            <span className="flex items-center gap-2 font-semibold">
              <Cable className="size-4" aria-hidden />
              GP-5 Tone Studio
            </span>
            <span className="text-silkscreen-3" aria-label="and">
              ×
            </span>
            <span className="text-[12px] font-extrabold tracking-[0.02em] text-silkscreen">TONE3000</span>
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-[1.5] text-pretty text-silkscreen-2">
            GP-5 Tone Studio has partnered with TONE3000 to give you access to a massive library of Neural Amp Modeler (NAM) captures and IRs of real analog gear, created by a
            global community of musicians.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2.5 text-[12px] text-silkscreen-2">
          <li className="flex gap-2.5">
            <LogIn className="size-4 flex-none text-silkscreen-3" aria-hidden />
            Sign in on TONE3000 with your email and a 6-digit code.
          </li>
          <li className="flex gap-2.5">
            <Filter className="size-4 flex-none text-silkscreen-3" aria-hidden />
            The GP-5 plays NAM A1 standard captures, so the picker asks for those.
          </li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={closeSplash}>
            Not now
          </Button>
          <Button onClick={continueFromSplash} autoFocus>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function boundsOf(el: HTMLElement): ViewBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * The Select / Load Tone flow: TONE3000 renders in a native WebContentsView that main lays over the area of
 * the host element; the dialog frame (title, Close) stays outside it so the app can always cancel.
 */
export function FlowDialog() {
  const open = useTones((s) => s.flowOpen);
  const req = useTones((s) => s.flow);
  // Callback ref: the dialog portal mounts its content one render after `open` flips.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useLayoutEffect(() => {
    if (!open || !req || !el) return;
    setError(null);
    setRunning(true);
    let live = true;
    void host.tones.beginFlow(req, boundsOf(el)).then(
      async (result) => {
        if (!live) return;
        setRunning(false);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        closeFlow();
        if (result.status === "connected") {
          await loadAccount();
          loadAllCounts();
          void loadList(useTones.getState().tab, { refresh: true });
          if (result.toneId) openSheet(result.toneId);
        }
      },
      (e) => {
        if (!live) return;
        setRunning(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    // Track the frame: dialog open animation, window resizes.
    const sync = () => void host.tones.setFlowBounds(boundsOf(el));
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    const settle = window.setTimeout(sync, 260);
    return () => {
      live = false;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.clearTimeout(settle);
      void host.tones.cancelFlow();
    };
  }, [open, req, el]);

  const title = req?.prompt === "load_tone" ? "Sign in to TONE3000" : req?.format === "ir" ? "Browse TONE3000 IRs" : "Browse TONE3000";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeFlow()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100vh-96px)] w-[min(960px,calc(100vw-96px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        aria-describedby={undefined}
        onEscapeKeyDown={() => closeFlow()}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-border py-2 pr-2 pl-5">
          <span className="text-[12px] font-extrabold tracking-[0.02em] text-silkscreen">TONE3000</span>
          <DialogTitle className="grow text-[13px] font-semibold text-silkscreen-2">{title}</DialogTitle>
          <Button variant="ghost" size="icon-sm" aria-label="Close TONE3000" onClick={closeFlow}>
            <X />
          </Button>
        </DialogHeader>
        <div ref={setEl} className="relative min-h-0 flex-1 bg-well">
          {(running || error) && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              {error ? (
                <div className="flex max-w-sm flex-col items-center gap-3">
                  <p role="alert" className="text-[13px] text-pretty text-silkscreen-2">
                    {error}
                  </p>
                  <Button variant="outline" onClick={closeFlow}>
                    Close
                  </Button>
                </div>
              ) : (
                <Spinner aria-label="Loading TONE3000" />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pick the slot Suite used (several or no changes found), or the tone a slot holds (slot context menu). */
export function LinkDialog() {
  const choice = useTones((s) => s.linkChoice);
  const records = useTones((s) => s.records);
  const snapTones = useDevice((s) => s.snapTones);
  const userIRs = useDevice((s) => s.userIRs);
  const [busy, setBusy] = useState(false);
  const kindWord = choice?.kind === "ir" ? "User IR" : "SnapTone";

  const link = async (toneId: number, slot: number) => {
    if (!choice) return;
    setBusy(true);
    try {
      await linkSlot(toneId, choice.kind, slot);
    } catch (e) {
      notifyError("Couldn't link the slot", e);
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode = null;
  let title = "";
  let description = "";
  if (choice?.mode === "slot") {
    const rec = records[choice.toneId];
    const table = (choice.kind === "snaptone" ? snapTones?.filter((s) => s.slot >= 50) : userIRs) ?? [];
    const filled = table.filter((s) => !isEmptySlotName(s.name));
    title = `Which ${kindWord} slot holds ${rec?.gp5.pending?.fileName ?? rec?.title ?? "it"}?`;
    description = choice.candidates.length
      ? `${choice.candidates.length} slots changed while Valeton Suite was open. Pick the one you imported into.`
      : `Tone Studio didn't find a new ${kindWord} on the pedal. Pick the slot you imported it into, or close this and try again after importing.`;
    body = (
      <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-auto">
        {filled.map((s) => (
          <Button
            key={s.slot}
            variant={choice.candidates.includes(s.slot) ? "default" : "outline"}
            size="sm"
            disabled={busy}
            className="justify-start"
            onClick={() => void link(choice.toneId, s.slot)}
          >
            <span className="tabular-nums">{s.slot}</span>
            <span className="truncate">{s.name}</span>
          </Button>
        ))}
        {filled.length === 0 && <p className="col-span-3 text-[12px] text-silkscreen-3">No filled user slots. Read the slots again after importing in Suite.</p>}
      </div>
    );
  } else if (choice?.mode === "tone") {
    const list = Object.values(records).filter((r) => (choice.kind === "snaptone" ? r.format === "nam" : r.format === "ir"));
    const slotName = (choice.kind === "snaptone" ? snapTones : userIRs)?.find((s) => s.slot === choice.slot)?.name ?? "";
    title = `Link ${kindWord} ${choice.slot} ${slotName} to a TONE3000 tone`;
    description = "Pick the downloaded tone this slot holds. Linking only adds a note in Tone Studio; nothing changes on the pedal.";
    body = (
      <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
        {list.map((r) => (
          <li key={r.tone_id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void link(r.tone_id, choice.slot)}
              className="flex w-full items-center gap-3 rounded-sm p-1.5 text-left hover:bg-accent disabled:opacity-50"
            >
              <ToneImage url={r.image_url} gear={r.gear} format={r.format} alt="" square caption={false} className="w-10 [&_svg]:size-4" />
              <span className="flex min-w-0 flex-col">
                <b className="truncate text-[13px] font-semibold">{r.title}</b>
                <span className="text-[12px] text-silkscreen-3">{r.creator.username}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog open={choice !== null} onOpenChange={(o) => !o && closeLinkChoice()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button variant="ghost" onClick={closeLinkChoice}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A WAV dropped onto the app: check it, put it in the hand-off folder, then Suite does the import. */
export function LocalIrDialog({ file, onClose }: { file: OpenFile | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ path: string; fileName: string } | null>(null);
  const [before, setBefore] = useState<string[] | null>(null);
  const userIRs = useDevice((s) => s.userIRs);
  const linux = host.platform === "linux";

  useEffect(() => {
    if (!file) return;
    setName(sanitizeSlotName(file.name.replace(/\.wav$/i, "").toUpperCase()));
    setReady(null);
    setError(null);
    setBefore(null);
  }, [file]);

  // After Suite: report which User IR slot changed (local files have no TONE3000 link).
  useEffect(() => {
    if (!before || !userIRs || !ready) return;
    const changed = userIRs.filter((s) => before[s.slot] !== undefined && before[s.slot] !== s.name && !isEmptySlotName(s.name));
    if (changed.length === 1) {
      notifySuccess(`${ready.fileName} is in User IR slot ${changed[0].slot}`, `The pedal calls it ${changed[0].name}.`);
      onClose();
    }
  }, [userIRs, before, ready, onClose]);

  const prepare = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = file.path ? null : file.file ? new Uint8Array(await file.file.arrayBuffer()) : null;
      setReady(await host.tones.prepareLocalIr({ path: file.path, bytes, name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const openSuite = async () => {
    const d = useDevice.getState();
    try {
      const table = d.status === "connected" ? (d.userIRs ?? (await d.readUserIRs())) : d.userIRs;
      if (table) setBefore(Array.from({ length: 20 }, (_, i) => table.find((s) => s.slot === i)?.name ?? ""));
      await host.tones.openSuite();
      if (d.status === "connected") {
        useTones.setState({ pausedMode: d.mode });
        await d.disconnect();
      }
    } catch (e) {
      notifyError("Couldn't open Valeton Suite", e);
    }
  };

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Send {file?.name} to a User IR slot</DialogTitle>
          <DialogDescription>
            {ready
              ? linux
                ? `Valeton Suite runs on Windows and macOS. Copy ${ready.fileName} to a computer with Suite, import it, then reconnect the pedal here.`
                : `Valeton Suite does the import. Import ${ready.fileName} into a free User IR slot, then close Suite. Tone Studio lets go of the USB connection while Suite is open.`
              : "Tone Studio checks the WAV and puts it in the Ready for Valeton Suite folder."}
          </DialogDescription>
        </DialogHeader>
        {!ready && (
          <label className="flex items-center gap-2 text-[12px] text-silkscreen-2">
            Name on the pedal
            <Input value={name} maxLength={10} onChange={(e) => setName(sanitizeSlotName(e.target.value.toUpperCase()))} className="h-8 w-36" />
            <span className="text-[11px] text-silkscreen-3">{name.length}/10</span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-led-fault">
            {error}
          </p>
        )}
        <DialogFooter className={cn(ready && "sm:justify-between")}>
          {ready ? (
            <>
              <Button variant="ghost" onClick={() => host.app.showItemInFolder(ready.path).catch((e) => notifyError("Couldn't show the file", e))}>
                <FolderOpen data-icon="inline-start" />
                Show file
              </Button>
              {before ? (
                <Button onClick={() => void finishSuite()}>Find it on the pedal</Button>
              ) : linux ? (
                <Button onClick={onClose}>Done</Button>
              ) : (
                <Button onClick={() => void openSuite()}>Open Valeton Suite</Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!name || busy} onClick={() => void prepare()}>
                {busy && <Spinner data-icon="inline-start" />}
                Prepare for Valeton Suite
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
