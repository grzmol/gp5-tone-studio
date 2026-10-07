import type { HostApi } from "@shared/host";
import { webHost } from "./web";

/** Electron preload bridge when present, otherwise the browser build's fallback host. */
export const host: HostApi = window.gp5host ?? webHost;
export const isElectron = host.kind === "electron";
