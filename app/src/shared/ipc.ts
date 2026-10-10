// IPC contract shared by main, preload and renderer.
// Every request goes through `invoke` (main: `handle`) and returns a Result, so error codes survive the bridge.
export type HostErrorCode =
  | "cancelled"
  | "not-found"
  | "io"
  | "invalid"
  | "unauthorized"
  | "network"
  | "unsupported"
  | "internal";

export interface HostErrorShape {
  code: HostErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: HostErrorShape };

export class HostError extends Error implements HostErrorShape {
  constructor(
    public code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}

/** Menu and OS events pushed from main to the renderer (`host.app.onEvent`). */
export type AppEvent =
  | { type: "menu"; command: MenuCommand }
  | { type: "open-files"; paths: string[] }
  | { type: "window-focus"; focused: boolean };

export type MenuCommand =
  | "import-presets"
  | "export-preset"
  | "backup-pedal"
  | "open-backups-folder"
  | "undo"
  | "redo"
  | "copy-block"
  | "paste-block"
  | "reconnect"
  | "save-to-slot"
  | "compare-with-saved"
  | "command-palette"
  | "diagnostics-report"
  | "about"
  | "go-rig"
  | "go-library"
  | "go-tones"
  | "go-device"
  | "go-song"
  | "settings";
