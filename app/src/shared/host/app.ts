import type { AppEvent } from "../ipc";

export interface AppSettings {
  /** Show knob values printed under the labels on gear art. */
  showValues: boolean;
  /** Path to Valeton Suite (Windows .exe / macOS .app), where the SnapTone test signal is found; null = not configured. */
  valetonSuitePath: string | null;
  /** MIDI port name pattern override (advanced). */
  portPattern: string | null;
  /** Ask for a backup before every write to pedal memory. */
  backupBeforeWrite: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  showValues: false,
  valetonSuitePath: null,
  portPattern: null,
  backupBeforeWrite: true,
};

export interface AppApi {
  version(): Promise<string>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  /** Taskbar/dock progress for long jobs (0..1), null clears it. */
  setProgress(fraction: number | null): Promise<void>;
  /** Files passed on launch ("Open with", command line) that arrived before the renderer listened; empties the queue. */
  takeOpenedFiles(): Promise<string[]>;
  /** Absolute path of a dropped File (Electron `webUtils.getPathForFile`); null in the web build. */
  pathForFile(file: File): string | null;
  /** Subscribe to menu commands and OS events. Returns an unsubscribe function. */
  onEvent(cb: (event: AppEvent) => void): () => void;
}
