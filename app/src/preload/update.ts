import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { UpdateApi, UpdateSnapshot } from "@shared/host/update";
import { invoke } from "./invoke";

export const updateApi: UpdateApi = {
  state: () => invoke("update:state"),
  check: () => invoke("update:check"),
  download: () => invoke("update:download"),
  install: () => invoke("update:install"),
  onState: (cb) => {
    const handler = (_e: IpcRendererEvent, s: UpdateSnapshot) => cb(s);
    ipcRenderer.on("update:state", handler);
    return () => ipcRenderer.removeListener("update:state", handler);
  },
};
