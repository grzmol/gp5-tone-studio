import { app, dialog, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { access, constants, readFile, readdir, readlink, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { release, arch } from "node:os";
import { promisify } from "node:util";
import { GP5_PID, VALETON_VID, type DeviceHostStatus, type LinuxSeqAccess, type UsbDeviceInfo } from "@shared/host/device";
import { HostError } from "@shared/ipc";
import { handle } from "./handle";

const run = promisify(execFile);
const EXEC = { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
const SUITE_RE = /valeton\s*suite/i;
const MAX_REPORT = 1024 * 1024;

const readText = (path: string) => readFile(path, "utf8").then((s) => s.trim(), () => null);

// ------------------------------------------------------------------------------------------------ Linux

/** /sys/bus/usb/devices: Valeton devices plus the driver bound to the GP-5 MIDI interface (config 1, interface 3). */
async function linuxUsb(): Promise<{ usb: UsbDeviceInfo[]; driver: string | null }> {
  const root = "/sys/bus/usb/devices";
  const usb: UsbDeviceInfo[] = [];
  let driver: string | null = null;
  for (const entry of await readdir(root)) {
    if (entry.includes(":")) continue; // interfaces, not devices
    const vendor = await readText(join(root, entry, "idVendor"));
    if (!vendor || parseInt(vendor, 16) !== VALETON_VID) continue;
    const productId = parseInt((await readText(join(root, entry, "idProduct"))) ?? "0", 16);
    usb.push({ vendorId: VALETON_VID, productId, product: await readText(join(root, entry, "product")) });
    if (productId === GP5_PID) driver = await readlink(join(root, `${entry}:1.3`, "driver")).then((p) => basename(p), () => driver);
  }
  return { usb, driver };
}

async function groupName(gid: number): Promise<string | null> {
  const groups = (await readText("/etc/group")) ?? "";
  for (const line of groups.split("\n")) {
    const [name, , id] = line.split(":");
    if (Number(id) === gid) return name;
  }
  return null;
}

async function linuxSeq(): Promise<LinuxSeqAccess> {
  const path = "/dev/snd/seq";
  const st = await stat(path).catch(() => null);
  if (!st) return { path, exists: false, accessible: false, group: null, inGroup: false };
  const accessible = await access(path, constants.R_OK | constants.W_OK).then(
    () => true,
    () => false,
  );
  const gids = process.getgroups?.() ?? [];
  return { path, exists: true, accessible, group: await groupName(st.gid), inGroup: gids.includes(st.gid) };
}

// ------------------------------------------------------------------------------------------------ Windows

/** PnP entities with VID_84EF; `Service` of the MIDI interface (MI_03) is the bound driver ("usbaudio" or a MIDI 2.0 driver). */
async function windowsUsb(): Promise<{ usb: UsbDeviceInfo[]; driver: string | null }> {
  const ps =
    "Get-CimInstance Win32_PnPEntity -Filter \"PNPDeviceID LIKE 'USB\\\\VID_84EF%'\" | Select-Object PNPDeviceID,Name,Service | ConvertTo-Json -Compress";
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], EXEC);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const rows: { PNPDeviceID?: string; Name?: string; Service?: string }[] = Array.isArray(parsed) ? parsed : [parsed];
  const usb = new Map<number, UsbDeviceInfo>();
  let driver: string | null = null;
  for (const row of rows) {
    const m = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(&MI_(\d\d))?/i.exec(row.PNPDeviceID ?? "");
    if (!m) continue;
    const productId = parseInt(m[2], 16);
    // Prefer the composite parent row for the name; children (MI_xx) still prove the device is present.
    if (!m[3]) usb.set(productId, { vendorId: VALETON_VID, productId, product: row.Name ?? null });
    else if (!usb.has(productId)) usb.set(productId, { vendorId: VALETON_VID, productId, product: null });
    if (productId === GP5_PID && m[4] === "03") driver = [row.Service, row.Name].filter(Boolean).join(", ") || null;
  }
  return { usb: [...usb.values()], driver };
}

// ------------------------------------------------------------------------------------------------ macOS

/** IORegistry USB plane: blocks with "idVendor" = 34031 (0x84EF). */
async function macUsb(): Promise<{ usb: UsbDeviceInfo[]; driver: string | null }> {
  const { stdout } = await run("ioreg", ["-p", "IOUSB", "-l", "-w0"], EXEC);
  const usb: UsbDeviceInfo[] = [];
  for (const block of stdout.split(/\+-o /)) {
    const vendor = /"idVendor" = (\d+)/.exec(block);
    if (!vendor || Number(vendor[1]) !== VALETON_VID) continue;
    const product = /"idProduct" = (\d+)/.exec(block);
    const name = /"USB Product Name" = "([^"]*)"/.exec(block);
    usb.push({ vendorId: VALETON_VID, productId: Number(product?.[1] ?? 0), product: name?.[1] ?? null });
  }
  // CoreMIDI drives class-compliant MIDI without a vendor driver.
  return { usb, driver: usb.some((d) => d.productId === GP5_PID) ? "CoreMIDI (class compliant)" : null };
}

// ------------------------------------------------------------------------------------------------ shared

async function suiteRunning(): Promise<boolean | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("tasklist", ["/FO", "CSV", "/NH"], EXEC);
      return SUITE_RE.test(stdout);
    }
    // macOS app bundle, or the Windows build under Wine on Linux
    const { stdout } = await run("ps", ["-A", "-o", "args="], EXEC);
    return SUITE_RE.test(stdout);
  } catch {
    return null;
  }
}

async function usbAndDriver(): Promise<{ usb: UsbDeviceInfo[] | null; driver: string | null }> {
  try {
    if (process.platform === "linux") return await linuxUsb();
    if (process.platform === "win32") return await windowsUsb();
    if (process.platform === "darwin") return await macUsb();
  } catch {
    /* enumeration unavailable (sandbox, missing tool): report unknown rather than "not found" */
  }
  return { usb: null, driver: null };
}

const OS_NAME: Partial<Record<NodeJS.Platform, string>> = { linux: "Linux", win32: "Windows", darwin: "macOS" };

async function status(): Promise<DeviceHostStatus> {
  const [{ usb, driver }, suite, seq] = await Promise.all([
    usbAndDriver(),
    suiteRunning(),
    process.platform === "linux" ? linuxSeq() : Promise.resolve(null),
  ]);
  return {
    checkedAt: Date.now(),
    os: `${OS_NAME[process.platform] ?? process.platform} ${process.platform === "darwin" ? process.getSystemVersion() : release()} ${arch()}`,
    versions: { app: app.getVersion(), electron: process.versions.electron ?? null, chrome: process.versions.chrome ?? null, node: process.versions.node ?? null },
    usb,
    driver,
    linuxSeq: seq,
    suiteRunning: suite,
  };
}

export function registerDeviceIpc(getWindow: () => BrowserWindow | null): void {
  handle("device:status", () => status());

  handle("device:saveReport", async (_e, text: unknown, fileName: unknown) => {
    if (typeof text !== "string" || text.length > MAX_REPORT) throw new HostError("invalid", "The report must be text under 1 MB");
    const name = typeof fileName === "string" && /^[\w.-]+\.txt$/.test(fileName) ? fileName : "gp5-diagnostics.txt";
    const opts = { defaultPath: join(app.getPath("documents"), name), filters: [{ name: "Text", extensions: ["txt"] }] };
    const win = getWindow();
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, text, "utf8");
    return res.filePath;
  });

  handle("device:pickSuitePath", async () => {
    const opts: Electron.OpenDialogOptions = {
      title: "Choose Valeton Suite",
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "Programs", extensions: ["exe"] }]
          : process.platform === "darwin"
            ? [{ name: "Applications", extensions: ["app"] }]
            : [{ name: "All files", extensions: ["*"] }],
      defaultPath: process.platform === "darwin" ? "/Applications" : undefined,
    };
    const win = getWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });
}
