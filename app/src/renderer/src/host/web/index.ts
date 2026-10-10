import type { HostApi } from "@shared/host";
import { webApp } from "./app";
import { webFiles } from "./files";
import { webTones } from "./tones";
import { webCapture } from "./capture";
import { webDevice } from "./device";
import { webSnapTone } from "./snaptone";
import { webSong } from "./song";

export const webHost: HostApi = {
  kind: "web",
  platform: "web",
  app: webApp,
  files: webFiles,
  tones: webTones,
  capture: webCapture,
  device: webDevice,
  snaptone: webSnapTone,
  song: webSong,
};
