import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useDevice } from "@/state/device";
import type { UpdateState } from "@shared/host/update";
import { acceptUpdate, closeUpdatePrompt, installUpdate, openReleasePage, restartBlocker, retryUpdate, useUpdate } from "../updates";

type Shown = Exclude<UpdateState, { status: "idle" } | { status: "checking" } | { status: "current" }>;

/** "Tone Studio X is available. Download and install it now?" — raised by the launch check and by every check that finds a new version. */
export function UpdateDialog() {
  const prompt = useUpdate((s) => s.prompt);
  const snap = useUpdate((s) => s.snapshot);
  const accepted = useUpdate((s) => s.accepted);
  const installing = useUpdate((s) => s.installing);
  // Re-render when a pedal job or unsaved edits start or end: they decide whether "Restart now" is safe.
  useDevice((s) => `${s.busy?.kind ?? ""}:${s.unsavedChanges > 0}`);

  // A background check passes through "checking"; keep showing the last state meanwhile and while closing.
  const shown = useRef<Shown | null>(null);
  const state = snap?.state;
  if (state && state.status !== "idle" && state.status !== "checking" && state.status !== "current") shown.current = state;
  const view = shown.current;
  const open = prompt && !!view;
  const installs = snap?.mode === "install";
  const blocker = view?.status === "ready" ? restartBlocker() : null;
  const restarting = view?.status === "ready" && installing;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && closeUpdatePrompt()}>
      <AlertDialogContent className="w-[480px] max-w-[calc(100vw-48px)] gap-4 sm:max-w-[480px]">
        {view && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg font-semibold text-balance">
                {view.status === "available" && `Tone Studio ${view.version} is available`}
                {view.status === "downloading" && `Downloading Tone Studio ${view.version}`}
                {view.status === "ready" && (restarting ? `Installing Tone Studio ${view.version}` : `Tone Studio ${view.version} is ready to install`)}
                {view.status === "error" && "Couldn't update Tone Studio"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[13px] text-pretty text-silkscreen-2">
                {view.status === "available" &&
                  (installs
                    ? `You have version ${snap?.current}. Download and install the new version now? Tone Studio restarts to finish; presets, backups and settings stay as they are.`
                    : `You have version ${snap?.current}. This build can't install updates by itself. Open the release page to download the new version?`)}
                {view.status === "downloading" && "The installer is checked against the release's checksum before anything is installed. You can keep working meanwhile."}
                {view.status === "ready" &&
                  (restarting ? "Tone Studio closes and starts again with the new version." : (blocker?.message ?? "Downloaded and checked. Restart to install it now, or it installs when you quit."))}
                {view.status === "error" && view.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {view.status === "downloading" && (
              <div className="flex items-center gap-3">
                <Progress value={view.percent} aria-label="Download progress" className="flex-1" />
                <span className="w-10 text-right text-xs text-silkscreen-2 tabular-nums">{view.percent}%</span>
              </div>
            )}
            <AlertDialogFooter>
              {view.status === "available" && (
                <>
                  {installs && (
                    <Button variant="ghost" className="mr-auto -ml-2.5 px-2.5" onClick={() => void openReleasePage(view.version)}>
                      What's new
                    </Button>
                  )}
                  <Button variant="outline" onClick={closeUpdatePrompt}>
                    Later
                  </Button>
                  <Button autoFocus onClick={() => void acceptUpdate()}>
                    {installs ? "Download and install" : "Open release page"}
                  </Button>
                </>
              )}
              {view.status === "downloading" && (
                <Button variant="outline" onClick={closeUpdatePrompt}>
                  Hide
                </Button>
              )}
              {view.status === "ready" &&
                (restarting ? (
                  <Button disabled>
                    <Spinner />
                    Restarting
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={closeUpdatePrompt}>
                      Install when I quit
                    </Button>
                    <Button autoFocus disabled={blocker?.kind === "busy"} onClick={() => void installUpdate()}>
                      Restart now
                    </Button>
                  </>
                ))}
              {view.status === "error" && (
                <>
                  <Button variant="outline" onClick={closeUpdatePrompt}>
                    Close
                  </Button>
                  <Button autoFocus onClick={() => void retryUpdate(accepted)}>
                    Try again
                  </Button>
                </>
              )}
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
