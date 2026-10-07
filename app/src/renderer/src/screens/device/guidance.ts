// Connection state → what the Device screen, the title-bar chip and the status bar say, and how to fix it.
// Pure: every input comes from the device store and the host checks, so the mapping is unit-tested.
import { GP5_PID, VALETON_VID, type DeviceHostStatus } from "@shared/host/device";
import type { HostApi } from "@shared/host";
import type { ConnectionError, ConnectionStatus, DeviceMode, RequestError } from "@/state/device-types";

export type ViewKind =
  | "connected"
  | "connecting"
  | "disconnected"
  | "no-port"
  | "driver"
  | "bootloader"
  | "suite"
  | "silent"
  | "wrong-device"
  | "linux-access"
  | "permission"
  | "no-sysex"
  | "unsupported"
  | "insecure"
  | "broken-browser"
  | "error";

export type Led = "on" | "warn" | "fault" | "off";
/** The header's one primary action */
export type PrimaryAction = "connect" | "show-fix" | "check" | "cancel" | "none";

export interface ConnectionView {
  kind: ViewKind;
  led: Led;
  /** Title-bar chip text after "GP-5" */
  chip: string;
  /** Bold state label in the header meta row */
  state: string;
  /** Text after the state label */
  detail: string;
  /** Paragraph under the meta row; null when the state needs no explanation */
  note: string | null;
  /** Numbered fix steps, when there is something the user can do */
  steps: string[];
  action: PrimaryAction;
  actionLabel: string | null;
  /** Left side of the status bar */
  statusText: string;
  /** Pedal settings and pedal actions are unavailable */
  offline: boolean;
  /** Open the Windows 11 driver guide by itself */
  openGuide: boolean;
}

export interface GuidanceInput {
  status: ConnectionStatus;
  error: ConnectionError | null;
  mode: DeviceMode;
  hostStatus: DeviceHostStatus | null;
  platform: HostApi["platform"];
  disconnectReason?: "user" | "lost" | null;
  lastConnectedAt?: number | null;
  now?: number;
}

const MIDI2_RE = /midi\s*2|usbmidi2/i;
const gp5Present = (h: DeviceHostStatus | null) => !!h?.usb?.some((d) => d.vendorId === VALETON_VID && d.productId === GP5_PID);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "13:42" */
export function clock(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "today at 13:42", "yesterday at 09:10", "on 3 Oct at 18:00" */
export function formatWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : `on ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
  return `${day} at ${clock(at)}`;
}

const PLUG_IN = "Plug the GP-5 into this computer with a USB data cable and switch it on.";
const AUDIO_GROUP_STEPS = (h: DeviceHostStatus | null) => {
  const group = h?.linuxSeq?.group ?? "audio";
  return [
    `Add yourself to the "${group}" group: run  sudo usermod -aG ${group} $USER  in a terminal.`,
    "Log out and back in (or restart) so the new group applies.",
    "Open Tone Studio again and press Look for the pedal.",
  ];
};
const WIN11_STEPS = [
  "Plug the GP-5 in, switch it on and close Valeton Suite.",
  "Right-click Start and open Device Manager. Find the GP-5.",
  "Right-click it, choose Update driver, then Browse my computer, then Let me pick from a list.",
  "Untick Show compatible hardware, pick USB Audio Device and finish.",
  "Unplug the pedal, plug it back in, then press Check again.",
];

function base(kind: ViewKind, led: Led, chip: string, state: string, detail: string, rest: Partial<ConnectionView> = {}): ConnectionView {
  return {
    kind,
    led,
    chip,
    state,
    detail,
    note: null,
    steps: [],
    action: "connect",
    actionLabel: "Look for the pedal",
    statusText: "GP-5 not connected",
    offline: true,
    openGuide: false,
    ...rest,
  };
}

/** Map the store's connection state (plus host checks) to the header, chip, status bar and fix steps. */
export function connectionView(input: GuidanceInput): ConnectionView {
  const { status, error, mode, hostStatus: h, platform } = input;
  const desktop = platform !== "web";
  const lastSeen = input.lastConnectedAt ? `Last connected ${formatWhen(input.lastConnectedAt, input.now)}` : "Not connected yet";

  if (status === "connected")
    return base("connected", "on", mode === "mock" ? "Simulated" : "USB", mode === "mock" ? "Simulated pedal" : "Connected over USB", "since", {
      action: "none",
      actionLabel: null,
      statusText: "Pedal settings apply on the GP-5 as you change them",
      offline: false,
    });

  if (status === "connecting")
    return base("connecting", "warn", "Connecting", "Connecting", "Reading preset names, active preset and pedal settings", {
      action: "cancel",
      actionLabel: "Cancel",
      statusText: "Connecting to the GP-5",
    });

  if (status !== "error" || !error) {
    const lost = input.disconnectReason === "lost";
    return base("disconnected", "off", "Not connected", "Not connected", lost ? "The pedal went away (unplugged or switched off)" : lastSeen, {
      note: `${PLUG_IN} ${desktop ? "The app connects by itself. " : ""}Values below are from the last connection and can't be changed until then.`,
    });
  }

  switch (error.code) {
    case "bootloader":
      return base("bootloader", "warn", "Update mode", "Firmware update mode", 'The pedal is on its "Firmware Update / Restore" screen', {
        note: "Tone Studio doesn't send anything to a pedal in update mode, so a firmware update can't be interrupted. Finish the update in Valeton Suite. When the pedal restarts normally, the app connects by itself.",
        action: "none",
        actionLabel: null,
        statusText: "GP-5 in firmware update mode, the app is not sending anything",
      });

    case "unsupported":
      return base("unsupported", "fault", "Not available", "MIDI not available", desktop ? "This build has no WebMIDI" : "This browser can't talk to MIDI devices", {
        note: desktop
          ? "The app's MIDI layer didn't start. Reinstall Tone Studio or report it with the diagnostic report."
          : "Talking to the pedal needs the desktop app, or Chrome or Edge on a desktop computer. Firefox and Safari have no MIDI with SysEx. You can still try everything with the simulated pedal.",
        action: "none",
        actionLabel: null,
        statusText: desktop ? "MIDI is not available" : "This browser has no MIDI: use the desktop app or Chrome/Edge",
      });

    case "insecure":
      return base("insecure", "fault", "Not available", "MIDI blocked", "WebMIDI only works on https:// or http://localhost", {
        note: "Open Tone Studio from a secure address (https) or from localhost, or use the desktop app.",
        action: "none",
        actionLabel: null,
        statusText: "MIDI needs a secure page",
      });

    case "broken-browser":
      return base("broken-browser", "fault", "Browser problem", "Browser can't use SysEx", "Chromium 152 drops the pedal's SysEx replies", {
        note: desktop
          ? "This version of the app ships Chromium 152, which can't exchange SysEx with the pedal. Update Tone Studio."
          : "Chrome, Edge and other Chromium browsers version 152 can't exchange SysEx with the pedal. Update the browser to version 153 or newer, or use the desktop app.",
        action: "none",
        actionLabel: null,
        statusText: "Chromium 152 can't talk to the GP-5: update",
      });

    case "permission":
    case "no-sysex": {
      if (platform === "linux" && h?.linuxSeq && !h.linuxSeq.accessible) return linuxAccess(h);
      const sysex = error.code === "no-sysex";
      return base(sysex ? "no-sysex" : "permission", "fault", "No permission", sysex ? "SysEx not allowed" : "MIDI permission denied", sysex ? "The pedal is reached with SysEx messages, which weren't allowed" : "Access to MIDI devices was refused", {
        steps: desktop
          ? ["Close other apps that use MIDI devices.", "Press Look for the pedal again."]
          : [
              "Click the site settings icon left of the address bar.",
              'Set "MIDI devices" (control and reprogram MIDI devices) to Allow.',
              "Reload the page, then press Look for the pedal.",
            ],
        statusText: "MIDI access was refused",
      });
    }

    case "not-found": {
      if (platform === "linux" && h?.linuxSeq && !h.linuxSeq.accessible) return linuxAccess(h);
      if (gp5Present(h)) {
        if (platform === "win32")
          return base("driver", "fault", "Driver problem", "Driver problem", "Found on USB, but Windows shows no MIDI port for it", {
            note:
              h?.driver && MIDI2_RE.test(h.driver)
                ? 'Windows 11 attached its new MIDI 2.0 driver to the pedal, and neither this app nor Valeton Suite can talk through it. Switching the pedal to the "USB Audio Device" driver fixes it. Follow the steps under Diagnostics.'
                : 'Windows has no working MIDI driver on the pedal. Giving it the "USB Audio Device" driver fixes it. Follow the steps under Diagnostics.',
            steps: WIN11_STEPS,
            action: "show-fix",
            actionLabel: "Show the fix",
            statusText: "GP-5 found, but its driver hides the MIDI port",
            openGuide: true,
          });
        return base("no-port", "warn", "No MIDI port", "No MIDI port", "Found on USB, but there is no GP-5 MIDI port", {
          note:
            platform === "linux"
              ? "The kernel sees the pedal but ALSA has no MIDI port for it. Unplug it, wait a few seconds and plug it back in. If that doesn't help, check that the snd-usb-audio module is loaded."
              : "The system sees the pedal but has no MIDI port for it. Unplug it, wait a few seconds and plug it back in.",
          statusText: "GP-5 on USB without a MIDI port",
        });
      }
      const ports = error.ports?.length ? `Visible MIDI ports: ${error.ports.join(", ")}.` : "No MIDI ports are visible.";
      return base("disconnected", "off", "Not connected", "Not connected", lastSeen, {
        note: `${PLUG_IN} ${ports}${desktop ? " The app connects by itself when the pedal appears." : ""}`,
      });
    }

    case "busy":
      if (h?.suiteRunning)
        return base("suite", "warn", "In use", "Valeton Suite is using the pedal", "Close it to connect", {
          note: "On Windows only one app can use the pedal at a time. Quit Valeton Suite (also from the system tray), then press Check again.",
          action: "check",
          actionLabel: "Check again",
          statusText: "Valeton Suite has the GP-5 port",
        });
      return base("silent", "warn", "No answer", "The pedal doesn't answer", "Its MIDI port opened, but nothing came back", {
        note:
          platform === "win32"
            ? "Another app may hold the port (Valeton Suite, a DAW), or Windows 11 attached its MIDI 2.0 driver. Close other MIDI apps and replug the pedal; if it still fails, follow the Windows 11 steps under Diagnostics."
            : "Another app may hold the port, or the pedal is busy. Close other MIDI apps, switch the pedal off and on, then try again.",
        steps: [],
        statusText: "GP-5 port is silent",
        openGuide: platform === "win32",
      });

    case "timeout":
      return base("wrong-device", "warn", "No answer", "Unexpected reply", "A device answered, but not like a GP-5", {
        note: "Check that this is a GP-5 (not a GP-50 or another Valeton pedal) and that its firmware is up to date. The diagnostic report helps if it keeps happening.",
        statusText: "The device on the GP-5 port answers unexpectedly",
      });

    default:
      return base("error", "fault", "Not connected", "Couldn't connect", error.message, {
        statusText: "GP-5 not connected",
      });
  }
}

function linuxAccess(h: DeviceHostStatus | null): ConnectionView {
  const group = h?.linuxSeq?.group ?? "audio";
  return base("linux-access", "fault", "No access", "No access to MIDI", `This user can't open ${h?.linuxSeq?.path ?? "/dev/snd/seq"}`, {
    note: `Linux only lets members of the "${group}" group use MIDI devices on this system.`,
    steps: AUDIO_GROUP_STEPS(h),
    statusText: "No access to /dev/snd/seq",
  });
}

/** Inline line under the header when a request on a live session failed ("The pedal stopped answering (timeout)"). */
export function requestErrorLine(e: RequestError | null): string | null {
  if (!e) return null;
  if (e.code === "timeout") return "The pedal stopped answering (timeout)";
  if (e.code === "verify") return "A write couldn't be verified (verify)";
  if (e.code === "closed") return "The connection closed during a request (closed)";
  return `A request failed (${e.code}): ${e.message}`;
}

// ------------------------------------------------------------------------------------------------ diagnostics checklist

export type CheckState = "ok" | "warn" | "fault" | "idle" | "pending";
export interface Check {
  id: "usb" | "driver" | "port" | "access";
  name: string;
  state: CheckState;
  detail: string;
  hint?: string;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

export function diagnosticChecks(input: GuidanceInput & { portName: string | null; webmidi: boolean; chrome: string | null }): Check[] {
  const { status, error, mode, hostStatus: h, platform } = input;
  const view = connectionView(input);
  const mock = mode === "mock" && (status === "connected" || status === "connecting");
  const valeton = h?.usb?.filter((d) => d.vendorId === VALETON_VID) ?? [];
  const gp5 = gp5Present(h);

  const usb: Check = mock
    ? { id: "usb", name: "USB device", state: "ok", detail: "Simulated pedal, no USB involved" }
    : view.kind === "bootloader"
      ? { id: "usb", name: "USB device", state: "warn", detail: "Valeton device in firmware update mode", hint: "The app stays silent until the pedal restarts normally." }
      : gp5
        ? { id: "usb", name: "USB device", state: "ok", detail: `Valeton GP-5 found, ${hex4(VALETON_VID)}:${hex4(GP5_PID)}` }
        : !h?.usb
          ? status === "connected"
            ? { id: "usb", name: "USB device", state: "ok", detail: "The GP-5 answers over MIDI" }
            : { id: "usb", name: "USB device", state: "idle", detail: platform === "web" ? "The browser can't list USB devices" : "Couldn't list USB devices" }
          : {
              id: "usb",
              name: "USB device",
              state: "fault",
              detail: valeton.length ? `Other Valeton device: ${valeton.map((d) => `${hex4(d.vendorId)}:${hex4(d.productId)}`).join(", ")}` : "No GP-5 on USB",
              hint: "Use a data cable, not a charge-only one, and plug it straight into the computer rather than a hub.",
            };

  let driver: Check;
  if (mock) driver = { id: "driver", name: "Driver", state: "ok", detail: "Simulated pedal, no driver needed" };
  else if (platform === "web") {
    const broken = input.chrome?.split(".")[0] === "152";
    driver = {
      id: "driver",
      name: "Browser",
      state: !input.webmidi || broken ? "fault" : "ok",
      detail: `${input.chrome ? `Chromium ${input.chrome.split(".")[0]}` : "This browser"}${input.webmidi ? (broken ? ": SysEx broken in 152, update to 153+" : " with WebMIDI") : " has no WebMIDI"}`,
      hint: input.webmidi ? undefined : "Use Chrome or Edge on a desktop computer, or the desktop app.",
    };
  } else if (platform === "linux" && h?.linuxSeq && !h.linuxSeq.accessible)
    driver = {
      id: "driver",
      name: "Driver",
      state: "fault",
      detail: h.linuxSeq.exists ? `No access to ${h.linuxSeq.path}` : `${h.linuxSeq.path} is missing (ALSA sequencer not loaded)`,
      hint: h.linuxSeq.exists ? `Add your user to the "${h.linuxSeq.group ?? "audio"}" group, then log in again.` : "Load the snd-seq module: sudo modprobe snd-seq",
    };
  else if (platform === "win32" && gp5 && h?.driver && MIDI2_RE.test(h.driver))
    driver = { id: "driver", name: "Driver", state: "fault", detail: 'Windows uses "USB MIDI 2.0" for the pedal', hint: 'Switch it to "USB Audio Device". See the steps below.' };
  else if (h?.driver)
    driver = {
      id: "driver",
      name: "Driver",
      state: "ok",
      detail: platform === "linux" ? `Linux ALSA (${h.driver}). Nothing to install.` : platform === "darwin" ? "macOS CoreMIDI. Nothing to install." : `Windows (${h.driver})`,
    };
  else if (gp5) driver = { id: "driver", name: "Driver", state: "warn", detail: "No driver is bound to the pedal's MIDI interface" };
  else driver = { id: "driver", name: "Driver", state: "idle", detail: "Checked once the GP-5 is on USB" };

  const portLabel = input.portName ?? "the GP-5 port";
  const port: Check =
    status === "connected"
      ? { id: "port", name: "MIDI port", state: "ok", detail: `${portLabel} answers requests` }
      : status === "connecting"
        ? { id: "port", name: "MIDI port", state: "pending", detail: `Waiting for ${portLabel} to answer` }
        : error?.code === "busy"
          ? { id: "port", name: "MIDI port", state: "warn", detail: "GP-5 port found, but it doesn't answer" }
          : error?.code === "timeout"
            ? { id: "port", name: "MIDI port", state: "warn", detail: "A port answered, but not like a GP-5" }
            : {
                id: "port",
                name: "MIDI port",
                state: "idle",
                detail: "No GP-5 MIDI port",
                hint: error?.ports ? (error.ports.length ? `Visible ports: ${error.ports.join(", ")}` : "No MIDI ports are visible") : undefined,
              };

  const shared = "On Windows only one app can use the pedal at a time. If Suite is open, the app asks you to close it before connecting.";
  const access: Check =
    view.kind === "bootloader"
      ? { id: "access", name: "Exclusive access", state: "idle", detail: "Left to Valeton Suite", hint: "Suite owns the connection while it updates the firmware. Tone Studio waits." }
      : h?.suiteRunning === true
        ? platform === "win32"
          ? { id: "access", name: "Exclusive access", state: "warn", detail: "Valeton Suite is running", hint: "Close it to connect. On Windows only one app can use the pedal at a time." }
          : { id: "access", name: "Exclusive access", state: "ok", detail: "Valeton Suite is running", hint: "On this system both apps can use the port, but changes in one don't show in the other." }
        : h?.suiteRunning === false
          ? { id: "access", name: "Exclusive access", state: "ok", detail: "Valeton Suite is not running", hint: shared }
          : { id: "access", name: "Exclusive access", state: "idle", detail: mock ? "Not needed for the simulated pedal" : platform === "web" ? "The browser can't see other apps" : "Couldn't check for Valeton Suite", hint: shared };

  return [usb, driver, port, access];
}
