// Plain-text diagnostic report (Copy diagnostic report / Save report). No preset contents, no account data.
import type { DeviceHostStatus } from "@shared/host/device";
import type { ConnectionError, MidiLogEntry, RequestError } from "@/state/device-types";
import { formatLogLine } from "@/state/midi-log";
import type { Check } from "./guidance";

export interface ReportInput {
  appVersion: string;
  platform: string;
  host: DeviceHostStatus | null;
  checks: Check[];
  status: string;
  mode: string;
  portName: string | null;
  connectionError: ConnectionError | null;
  lastError: RequestError | null;
  /** Monitor lines, only when the monitor is on */
  monitor: MidiLogEntry[] | null;
  now?: number;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const MARK = { ok: "OK  ", warn: "WARN", fault: "FAIL", idle: "--  ", pending: "... " } as const;

export function buildReport(r: ReportInput): string {
  const h = r.host;
  const lines = [
    "GP-5 Tone Studio diagnostic report",
    `Created: ${new Date(r.now ?? Date.now()).toISOString()}`,
    "",
    `App: ${r.appVersion}${h?.versions.electron ? ` (Electron ${h.versions.electron}, Chromium ${h.versions.chrome}, Node ${h.versions.node})` : h?.versions.chrome ? ` (browser, Chromium ${h.versions.chrome})` : ""}`,
    `Platform: ${r.platform}`,
    `OS: ${h?.os ?? "unknown"}`,
    "",
    "Checks:",
    ...r.checks.map((c) => `  [${MARK[c.state]}] ${c.name}: ${c.detail}${c.hint ? ` (${c.hint})` : ""}`),
    "",
    `Connection: ${r.status} (${r.mode})`,
    `MIDI port: ${r.portName ?? "none"}`,
    `Visible MIDI ports: ${r.connectionError?.ports ? r.connectionError.ports.join(", ") || "none" : "not listed"}`,
    `USB (vendor 84EF): ${h?.usb ? h.usb.map((d) => `${hex4(d.vendorId)}:${hex4(d.productId)}${d.product ? ` ${d.product}` : ""}`).join(", ") || "none" : "not available"}`,
    `Driver: ${h?.driver ?? "unknown"}`,
    ...(h?.linuxSeq ? [`/dev/snd/seq: ${h.linuxSeq.exists ? (h.linuxSeq.accessible ? "accessible" : "no access") : "missing"}, group ${h.linuxSeq.group ?? "?"}, member ${h.linuxSeq.inGroup ? "yes" : "no"}`] : []),
    `Valeton Suite running: ${h?.suiteRunning === null || !h ? "unknown" : h.suiteRunning ? "yes" : "no"}`,
    `Last connection error: ${r.connectionError ? `${r.connectionError.code}: ${r.connectionError.message}` : "none"}`,
    `Last request error: ${r.lastError ? `${r.lastError.code}: ${r.lastError.message} at ${new Date(r.lastError.at).toISOString()}` : "none"}`,
  ];
  if (r.monitor) {
    lines.push("", `MIDI monitor (last ${Math.min(50, r.monitor.length)} lines):`, ...r.monitor.slice(-50).map((e) => `  ${formatLogLine(e)}`));
  }
  return lines.join("\n") + "\n";
}
