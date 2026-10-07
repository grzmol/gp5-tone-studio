import type { DeviceHostApi } from "@shared/host/device";
import { HostError } from "@shared/ipc";

/** Browser build: no USB, driver or process list; the browser and its version are all it can know. */
export const webDevice: DeviceHostApi = {
  status: async () => {
    const ua = navigator.userAgent;
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData?.brands ?? [];
    const chrome = brands.find((b) => /Chrom/i.test(b.brand))?.version ?? /Chrom(?:e|ium)\/([\d.]+)/.exec(ua)?.[1] ?? null;
    return {
      checkedAt: Date.now(),
      os: ua,
      versions: { app: "web", electron: null, chrome, node: null },
      usb: null,
      driver: null,
      linuxSeq: null,
      suiteRunning: null,
    };
  },
  saveReport: async (text, fileName) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  },
  pickSuitePath: async () => {
    throw new HostError("unsupported", "Choosing Valeton Suite needs the desktop app");
  },
};
