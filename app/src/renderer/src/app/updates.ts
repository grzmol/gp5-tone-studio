import { useEffect } from "react";
import { create } from "zustand";
import { releaseUrl, type UpdateSnapshot } from "@shared/host/update";
import { host, isElectron } from "@/host";
import { useDevice } from "@/state/device";
import { notifyError, notifySuccess, showToast } from "./notify";

/*
 * App updates in the renderer (src/shared/host/update.ts). Main owns the state; this mirrors it and drives the
 * update dialog (overlays/UpdateDialog.tsx): when a check finds a new version (the one at launch included) the
 * app asks whether to download and install it. "Later" keeps quiet about that version for the rest of the session.
 * Background check failures stay silent (Settings › About shows them); checks the user asked for always answer.
 */

interface UpdateStore {
  snapshot: UpdateSnapshot | null;
  /** The update dialog is showing */
  prompt: boolean;
  /** The user chose "Download and install": restart as soon as the download is verified, if nothing is at risk */
  accepted: boolean;
  /** Main was asked to quit and install */
  installing: boolean;
}

export const useUpdate = create<UpdateStore>(() => ({ snapshot: null, prompt: false, accepted: false, installing: false }));

/** Versions already offered this session. */
const offered = new Set<string>();
/** A user-started check reports its own result; the state listener stays quiet meanwhile. */
let userCheck = false;

/**
 * Why restarting now would cost the user something; null when it is safe. "busy": a pedal job main refuses to
 * interrupt (every long job except reading names). "unsaved": edits that only live in the pedal's buffer.
 */
export function restartBlocker(): { kind: "busy" | "unsaved"; message: string } | null {
  const d = useDevice.getState();
  if (d.busy && d.busy.kind !== "sync") return { kind: "busy", message: "The pedal is busy. Restart when it finishes its current job." };
  if (d.unsavedChanges > 0) return { kind: "unsaved", message: "The preset on the pedal has unsaved changes. Save them first, or restart now and lose them." };
  return null;
}

export const openReleasePage = (version: string) =>
  host.app.openExternal(releaseUrl(version)).catch((e) => notifyError("Couldn't open the release page", e));

export async function downloadUpdate(): Promise<void> {
  try {
    await host.update.download();
  } catch (e) {
    notifyError("Couldn't download the update", e);
  }
}

export async function installUpdate(): Promise<void> {
  useUpdate.setState({ installing: true });
  try {
    await host.update.install();
  } catch (e) {
    useUpdate.setState({ installing: false });
    notifyError("Couldn't restart to update", e);
  }
}

/** After a failed check or download main is in "error": ask again, then download what is offered when `download`. */
export async function retryUpdate(download: boolean): Promise<void> {
  const snap = await host.update.check();
  if (snap.state.status === "available" && download) await downloadUpdate();
}

function offer(snap: UpdateSnapshot): void {
  if (snap.state.status !== "available") return;
  offered.add(snap.state.version);
  useUpdate.setState({ prompt: true, accepted: false });
}

/** "Download and install" (or "Open release page" when this build can't install updates). */
export async function acceptUpdate(): Promise<void> {
  const snap = useUpdate.getState().snapshot;
  if (snap?.state.status !== "available") return;
  if (snap.mode !== "install") {
    useUpdate.setState({ prompt: false });
    await openReleasePage(snap.state.version);
    return;
  }
  useUpdate.setState({ accepted: true });
  await downloadUpdate();
}

/** "Later" / "Hide": a running download continues, a downloaded update installs when the app quits. */
export function closeUpdatePrompt(): void {
  useUpdate.setState({ prompt: false });
}

/** Help › Check for updates, the palette, Settings and About. Always reports the result. */
export async function checkForUpdates(): Promise<void> {
  if (!isElectron) return;
  userCheck = true;
  let snap: UpdateSnapshot;
  try {
    snap = await host.update.check();
  } catch (e) {
    notifyError("Couldn't check for updates", e, checkForUpdates);
    return;
  } finally {
    userCheck = false;
  }
  useUpdate.setState({ snapshot: snap });
  const { state } = snap;
  if (state.status === "current") notifySuccess("Tone Studio is up to date", `Version ${snap.current} is the newest release.`);
  else if (state.status === "error") notifyError("Couldn't check for updates", state, checkForUpdates);
  else if (state.status === "available") offer(snap);
  else useUpdate.setState({ prompt: true }); // downloading or ready: show where it is
}

function onSnapshot(next: UpdateSnapshot): void {
  const before = useUpdate.getState();
  const prev = before.snapshot?.state;
  useUpdate.setState({ snapshot: next });
  const { state } = next;
  if (state.status === "available" && !userCheck && !offered.has(state.version)) offer(next);
  if (state.status === "ready" && prev?.status === "downloading") {
    if (before.accepted && before.prompt && !restartBlocker()) void installUpdate();
    else if (!before.prompt) {
      showToast({
        tone: "ok",
        sticky: true,
        title: `Tone Studio ${state.version} is ready`,
        body: "It was downloaded and checked. Restart to install it, or it installs when you quit.",
        action: { label: "Restart now", run: installUpdate },
      });
    }
  }
  if (state.status === "error" && prev?.status === "downloading" && !before.prompt) notifyError("Couldn't download the update", state, () => retryUpdate(true));
}

/** Mirrors main's update state and opens the dialog for a new version. Mount once (AppShell). */
export function useUpdateWatch(): void {
  useEffect(() => {
    if (!isElectron) return;
    // The launch check may have finished before this listener existed.
    void host.update.state().then(onSnapshot, () => {});
    return host.update.onState(onSnapshot);
  }, []);
}
