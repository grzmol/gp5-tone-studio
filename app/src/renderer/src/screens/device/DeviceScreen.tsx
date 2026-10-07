import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { notifyError } from "@/app/notify";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import { useCommand, useStatusHints, useStatusMessage } from "@/state/ui";
import { BackupsPanel } from "./BackupsPanel";
import { ConnectionHeader } from "./ConnectionHeader";
import { DiagnosticsPanel, copyReport, useChecks } from "./DiagnosticsPanel";
import { connectionView } from "./guidance";
import { PedalSettings, RawRecords } from "./PedalSettings";
import { SettingsView } from "./SettingsView";
import { useAppSettings } from "./settings-store";

const HINTS = [
  { keys: ["Mod", "Shift", "B"], label: "back up now" },
  { keys: ["Mod", ","], label: "settings" },
];

/** Device (connection, pedal settings, backups, diagnostics) and, with `param=settings`, app Settings. */
export function DeviceScreen() {
  const param = useNav((s) => s.param);
  useStatusHints(HINTS);
  return param === "settings" ? <SettingsView /> : <DevicePage />;
}

function DevicePage() {
  const input = useDevice(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      mode: s.mode,
      hostStatus: s.hostStatus,
      disconnectReason: s.disconnectReason,
      lastConnectedAt: s.lastConnectedAt,
    })),
  );
  const view = connectionView({ ...input, platform: host.platform });
  const checks = useChecks();
  const [guideOpen, setGuideOpen] = useState(view.openGuide);
  const guideRef = useRef<HTMLDivElement>(null);

  useStatusMessage({ led: view.led, text: view.statusText });

  // The driver-problem state opens the Windows 11 guide by itself.
  useEffect(() => {
    if (view.openGuide) setGuideOpen(true);
  }, [view.openGuide]);

  // Host checks feed the Diagnostics card; run them once when the page opens if nothing ran yet.
  useEffect(() => {
    if (!useDevice.getState().hostStatus) void useDevice.getState().checkHost();
    void useAppSettings.getState().load().catch(() => {});
  }, []);

  useCommand("diagnostics-report", () => copyReport(checks));
  useCommand("open-backups-folder", () => host.files.openBackupsFolder().catch((e) => notifyError("Couldn't open the backups folder", e)));

  const showFix = () => {
    setGuideOpen(true);
    requestAnimationFrame(() => guideRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }));
  };

  return (
    <div className="h-full overflow-auto">
      <ConnectionHeader view={view} onShowFix={showFix} />
      <div className="flex flex-col gap-4 px-7 pt-[26px] pb-7">
        <PedalSettings offline={view.offline} />
        <RawRecords />
        <div className="grid grid-cols-2 items-start gap-4">
          <BackupsPanel offline={view.offline} />
          <DiagnosticsPanel guideOpen={guideOpen} onGuideOpenChange={setGuideOpen} guideRef={guideRef} />
        </div>
      </div>
    </div>
  );
}
