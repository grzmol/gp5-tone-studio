import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { describeError, notifySuccess } from "@/app/notify";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { RestoreError } from "@/state/device-types";
import { runBackupNow } from "@/screens/library/backup-now";
import { isEmptyName } from "@/screens/library/store";
import { describeSlots, type RestoreSource } from "./restore";
import { useAppSettings } from "./settings-store";

type Failure = { message: string; done: number[]; failed: number | null; notStarted: number[] };

/**
 * Restore AlertDialog (device.md › Backups, `#restore`): names the source, which slots are replaced and what is
 * in them now, offers a full backup first, then writes slot by slot with read-back verification.
 */
export function RestoreDialog({ source, onOpenChange }: { source: RestoreSource | null; onOpenChange: (open: boolean) => void }) {
  const names = useDevice((s) => s.names);
  const busy = useDevice((s) => s.busy);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const connected = useDevice((s) => s.status === "connected");
  const backupDefault = useAppSettings((s) => s.settings.backupBeforeWrite);
  const [backupFirst, setBackupFirst] = useState(backupDefault);
  const [phase, setPhase] = useState<"confirm" | "backup" | "restore">("confirm");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState<RestoreSource["entries"] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const checkId = useId();

  useEffect(() => {
    if (!source) return;
    setBackupFirst(backupDefault);
    setPhase("confirm");
    setFailure(null);
    setPending(source.entries);
  }, [source, backupDefault]);

  if (!source) return null;
  const entries = pending ?? source.entries;
  const slots = entries.map((e) => e.slot);
  const all = slots.length === 100;
  const used = slots.filter((s) => !isEmptyName(names[s]?.name)).length;
  const running = phase !== "confirm";
  const count = `${slots.length} ${slots.length === 1 ? "slot" : "slots"}`;

  const run = async (list: RestoreSource["entries"], retry: boolean) => {
    setFailure(null);
    const d = useDevice.getState();
    try {
      if (d.unsavedChanges > 0) await d.discard();
      if (backupFirst && !retry) {
        setPhase("backup");
        const saved = await runBackupNow();
        if (!saved) {
          setPhase("confirm");
          return;
        }
      }
      setPhase("restore");
      abort.current = new AbortController();
      await d.restoreAll(list, {
        signal: abort.current.signal,
        onProgress: (done, total) => void host.app.setProgress(done / total).catch(() => {}),
      });
      notifySuccess(`${count} restored`, `${describeSlots(slots)} now hold the presets from ${source.title}. Each slot was checked by reading it back.`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof RestoreError) setFailure({ message: e.failed === null ? e.message : describeError(e.cause), done: e.done, failed: e.failed, notStarted: e.notStarted });
      else setFailure({ message: describeError(e), done: [], failed: null, notStarted: slots });
      setPhase("confirm");
    } finally {
      abort.current = null;
      void host.app.setProgress(null).catch(() => {});
    }
  };

  const retryFrom = () => {
    if (!failure) return;
    const rest = new Set([...(failure.failed === null ? [] : [failure.failed]), ...failure.notStarted]);
    const list = entries.filter((e) => rest.has(e.slot));
    setPending(list);
    void run(list, true);
  };

  const label = phase === "backup" ? (busy?.label ?? "Backing up the pedal") : (busy?.label ?? "Restoring");
  const progress = Math.round((busy?.progress ?? 0) * 100);

  return (
    <AlertDialog open onOpenChange={(open) => !running && onOpenChange(open)}>
      <AlertDialogContent className="sm:max-w-[520px]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {all ? "Restore all 100 slots" : `Restore ${count}`} from {source.title}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {all ? "Every preset on the GP-5 is replaced with the copy in this backup." : `${describeSlots(slots)} on the GP-5 are replaced with the copies in this folder.`} Presets you changed since then are
            lost unless you back them up first.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg bg-well px-3.5 py-3 text-sm">
          <dt className="text-silkscreen-3">From</dt>
          <dd className="truncate text-silkscreen" title={source.location}>
            {source.location}, {slots.length} {slots.length === 1 ? "preset" : "presets"}
          </dd>
          <dt className="text-silkscreen-3">Replaces</dt>
          <dd className="text-silkscreen">
            {describeSlots(slots)} on the pedal, now {used} {used === 1 ? "preset" : "presets"} and {slots.length - used} empty {slots.length - used === 1 ? "slot" : "slots"}
          </dd>
          <dt className="text-silkscreen-3">Checks</dt>
          <dd className="text-silkscreen">Each slot is read back after writing. Keep the pedal connected until it finishes.</dd>
          {source.skipped.length > 0 && (
            <>
              <dt className="text-silkscreen-3">Skipped</dt>
              <dd className="max-h-20 overflow-auto text-silkscreen-2">
                {source.skipped.map((s) => (
                  <div key={s}>{s}</div>
                ))}
              </dd>
            </>
          )}
        </dl>

        {unsaved > 0 && !running && (
          <p className="text-sm text-pretty text-silkscreen-2">
            The Rig has {unsaved} unsaved {unsaved === 1 ? "change" : "changes"}. Restoring discards {unsaved === 1 ? "it" : "them"} first.
          </p>
        )}

        {!failure && (
          <div className="flex items-start gap-2.5">
            <Checkbox id={checkId} checked={backupFirst} disabled={running} onCheckedChange={(v) => setBackupFirst(v === true)} className="mt-px" />
            <Label htmlFor={checkId} className="flex flex-col items-start gap-0.5 text-sm">
              <b className="font-semibold">Back up the pedal first</b>
              <span className="font-normal text-silkscreen-3">Saves what is on the pedal now to a new folder. Takes about 75 seconds.</span>
            </Label>
          </div>
        )}

        {running && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Progress value={progress} aria-label={label} />
            <span className="text-sm text-silkscreen-2">{label}</span>
          </div>
        )}

        {failure && (
          <div role="alert" className="flex flex-col gap-1 rounded-lg bg-well px-3.5 py-3 text-sm">
            <b className="font-semibold text-silkscreen">{failure.failed === null ? "The restore stopped" : `Slot ${String(failure.failed).padStart(2, "0")} failed after 3 attempts`}</b>
            <span className="text-pretty text-silkscreen-2">{failure.message}</span>
            <span className="text-silkscreen-3">Done: {failure.done.length ? describeSlots(failure.done) : "none"}</span>
            <span className="text-silkscreen-3">Not started: {failure.notStarted.length ? describeSlots(failure.notStarted) : "none"}</span>
          </div>
        )}

        <AlertDialogFooter>
          {running && phase === "restore" ? (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              Stop after this slot
            </Button>
          ) : (
            <AlertDialogCancel disabled={running}>{failure ? "Close" : "Cancel"}</AlertDialogCancel>
          )}
          {failure ? (
            (failure.failed !== null || failure.notStarted.length > 0) && (
              <Button variant="destructive" disabled={!connected || running} onClick={retryFrom}>
                <RefreshCw aria-hidden />
                Retry from slot {String(failure.failed ?? failure.notStarted[0]).padStart(2, "0")}
              </Button>
            )
          ) : (
            <Button variant="destructive" disabled={!connected || running || !slots.length} onClick={() => void run(entries, false)}>
              <RotateCcw aria-hidden />
              {backupFirst ? `Back up, then restore ${count}` : `Restore ${count}`}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
