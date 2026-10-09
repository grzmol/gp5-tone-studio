import { useEffect } from "react";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import { reconnect } from "./commands";
import { notifySuccess, showToast } from "./notify";

/**
 * Shell reactions to the device store: a toast when the GP-5 goes away or comes back (overlays.md C/G)
 * and taskbar/dock progress for long jobs (electron.md › Hardware access).
 */
export function useDeviceWatch(): void {
  useEffect(() => {
    let lostAt: number | null = null;
    let lastProgress: number | null = null;
    return useDevice.subscribe((s, prev) => {
      if (prev.status === "connected" && s.status === "disconnected" && s.disconnectReason === "lost") {
        lostAt = Date.now();
        const edits = s.unsavedChanges;
        showToast({
          tone: "fault",
          title: "The GP-5 disconnected",
          body: `Check the USB cable and power. Tone Studio tries to reconnect on its own.${edits ? ` Your ${edits} unsaved change${edits === 1 ? " is" : "s are"} still here.` : ""}`,
          action: { label: "Reconnect", run: reconnect, retry: true },
        });
      }
      if (s.status === "connected" && prev.status !== "connected" && lostAt !== null) {
        lostAt = null;
        notifySuccess("The GP-5 is back", "Reconnected over USB.", { label: "Open Rig", run: () => useNav.getState().go("rig") });
      }
      const progress = s.busy && s.busy.kind !== "sync" ? s.busy.progress : null;
      if (progress !== lastProgress && (progress === null || lastProgress === null || Math.abs(progress - lastProgress) >= 0.01)) {
        lastProgress = progress;
        void host.app.setProgress(progress).catch(() => {});
      }
    });
  }, []);
}
