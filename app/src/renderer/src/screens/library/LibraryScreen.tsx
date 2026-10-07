import { useEffect, useState, useSyncExternalStore } from "react";
import { CircleCheckIcon, HardDriveDownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { notifyError } from "@/app/notify";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { useCommand, useFileHandler, useStatusHints, useStatusMessage } from "@/state/ui";
import { LibraryActionsProvider, useLibraryActions } from "./actions";
import { runBackupNow } from "./backup-now";
import { formatDay } from "./dnd";
import { Inspector } from "./Inspector";
import { LocalPane } from "./LocalPane";
import { SlotList } from "./SlotList";
import { useLibrary } from "./store";

const WIDE = "(min-width: 1400px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
  );
}

/** Preset librarian: presets on this computer, the 100 slots on the GP-5, and the selection's details. */
export function LibraryScreen() {
  return (
    <LibraryActionsProvider>
      <Library />
    </LibraryActionsProvider>
  );
}

function Library() {
  const wide = useMediaQuery(WIDE);
  const sheetOpen = useLibrary((s) => s.sheetOpen);
  const dragging = useLibrary((s) => s.drag !== null);
  const status = useDevice((s) => s.status);
  const snapTones = useDevice((s) => s.snapTones);
  const busy = useDevice((s) => s.busy);
  useLibraryWiring();

  useEffect(() => {
    void useLibrary.getState().refreshCollections().catch((e) => notifyError("Couldn't open the library", e));
  }, []);

  // SnapTone names for the "Amp or SnapTone" column: one read, no preset switching.
  useEffect(() => {
    if (status === "connected" && !snapTones && !busy) void useDevice.getState().readSnapTones().catch(() => {});
  }, [status, snapTones, busy]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LibraryHead />
      <div className={`relative grid min-h-0 flex-1 gap-4 px-4 pb-4 ${wide ? "grid-cols-[280px_minmax(0,1fr)_312px]" : "grid-cols-[280px_minmax(0,1fr)]"}`}>
        <LocalPane />
        <SlotList sheetMode={!wide} />
        {wide && (
          <aside id="library-inspector" aria-label="Selected preset" className="flex min-h-0 flex-col pt-1">
            <Inspector />
          </aside>
        )}
      </div>
      {!wide && (
        <Sheet open={sheetOpen && !dragging} onOpenChange={(o) => useLibrary.setState({ sheetOpen: o })} modal={false}>
          <SheetContent
            id="library-inspector"
            side="right"
            showCloseButton={false}
            onInteractOutside={(e) => e.preventDefault()}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="h-auto w-[344px] rounded-xl border-0 px-5 pt-[18px] pb-4 sm:max-w-none"
            style={{ top: 132, bottom: 46, right: 16 }}
          >
            <SheetTitle className="sr-only">Details</SheetTitle>
            <SheetDescription className="sr-only">The selected slot or preset</SheetDescription>
            <Inspector onClose={() => useLibrary.setState({ sheetOpen: false })} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** Commands, file hand-off and status bar for this screen. */
function useLibraryWiring() {
  const actions = useLibraryActions();
  const backingUp = useDevice((s) => s.busy?.kind === "backup");
  const drag = useLibrary((s) => s.drag);
  const connected = useDevice((s) => s.status === "connected");

  useCommand("import-presets", () => actions.importFiles());
  useCommand("backup-pedal", () => void runBackupNow());
  useCommand("export-preset", async () => {
    const { localSelected, presets, selected } = useLibrary.getState();
    const local = localSelected ? presets.find((p) => p.id === localSelected) : undefined;
    if (local) return actions.exportLocal([local]);
    const slots = selected.length ? selected : [useDevice.getState().slot ?? 0];
    return actions.exportSlots(slots);
  });
  useCommand("write-file-to-slot", async () => {
    const { localSelected, presets } = useLibrary.getState();
    const local = localSelected ? presets.find((p) => p.id === localSelected) : undefined;
    if (local) actions.writeLocal(local);
    else await actions.importFiles({ thenWrite: true });
  });
  useCommand("open-backups-folder", () => host.files.openBackupsFolder().catch((e) => notifyError("Couldn't open the backups folder", e)));
  useFileHandler("prst", (files) => actions.importOpenFiles(files));

  useStatusMessage(
    backingUp
      ? { led: "warn", text: "The pedal steps through every preset while it backs up. Turn your amp down." }
      : drag?.kind === "local"
        ? { led: "on", text: `Dragging ${drag.preset.name}: drop it on a slot to write it to the pedal` }
        : drag?.kind === "slots"
          ? { led: "on", text: "Drop on a slot to move, hold Alt to copy, or drop on a collection to save a copy" }
          : null,
  );
  useStatusHints(
    drag
      ? [
          { keys: ["Esc"], label: "cancel drag" },
          { keys: ["Alt"], label: "copy" },
        ]
      : [
          { keys: ["Shift"], label: "click range" },
          ...(connected ? [{ keys: ["Enter"], label: "play on pedal" }] : []),
          { keys: ["F2"], label: "rename" },
          { keys: ["Del"], label: "clear" },
        ],
  );
}

function LibraryHead() {
  const collections = useLibrary((s) => s.collections);
  const startedAt = useLibrary((s) => s.backupStartedAt);
  const job = useLibrary((s) => s.job);
  const busy = useDevice((s) => s.busy);
  const status = useDevice((s) => s.status);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const [, tick] = useState(0);
  const newest = collections.find((c) => c.kind === "backup");
  const backup = busy?.kind === "backup" ? busy : null;

  useEffect(() => {
    if (!backup) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [backup]);

  let right;
  if (backup) {
    const done = Math.round(backup.progress * 100);
    const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    const left = backup.progress > 0.02 ? Math.max(0, Math.round((elapsed / backup.progress) * (1 - backup.progress))) : null;
    right = (
      <div role="status" className="flex w-[420px] flex-col gap-1.5">
        <div className="flex justify-between gap-3 text-sm text-silkscreen-3">
          <span>
            Backing up slot <b className="font-semibold text-silkscreen">{Math.min(100, done + 1)}</b> of 100
          </span>
          <span>{left === null ? "About 75 s in total" : `About ${left} s left`}</span>
        </div>
        <Progress value={backup.progress * 100} aria-label="Backup progress" />
      </div>
    );
  } else if (job) {
    right = (
      <div role="status" className="flex w-[360px] flex-col gap-1.5">
        <span className="text-sm text-silkscreen-3">{job.label}</span>
        <Progress value={job.progress * 100} aria-label={job.label} />
      </div>
    );
  } else {
    const today = newest && formatDay(newest.createdAt) === formatDay(new Date().toISOString());
    right = (
      <>
        <div className="flex flex-col items-end gap-0.5 text-sm text-silkscreen-3">
          {newest ? (
            <>
              <span className="flex items-center gap-1.5">
                <CircleCheckIcon className="size-3.5" aria-hidden />
                Last {newest.count === 100 ? "full " : ""}backup{" "}
                <b className="font-semibold text-silkscreen">
                  {today ? "today, " : ""}
                  {formatDay(newest.createdAt)}
                </b>
              </span>
              <span>
                {newest.count} slots in {host.kind === "web" ? "this browser" : `backups/${newest.id.slice(newest.id.indexOf("/") + 1)}`}
              </span>
            </>
          ) : (
            <span>No backup yet. Back up before you change anything.</span>
          )}
        </div>
        <Button
          variant="outline"
          disabled={status !== "connected" || busy !== null || unsaved > 0}
          title={unsaved > 0 ? "Save or discard your unsaved changes on the Rig first" : status !== "connected" ? "Connect the GP-5 to back it up" : "Reads all 100 slots, about 75 s"}
          onClick={() => void runBackupNow()}
        >
          <HardDriveDownloadIcon data-icon="inline-start" />
          Back up now
        </Button>
      </>
    );
  }

  return (
    <div className="flex items-end gap-6 px-6 pt-5 pb-4">
      <h1 className="text-[32px] leading-none font-bold tracking-[-0.02em] text-balance text-silkscreen">Library</h1>
      <div className="ml-auto flex items-center gap-4">{right}</div>
    </div>
  );
}
