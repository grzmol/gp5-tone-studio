// Device diagnostics that need the OS: USB enumeration, bound driver, Linux /dev/snd/seq access, Valeton Suite running,
// saving the diagnostic report, picking the Valeton Suite program. Owner: Device screen.

/** Valeton/Hotone USB vendor id and the GP-5 / GP-50 product ids (gp5-usb-connection). */
export const VALETON_VID = 0x84ef;
export const GP5_PID = 0x0184;
export const GP50_PID = 0x018a;

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  /** USB product string, when the OS reports it */
  product: string | null;
}

export interface LinuxSeqAccess {
  path: string;
  exists: boolean;
  /** The current user can open it for reading and writing */
  accessible: boolean;
  /** Group that owns the device node (usually `audio`) */
  group: string | null;
  /** The current process is in that group */
  inGroup: boolean;
}

export interface HostVersions {
  app: string;
  electron: string | null;
  chrome: string | null;
  node: string | null;
}

export interface DeviceHostStatus {
  checkedAt: number;
  /** "linux 6.9.1 x64", "Windows 10.0.26100 x64", or the browser's user agent */
  os: string;
  versions: HostVersions;
  /** USB devices with Valeton's vendor id; null when this host can't enumerate USB */
  usb: UsbDeviceInfo[] | null;
  /** Driver bound to the GP-5 MIDI interface (Linux kernel module, Windows service); null = unknown */
  driver: string | null;
  /** Linux only: access to the ALSA sequencer device */
  linuxSeq: LinuxSeqAccess | null;
  /** A Valeton Suite process is running; null = can't tell */
  suiteRunning: boolean | null;
}

export interface DeviceHostApi {
  /** Run the OS-side checks (USB, driver, /dev/snd/seq, Valeton Suite). */
  status(): Promise<DeviceHostStatus>;
  /** Save the diagnostic report through a save dialog. Returns the path, or null when cancelled. */
  saveReport(text: string, fileName: string): Promise<string | null>;
  /** Pick the Valeton Suite program. Returns its path, or null when cancelled. Desktop only. */
  pickSuitePath(): Promise<string | null>;
}
