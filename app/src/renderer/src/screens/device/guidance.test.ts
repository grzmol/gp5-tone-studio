import { describe, expect, it } from "vitest";
import type { DeviceHostStatus } from "@shared/host/device";
import type { ConnectionErrorCode } from "@/state/device-types";
import { refineConnectionError } from "@/state/device";
import { connectionView, diagnosticChecks, formatWhen, requestErrorLine, type GuidanceInput } from "./guidance";

const host = (over: Partial<DeviceHostStatus> = {}): DeviceHostStatus => ({
  checkedAt: 0,
  os: "test",
  versions: { app: "0.1.0", electron: "43", chrome: "150", node: "24" },
  usb: [],
  driver: null,
  linuxSeq: null,
  suiteRunning: false,
  ...over,
});
const gp5 = { vendorId: 0x84ef, productId: 0x0184, product: "GP-5" };
const updater = { vendorId: 0x84ef, productId: 0x0185, product: "Valeton Upgrade" };

const err = (code: ConnectionErrorCode, input: Partial<GuidanceInput> = {}) =>
  connectionView({ status: "error", error: { code, message: code }, mode: "webmidi", hostStatus: null, platform: "linux", ...input });

describe("connectionView", () => {
  it("connected: green chip, live, no primary action", () => {
    const v = connectionView({ status: "connected", error: null, mode: "webmidi", hostStatus: null, platform: "linux" });
    expect(v).toMatchObject({ kind: "connected", led: "on", chip: "USB", offline: false, action: "none" });
    expect(connectionView({ status: "connected", error: null, mode: "mock", hostStatus: null, platform: "web" }).chip).toBe("Simulated");
  });

  it("connecting offers Cancel", () => {
    expect(connectionView({ status: "connecting", error: null, mode: "webmidi", hostStatus: null, platform: "linux" })).toMatchObject({ kind: "connecting", led: "warn", action: "cancel" });
  });

  it("disconnected says when it was last connected and says why when the port went away", () => {
    const now = new Date(2026, 9, 7, 15, 0).getTime();
    const at = new Date(2026, 9, 7, 13, 42).getTime();
    const v = connectionView({ status: "disconnected", error: null, mode: "webmidi", hostStatus: null, platform: "linux", lastConnectedAt: at, now });
    expect(v).toMatchObject({ kind: "disconnected", led: "off", chip: "Not connected", action: "connect" });
    expect(v.detail).toBe("Last connected today at 13:42");
    const lost = connectionView({ status: "disconnected", error: null, mode: "webmidi", hostStatus: null, platform: "linux", disconnectReason: "lost" });
    expect(lost.detail).toMatch(/went away/);
  });

  it("unsupported in the browser points to the desktop app and Chrome/Edge", () => {
    const v = err("unsupported", { platform: "web" });
    expect(v.kind).toBe("unsupported");
    expect(v.note).toMatch(/desktop app/);
    expect(v.note).toMatch(/Chrome or Edge/);
  });

  it("broken browser names Chromium 152 and the fix", () => {
    expect(err("broken-browser", { platform: "web" }).note).toMatch(/153/);
  });

  it("permission in the browser gives site-settings steps", () => {
    const v = err("permission", { platform: "web" });
    expect(v.kind).toBe("permission");
    expect(v.steps.join(" ")).toMatch(/MIDI devices/);
  });

  it("Linux without /dev/snd/seq access asks to join the device's group", () => {
    const h = host({ linuxSeq: { path: "/dev/snd/seq", exists: true, accessible: false, group: "audio", inGroup: false } });
    for (const code of ["permission", "not-found"] as const) {
      const v = err(code, { hostStatus: h });
      expect(v.kind).toBe("linux-access");
      expect(v.steps[0]).toContain("usermod -aG audio");
    }
  });

  it("Windows: GP-5 on USB but no port = driver problem with the Windows 11 guide opened", () => {
    const v = err("not-found", { platform: "win32", hostStatus: host({ usb: [gp5], driver: "usbmidi2, USB MIDI 2.0 Device" }) });
    expect(v).toMatchObject({ kind: "driver", led: "fault", chip: "Driver problem", action: "show-fix", openGuide: true });
    expect(v.note).toMatch(/MIDI 2\.0/);
    expect(v.steps.some((s) => s.includes("USB Audio Device"))).toBe(true);
  });

  it("no pedal on USB = plug-in guidance listing the visible ports", () => {
    const v = connectionView({
      status: "error",
      error: { code: "not-found", message: "", ports: ["Midi Through Port-0"] },
      mode: "webmidi",
      hostStatus: host(),
      platform: "linux",
    });
    expect(v.kind).toBe("disconnected");
    expect(v.note).toMatch(/Midi Through Port-0/);
    expect(v.note).toMatch(/data cable/);
  });

  it("silent port with Valeton Suite running = close Suite, Check again", () => {
    const v = err("busy", { platform: "win32", hostStatus: host({ suiteRunning: true }) });
    expect(v).toMatchObject({ kind: "suite", action: "check", actionLabel: "Check again" });
    expect(v.state).toMatch(/Valeton Suite/);
  });

  it("silent port without Suite on Windows opens the driver guide", () => {
    expect(err("busy", { platform: "win32", hostStatus: host() })).toMatchObject({ kind: "silent", openGuide: true });
  });

  it("bootloader: update mode, no action, app stays silent", () => {
    expect(err("bootloader")).toMatchObject({ kind: "bootloader", chip: "Update mode", action: "none", offline: true });
  });

  it("timeout after bytes arrived = wrong device / firmware", () => {
    expect(err("timeout").kind).toBe("wrong-device");
  });

  it("every connection error code maps to a view with text", () => {
    const codes: ConnectionErrorCode[] = ["unsupported", "insecure", "permission", "no-sysex", "broken-browser", "not-found", "busy", "timeout", "bootloader", "unknown"];
    for (const code of codes) {
      const v = err(code);
      expect(v.state.length).toBeGreaterThan(0);
      expect(v.statusText.length).toBeGreaterThan(0);
      expect(v.offline).toBe(true);
    }
  });
});

describe("refineConnectionError", () => {
  it("turns not-found into bootloader when only an update-mode Valeton device is on USB", () => {
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [updater] })).code).toBe("bootloader");
  });
  it("keeps not-found when the GP-5 itself is present or nothing is", () => {
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [gp5, updater] })).code).toBe("not-found");
    expect(refineConnectionError({ code: "not-found", message: "" }, host()).code).toBe("not-found");
    expect(refineConnectionError({ code: "not-found", message: "" }, null).code).toBe("not-found");
  });
  it("never treats a GP-50 as update mode", () => {
    expect(refineConnectionError({ code: "not-found", message: "" }, host({ usb: [{ vendorId: 0x84ef, productId: 0x018a, product: "GP-50" }] })).code).toBe("not-found");
  });
});

describe("diagnosticChecks", () => {
  const base = { portName: null, webmidi: true, chrome: "150" };
  it("all green when connected on Linux", () => {
    const checks = diagnosticChecks({
      ...base,
      portName: "GP-5 MIDI 1",
      status: "connected",
      error: null,
      mode: "webmidi",
      platform: "linux",
      hostStatus: host({ usb: [gp5], driver: "snd-usb-audio", linuxSeq: { path: "/dev/snd/seq", exists: true, accessible: true, group: "audio", inGroup: true } }),
    });
    expect(checks.map((c) => c.state)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(checks[0].detail).toBe("Valeton GP-5 found, 84EF:0184");
    expect(checks[1].detail).toContain("snd-usb-audio");
    expect(checks[2].detail).toBe("GP-5 MIDI 1 answers requests");
  });

  it("Windows MIDI 2.0 driver is a fault; Suite running is a warning", () => {
    const checks = diagnosticChecks({ ...base, status: "error", error: { code: "not-found", message: "" }, mode: "webmidi", platform: "win32", hostStatus: host({ usb: [gp5], driver: "usbmidi2", suiteRunning: true }) });
    expect(checks.find((c) => c.id === "driver")?.state).toBe("fault");
    expect(checks.find((c) => c.id === "access")?.state).toBe("warn");
  });

  it("browser without WebMIDI reports the browser row as a fault", () => {
    const checks = diagnosticChecks({ ...base, webmidi: false, status: "error", error: { code: "unsupported", message: "" }, mode: "webmidi", platform: "web", hostStatus: null });
    expect(checks.find((c) => c.id === "driver")).toMatchObject({ name: "Browser", state: "fault" });
  });
});

describe("small formatters", () => {
  it("formatWhen", () => {
    const now = new Date(2026, 9, 7, 12).getTime();
    expect(formatWhen(new Date(2026, 9, 6, 9, 5).getTime(), now)).toBe("yesterday at 09:05");
    expect(formatWhen(new Date(2026, 9, 3, 18, 0).getTime(), now)).toBe("on 3 Oct at 18:00");
  });
  it("requestErrorLine", () => {
    expect(requestErrorLine({ code: "timeout", message: "", at: 0 })).toBe("The pedal stopped answering (timeout)");
    expect(requestErrorLine(null)).toBeNull();
  });
});
