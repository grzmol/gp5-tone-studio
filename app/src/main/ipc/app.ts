import { app, BrowserWindow, shell } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/host/app";
import { HostError } from "@shared/ipc";
import { handle } from "./handle";

const settingsPath = () => join(app.getPath("userData"), "settings.json");
let cache: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    cache = { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsPath(), "utf8")) };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache!;
}

async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await mkdir(dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2));
  cache = next;
  return next;
}

/** A backup or write is running (the renderer reports its progress); window close asks first. */
let jobProgress: number | null = null;
export const isJobRunning = () => jobProgress !== null;

/** Files the OS asked us to open before the renderer was ready to receive them. */
const openedFiles: string[] = [];
export function queueOpenedFiles(paths: string[]): void {
  openedFiles.push(...paths);
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

export function registerAppIpc(getWindow: () => BrowserWindow | null): void {
  handle("app:version", () => app.getVersion());
  handle("app:getSettings", () => loadSettings());
  handle("app:setSettings", (_e, patch: Partial<AppSettings>) => saveSettings(patch));
  handle("app:openExternal", async (_e, url: string) => {
    if (!isHttp(url)) throw new HostError("invalid", "Only http(s) links can be opened");
    await shell.openExternal(url);
  });
  handle("app:showItemInFolder", (_e, path: string) => shell.showItemInFolder(path));
  handle("app:openPath", async (_e, path: string) => {
    const err = await shell.openPath(path);
    if (err) throw new HostError("io", err);
  });
  handle("app:setProgress", (_e, fraction: number | null) => {
    jobProgress = fraction === null ? null : Math.max(0, Math.min(1, fraction));
    getWindow()?.setProgressBar(jobProgress === null ? -1 : jobProgress);
  });
  handle("app:takeOpenedFiles", () => openedFiles.splice(0));
}
