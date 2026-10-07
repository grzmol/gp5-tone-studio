import { ipcRenderer } from "electron";
import { HostError, type Result } from "@shared/ipc";

/** Call a `handle()` channel in main and unwrap its Result (throws HostError with the original code). */
export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>;
  if (res.ok) return res.data;
  throw new HostError(res.error.code, res.error.message);
}
