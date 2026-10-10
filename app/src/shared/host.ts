// The host API the renderer sees as `window.gp5host` (Electron) or the web fallback (browser build).
// Each domain has its own interface file; this composes them. Owners: app = shell, files = Library,
// tones = Tones/TONE3000, capture = Capture editor, device = Device screen, snaptone = SnapTone conversion, song = Song screen,
// update = app updates (shell).
import type { AppApi } from "./host/app";
import type { FilesApi } from "./host/files";
import type { TonesApi } from "./host/tones";
import type { CaptureApi } from "./host/capture";
import type { DeviceHostApi } from "./host/device";
import type { SnapToneApi } from "./host/snaptone";
import type { SongHostApi } from "./host/song";
import type { UpdateApi } from "./host/update";

export interface HostApi {
  kind: "electron" | "web";
  platform: "darwin" | "win32" | "linux" | "web";
  app: AppApi;
  files: FilesApi;
  tones: TonesApi;
  capture: CaptureApi;
  device: DeviceHostApi;
  snaptone: SnapToneApi;
  song: SongHostApi;
  update: UpdateApi;
}
