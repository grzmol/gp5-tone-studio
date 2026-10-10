import { app, dialog, net, type BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODEL_CHECKSUM_ERROR, modelDownloadError, SEPARATION_MODEL, type ModelProgress } from "@shared/host/song";
import { sanitizeFileName } from "@shared/files-naming";
import { HostError } from "@shared/ipc";
import { handle } from "./handle";

// The Song screen's separation model (src/shared/host/song.ts): downloaded on first use into userData/models,
// resumed from a `.part` file after an interrupted download, checked against the pinned SHA-256 and only then
// renamed to its final name. Saving exported stems: one Save dialog, or a folder for several files.

const modelsDir = () => join(app.getPath("userData"), "models");
const modelPath = () => join(modelsDir(), SEPARATION_MODEL.file);
const partPath = () => `${modelPath()}.part`;
const PROGRESS_EVERY_BYTES = 1 << 20;

async function fileSize(path: string): Promise<number | null> {
  return stat(path).then((s) => s.size, () => null);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Append the rest of the model to `.part` (HTTP Range when part of it is there already). */
async function downloadPart(onProgress: (p: ModelProgress) => void): Promise<void> {
  const total = SEPARATION_MODEL.bytes;
  let have = (await fileSize(partPath())) ?? 0;
  if (have > total) {
    await rm(partPath());
    have = 0;
  }
  if (have === total) return;
  let res: Response;
  try {
    res = await net.fetch(SEPARATION_MODEL.url, { headers: have ? { Range: `bytes=${have}-` } : {} });
  } catch {
    throw new HostError("network", modelDownloadError(null));
  }
  if (res.status !== 200 && res.status !== 206) throw new HostError("network", modelDownloadError(res.status));
  // A server that ignores Range sends the whole file again: start over.
  if (res.status === 200) have = 0;
  const file = await open(partPath(), have ? "a" : "w");
  try {
    let received = have;
    let reported = 0;
    onProgress({ received, total });
    const reader = res.body!.getReader();
    for (;;) {
      const chunk = await reader.read().catch(() => {
        throw new HostError("network", modelDownloadError(null));
      });
      if (chunk.done) break;
      await file.write(chunk.value);
      received += chunk.value.byteLength;
      if (received - reported >= PROGRESS_EVERY_BYTES) {
        reported = received;
        onProgress({ received, total });
      }
    }
    onProgress({ received, total });
  } finally {
    await file.close();
  }
}

async function ensureModel(onProgress: (p: ModelProgress) => void): Promise<void> {
  if ((await fileSize(modelPath())) === SEPARATION_MODEL.bytes) return;
  await mkdir(modelsDir(), { recursive: true });
  await downloadPart(onProgress);
  if ((await fileSize(partPath())) !== SEPARATION_MODEL.bytes || (await sha256File(partPath())) !== SEPARATION_MODEL.sha256) {
    await rm(partPath(), { force: true });
    throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
  }
  await rename(partPath(), modelPath());
}

export function registerSongIpc(getWindow: () => BrowserWindow | null): void {
  // One download at a time; a second request (retry, second split) joins it.
  let pending: Promise<void> | null = null;
  const progress = (p: ModelProgress) => getWindow()?.webContents.send("song:modelProgress", p);

  handle("song:hasModel", async () => (await fileSize(modelPath())) === SEPARATION_MODEL.bytes);
  handle("song:model", async () => {
    pending ??= ensureModel(progress).finally(() => {
      pending = null;
    });
    await pending;
    return new Uint8Array(await readFile(modelPath()));
  });

  // Saving is two steps so each IPC message carries one file: pick the target, then write the files into it.
  let target: { kind: "file"; path: string } | { kind: "dir"; path: string } | null = null;
  handle("song:pickTarget", async (_e, names: string[], title: string) => {
    const win = getWindow();
    if (names.length === 1) {
      const name = sanitizeFileName(names[0], "Audio");
      const opts = { title, defaultPath: join(app.getPath("music"), name), filters: [{ name: "WAV audio", extensions: ["wav"] }] };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      target = res.canceled || !res.filePath ? null : { kind: "file", path: res.filePath };
    } else {
      const opts = { title, defaultPath: app.getPath("music"), properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      target = res.canceled || !res.filePaths[0] ? null : { kind: "dir", path: res.filePaths[0] };
    }
    return target?.path ?? null;
  });
  handle("song:writeFile", async (_e, name: string, bytes: Uint8Array) => {
    if (!target) throw new HostError("invalid", "Choose where to save first.");
    const path = target.kind === "file" ? target.path : join(target.path, sanitizeFileName(name, "Audio"));
    await writeFile(path, bytes);
  });
}
