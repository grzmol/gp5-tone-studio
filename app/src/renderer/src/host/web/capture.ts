import type { CaptureApi, CaptureDraft, CaptureKey, CaptureVersion } from "@shared/host/capture";
import { HostError } from "@shared/ipc";

// Browser build: captures opened from dropped files live in IndexedDB (one key-value store).
// TONE3000 tones are downloaded by the desktop app only, so tone refs are unsupported here.
const DB = "gp5-captures";
const STORE = "kv";
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new HostError("io", req.error?.message ?? "The browser storage can't be opened"));
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new HostError("io", req.error?.message ?? "Browser storage failed"));
  });
}

const get = <T>(key: string) => tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
const put = (key: string, value: unknown) => tx("readwrite", (s) => s.put(value, key));
const del = (key: string) => tx("readwrite", (s) => s.delete(key));

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fileRef(ref: string): string {
  if (/^file-[0-9a-f]{16}$/.test(ref)) return ref;
  if (/^\d+$/.test(ref)) throw new HostError("unsupported", "Editing TONE3000 captures needs the desktop app");
  throw new HostError("invalid", "Unknown capture");
}

const prefix = (key: CaptureKey) => `${fileRef(key.ref)}/`;

async function versions(key: CaptureKey): Promise<CaptureVersion[]> {
  const index = (await get<number[]>(`${prefix(key)}versions`)) ?? [];
  const all = await Promise.all(index.map((n) => get<CaptureVersion>(`${prefix(key)}v${n}`)));
  return all.filter((v): v is CaptureVersion => !!v).sort((a, b) => a.n - b.n);
}

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const webCapture: CaptureApi = {
  importFile: async () => {
    throw new HostError("unsupported", "Opening files by path needs the desktop app");
  },
  importText: async (fileName, text) => {
    try {
      JSON.parse(text);
    } catch {
      throw new HostError("invalid", "This file isn't valid JSON, so it can't be a NAM capture.");
    }
    const ref = `file-${(await sha256(text)).slice(0, 16)}`;
    if (!(await get(`${ref}/original`))) await put(`${ref}/original`, { fileName, text });
    return ref;
  },
  open: async (ref) => {
    const r = fileRef(ref);
    const original = await get<{ fileName: string; text: string }>(`${r}/original`);
    if (!original) throw new HostError("not-found", "This capture isn't stored in this browser anymore. Open the .nam file again.");
    const key = { ref: r, modelId: null };
    return {
      source: { ...key, kind: "file", fileName: original.fileName, sha256: await sha256(original.text), text: original.text },
      versions: await versions(key),
      draft: (await get<CaptureDraft>(`${r}/draft`)) ?? null,
    };
  },
  saveVersion: async (key, input) => {
    const p = prefix(key);
    const original = await get<{ text: string }>(`${p}original`);
    if (!original) throw new HostError("not-found", "This capture isn't stored in this browser anymore.");
    const index = (await get<number[]>(`${p}versions`)) ?? [];
    const n = index.reduce((max, v) => Math.max(max, v), 0) + 1;
    const version: CaptureVersion = {
      n,
      createdAt: new Date().toISOString(),
      base: await sha256(original.text),
      recipe: input.recipe,
      summary: input.summary,
      ...(input.restoredFrom ? { restoredFrom: input.restoredFrom } : {}),
    };
    await put(`${p}v${n}`, version);
    await put(`${p}v${n}.nam`, input.file);
    await put(`${p}versions`, [...index, n]);
    await del(`${p}draft`);
    return version;
  },
  deleteVersion: async (key, n) => {
    const p = prefix(key);
    const index = (await get<number[]>(`${p}versions`)) ?? [];
    await put(`${p}versions`, index.filter((v) => v !== n));
    await del(`${p}v${n}`);
    await del(`${p}v${n}.nam`);
  },
  saveDraft: async (key, draft) => {
    if (draft === null) await del(`${prefix(key)}draft`);
    else await put(`${prefix(key)}draft`, draft);
  },
  showFiles: async () => {
    throw new HostError("unsupported", "Showing files needs the desktop app");
  },
  exportFile: async (suggestedName, text) => {
    download(suggestedName.endsWith(".nam") ? suggestedName : `${suggestedName}.nam`, text);
    return suggestedName;
  },
  saveForSuite: async () => {
    throw new HostError("unsupported", "Valeton Suite hand-off needs the desktop app");
  },
};
