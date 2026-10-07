import { useCallback, useState, type Ref } from "react";
import { ChevronDown, CircleCheck, CircleX, Copy, Download, ExternalLink, Info, LoaderCircle, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyError, notifySuccess } from "@/app/notify";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { getMidiLog, useDevice } from "@/state/device";
import { formatLogLine } from "@/state/midi-log";
import { clock, diagnosticChecks, type Check, type CheckState } from "./guidance";
import { buildReport } from "./report";
import { MidiLog } from "./MidiLog";

const FIX_URL = "https://github.com/cesardamien/hotone-family-firmware-fix";

const STATE_ICON: Record<CheckState, { icon: typeof CircleCheck; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-led-on", label: "OK" },
  warn: { icon: TriangleAlert, className: "text-led-warn", label: "Warning" },
  fault: { icon: CircleX, className: "text-led-fault", label: "Problem" },
  idle: { icon: CircleX, className: "text-silkscreen-4", label: "Not found" },
  pending: { icon: LoaderCircle, className: "text-silkscreen-4 animate-spin motion-reduce:animate-none", label: "Checking" },
};

/** Inputs for the checklist and the report, read from the store at the moment they're needed. */
export function useChecks(): Check[] {
  const status = useDevice((s) => s.status);
  const error = useDevice((s) => s.error);
  const mode = useDevice((s) => s.mode);
  const hostStatus = useDevice((s) => s.hostStatus);
  const portName = useDevice((s) => s.portName);
  return diagnosticChecks({
    status,
    error,
    mode,
    hostStatus,
    portName,
    platform: host.platform,
    webmidi: typeof navigator.requestMIDIAccess === "function",
    chrome: hostStatus?.versions.chrome ?? null,
  });
}

/** Builds the plain-text report from the current state (Copy / Save / Help menu). */
export async function currentReport(checks: Check[]): Promise<string> {
  const d = useDevice.getState();
  return buildReport({
    appVersion: await host.app.version().catch(() => "unknown"),
    platform: host.platform,
    host: d.hostStatus ?? (await d.checkHost()),
    checks,
    status: d.status,
    mode: d.mode,
    portName: d.portName,
    connectionError: d.error,
    lastError: d.lastError,
    monitor: d.monitor ? getMidiLog() : null,
  });
}

export async function copyReport(checks: Check[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(await currentReport(checks));
    notifySuccess("Diagnostic report copied", "Paste it into a bug report or a message. It has no preset contents or account data.");
  } catch (e) {
    notifyError("Couldn't copy the report", e);
  }
}

async function saveReport(checks: Check[]): Promise<void> {
  try {
    const d = new Date();
    const name = `gp5-diagnostics-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.txt`;
    const path = await host.device.saveReport(await currentReport(checks), name);
    if (path) notifySuccess("Diagnostic report saved", path);
  } catch (e) {
    notifyError("Couldn't save the report", e);
  }
}

interface Props {
  guideOpen: boolean;
  onGuideOpenChange: (open: boolean) => void;
  guideRef: Ref<HTMLDivElement>;
}

/** Diagnostics card: OS/USB/port checks, the Windows 11 driver guide, report, live MIDI monitor. */
export function DiagnosticsPanel({ guideOpen, onGuideOpenChange, guideRef }: Props) {
  const checks = useChecks();
  const hostStatus = useDevice((s) => s.hostStatus);
  const connectedAt = useDevice((s) => s.connectedAt);
  const status = useDevice((s) => s.status);
  const monitor = useDevice((s) => s.monitor);
  const setMonitor = useDevice((s) => s.setMonitor);
  const clearMidiLog = useDevice((s) => s.clearMidiLog);
  const [checking, setChecking] = useState(false);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    try {
      const d = useDevice.getState();
      await d.checkHost();
      if (d.status === "error" || d.status === "disconnected" || d.status === "idle") await d.connect("webmidi").catch(() => {});
    } finally {
      setChecking(false);
    }
  }, []);

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(getMidiLog().map(formatLogLine).join("\n"));
      notifySuccess("MIDI log copied");
    } catch (e) {
      notifyError("Couldn't copy the log", e);
    }
  };

  const checkedAt = hostStatus?.checkedAt;
  const lastChecked = checkedAt
    ? `Last checked at ${clock(checkedAt)}${status === "connected" && connectedAt && Math.abs(connectedAt - checkedAt) < 15_000 ? ", when the pedal connected" : ""}.`
    : "Checks run when the app looks for the pedal.";

  return (
    <section aria-labelledby="dg-title" className="flex min-w-0 flex-col gap-4 rounded-lg bg-card px-5 pt-4 pb-5 shadow-[0_0_0_1px_var(--seam)]">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 id="dg-title" className="text-[15px] font-[650] text-balance">
            Diagnostics
          </h2>
          <p className="mt-0.5 text-sm text-pretty text-silkscreen-3">{lastChecked}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => void checkAgain()} disabled={checking || status === "connecting"}>
            <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} aria-hidden />
            Check again
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyReport(checks)}>
            <Copy aria-hidden />
            Copy diagnostic report
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Save diagnostic report" onClick={() => void saveReport(checks)}>
                <Download aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save diagnostic report</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ul className="flex flex-col">
        {checks.map((c) => {
          const s = c.id === "access" && c.state === "idle" && c.detail.startsWith("Left") ? { ...STATE_ICON.idle, icon: Info } : STATE_ICON[c.state];
          return (
            <li key={c.id} className="grid grid-cols-[20px_132px_minmax(0,1fr)] items-start gap-2.5 border-b py-[9px] text-sm first:pt-0">
              <span className={cn("grid h-[18px] place-items-center", s.className)}>
                <s.icon className="size-4" aria-label={s.label} />
              </span>
              <span className="font-semibold text-silkscreen">{c.name}</span>
              <span className="text-pretty text-silkscreen-2">
                {c.detail}
                {c.hint && <small className="mt-0.5 block text-xs text-silkscreen-3">{c.hint}</small>}
              </span>
            </li>
          );
        })}
      </ul>

      <Collapsible open={guideOpen} onOpenChange={onGuideOpenChange} className="group/guide rounded-lg bg-well" ref={guideRef}>
        <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm">
          <TriangleAlert className="size-4 shrink-0 text-led-warn" aria-hidden />
          <span>
            <b className="font-semibold text-silkscreen">If the pedal doesn't show up on Windows 11</b>
            <br />
            <span className="text-xs text-silkscreen-3">Windows 11 updates since February 2026 can attach a MIDI driver that hides the GP-5</span>
          </span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-silkscreen-3 transition-transform group-data-[state=open]/guide:rotate-180 motion-reduce:transition-none" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="pr-3 pb-3 pl-[38px] text-sm text-silkscreen-2">
          <p className="mb-2 text-pretty">The pedal is fine. Windows gave it the new "USB MIDI 2.0" driver, which Valeton software and this app can't use. Give it the "USB Audio Device" driver instead:</p>
          <ol className="mb-2.5 flex list-decimal flex-col gap-1 pl-[18px] marker:font-semibold marker:text-silkscreen-3">
            <li>Plug the GP-5 in, switch it on and close Valeton Suite.</li>
            <li>
              Right-click Start and open <b className="font-semibold text-silkscreen">Device Manager</b>. Find the GP-5.
            </li>
            <li>
              Right-click it, choose <b className="font-semibold text-silkscreen">Update driver</b>, then <b className="font-semibold text-silkscreen">Browse my computer</b>, then{" "}
              <b className="font-semibold text-silkscreen">Let me pick from a list</b>.
            </li>
            <li>
              Untick <b className="font-semibold text-silkscreen">Show compatible hardware</b>, pick <b className="font-semibold text-silkscreen">USB Audio Device</b> and finish.
            </li>
            <li>Unplug the pedal, plug it back in, then press Check again.</li>
          </ol>
          <p className="mb-2 text-pretty text-silkscreen-3">
            A firmware update puts the pedal in update mode, which Windows treats as a separate device. If an update in Valeton Suite stops at 0%, repeat these steps while the pedal shows its update screen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void checkAgain()} disabled={checking}>
              <RefreshCw aria-hidden />
              Check again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void host.app.openExternal(FIX_URL).catch((e) => notifyError("Couldn't open the link", e))}>
              <ExternalLink aria-hidden />
              One-click fix on GitHub
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <div className="flex items-start gap-3">
        <Switch id="mon-switch" checked={monitor} onCheckedChange={setMonitor} aria-labelledby="mon-lbl" className="mt-px" />
        <div className="min-w-0">
          <b id="mon-lbl" className="block font-semibold">
            Live MIDI monitor
          </b>
          <span className="block text-sm text-pretty text-silkscreen-3">For troubleshooting. Lists every message between the app and the pedal.</span>
        </div>
        {monitor && (
          <div className="ml-auto flex shrink-0 gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void copyLog()}>
              <Copy aria-hidden />
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={clearMidiLog}>
              <Trash2 aria-hidden />
              Clear
            </Button>
          </div>
        )}
      </div>
      {monitor && <MidiLog />}
    </section>
  );
}
