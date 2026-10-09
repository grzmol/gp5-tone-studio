import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { TonesApi, TonesEvent } from "@shared/host/tones";
import { invoke } from "./invoke";

export const tonesApi: TonesApi = {
  account: () => invoke("tones:account"),
  markSplashSeen: () => invoke("tones:markSplashSeen"),
  beginFlow: (req, bounds) => invoke("tones:beginFlow", req, bounds),
  setFlowBounds: (bounds) => invoke("tones:setFlowBounds", bounds),
  cancelFlow: () => invoke("tones:cancelFlow"),
  signOut: () => invoke("tones:signOut"),
  list: (kind, page, refresh) => invoke("tones:list", kind, page, refresh),
  tone: (id) => invoke("tones:tone", id),
  models: (toneId) => invoke("tones:models", toneId),
  image: (url) => invoke("tones:image", url),
  downloadModel: (toneId, modelId) => invoke("tones:downloadModel", toneId, modelId),
  prepareForSuite: (req) => invoke("tones:prepareForSuite", req),
  prepareSnapTone: (req) => invoke("tones:prepareSnapTone", req),
  prepareLocalIr: (req) => invoke("tones:prepareLocalIr", req),
  setPending: (toneId, pending) => invoke("tones:setPending", toneId, pending),
  link: (toneId, link) => invoke("tones:link", toneId, link),
  local: () => invoke("tones:local"),
  handoff: () => invoke("tones:handoff"),
  openSuite: () => invoke("tones:openSuite"),
  pickSuite: () => invoke("tones:pickSuite"),
  onEvent: (cb) => {
    const handler = (_e: IpcRendererEvent, event: TonesEvent) => cb(event);
    ipcRenderer.on("tones:event", handler);
    return () => ipcRenderer.removeListener("tones:event", handler);
  },
};
