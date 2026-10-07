import { app, BrowserWindow, dialog, nativeImage, net, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { HostError } from "@shared/ipc";
import type { AccountState, FlowRequest, FlowResult, LocalIrRequest, SendRequest, T3kModel, T3kTone, T3kUser, TonePage, ToneRecord, TonesEvent, ToneListKind, ViewBounds } from "@shared/host/tones";
import { sanitizeSlotName } from "@shared/tone3000";
import { assertWav, NamCheckError, prepareNam } from "@shared/nam";
import { handle } from "./handle";
import { loadSettings } from "./app";
import { postToken, T3kClient } from "../tone3000/api";
import { TokenManager, type TokenSet, type TokenStore } from "../tone3000/tokens";
import { cancelFlow, runFlow, setFlowBounds } from "../tone3000/oauth";
import { buildRecord, listRecords, readRecord, writeRecord } from "../tone3000/records";
import { streamToFile } from "../tone3000/files";

declare global {
  interface ImportMetaEnv {
    readonly MAIN_VITE_T3K_CLIENT_ID?: string;
    readonly MAIN_VITE_T3K_REDIRECT_URI?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const DEFAULT_REDIRECT = "http://localhost:3001/callback";
const LIST_TTL = 10 * 60_000;

const userData = () => app.getPath("userData");
const tonesDir = () => join(userData(), "tones");
const cacheDir = () => join(userData(), "tone-cache");
const handoffDir = () => join(userData(), "ready-for-suite");
const statePath = () => join(userData(), "tone3000.json");
const tokenPath = () => join(userData(), "t3k-tokens.enc");

/** Non-secret TONE3000 state: config override, splash flag, last known user. */
interface T3kState {
  clientId?: string;
  redirectUri?: string;
  splashSeen?: boolean;
  user?: T3kUser | null;
}

async function readState(): Promise<T3kState> {
  try {
    return JSON.parse(await readFile(statePath(), "utf8")) as T3kState;
  } catch {
    return {};
  }
}

async function patchState(patch: Partial<T3kState>): Promise<void> {
  await writeFile(statePath(), JSON.stringify({ ...(await readState()), ...patch }, null, 2));
}

async function config(): Promise<{ clientId: string | null; redirectUri: string }> {
  const s = await readState();
  return {
    // Literal `import.meta.env.MAIN_VITE_*` so electron-vite replaces them at build time.
    clientId: s.clientId || import.meta.env.MAIN_VITE_T3K_CLIENT_ID || process.env.T3K_CLIENT_ID || null,
    redirectUri: s.redirectUri || import.meta.env.MAIN_VITE_T3K_REDIRECT_URI || DEFAULT_REDIRECT,
  };
}

/** Tokens are encrypted with the OS keychain (safeStorage). Without one they live in memory for this run only. */
const tokenStore: TokenStore = {
  async load() {
    if (!safeStorage.isEncryptionAvailable() || !existsSync(tokenPath())) return null;
    try {
      return JSON.parse(safeStorage.decryptString(await readFile(tokenPath()))) as TokenSet;
    } catch {
      return null; // unreadable or from another machine: signed out
    }
  },
  async save(tokens) {
    if (!safeStorage.isEncryptionAvailable()) return;
    await writeFile(tokenPath(), safeStorage.encryptString(JSON.stringify(tokens)));
  },
  async clear() {
    await rm(tokenPath(), { force: true });
  },
};

const fetchFn = (url: string, init?: RequestInit) => net.fetch(url, init);

const tokens = new TokenManager(tokenStore, async (refreshToken) => {
  const { clientId } = await config();
  if (!clientId) throw new HostError("unsupported", "TONE3000 isn't configured in this build");
  return postToken(fetchFn, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
});
const client = new T3kClient(tokens, fetchFn);

const listCache = new Map<string, TonePage>();

async function fetchUser(): Promise<T3kUser | null> {
  try {
    const user = await client.user();
    await patchState({ user });
    return user;
  } catch (e) {
    if (e instanceof HostError && e.code === "unauthorized") return null;
    return (await readState()).user ?? null;
  }
}

async function account(): Promise<AccountState> {
  const s = await readState();
  const { clientId } = await config();
  const signedIn = await tokens.signedIn();
  return {
    status: signedIn ? "signed-in" : tokens.expired ? "expired" : "signed-out",
    user: signedIn ? (s.user ?? (await fetchUser())) : null,
    configured: Boolean(clientId),
    splashSeen: Boolean(s.splashSeen),
  };
}

async function beginFlow(win: BrowserWindow, req: FlowRequest, bounds: ViewBounds): Promise<FlowResult> {
  const { clientId, redirectUri } = await config();
  if (!clientId)
    return { status: "error", message: "This build has no TONE3000 app key. Set MAIN_VITE_T3K_CLIENT_ID when building, or add a clientId to tone3000.json in the app data folder." };
  const raw = await runFlow(win, clientId, redirectUri, req, bounds);
  if (raw.status !== "code") return raw;
  try {
    const res = await postToken(fetchFn, { grant_type: "authorization_code", code: raw.code, code_verifier: raw.verifier, redirect_uri: redirectUri, client_id: clientId });
    await tokens.set(res);
    listCache.clear();
    const user = await fetchUser();
    return { status: "connected", user, toneId: raw.toneId };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "TONE3000 sign-in failed" };
  }
}

async function list(kind: ToneListKind, page: number, refresh = false): Promise<TonePage> {
  const key = `${kind}:${page}`;
  const hit = listCache.get(key);
  if (hit && !refresh && Date.now() - hit.fetchedAt < LIST_TTL) return hit;
  const res = await client.list(kind, page);
  const out: TonePage = { ...res, fetchedAt: Date.now() };
  listCache.set(key, out);
  return out;
}

/** Fetch an image once, store a downscaled JPEG in tone-cache, hand it to the renderer as a data: URL. */
async function image(url: string): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) return null;
  const file = join(cacheDir(), `${createHash("sha1").update(url).digest("hex")}.jpg`);
  try {
    return `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    /* not cached */
  }
  try {
    const res = await net.fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) {
      const type = res.headers.get("content-type") ?? "image/png";
      return type.startsWith("image/") ? `data:${type};base64,${buf.toString("base64")}` : null;
    }
    if (img.getSize().width > 480) img = img.resize({ width: 480, quality: "good" });
    const jpeg = img.toJPEG(82);
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(file, jpeg);
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

function emit(getWindow: () => BrowserWindow | null, event: TonesEvent): void {
  getWindow()?.webContents.send("tones:event", event);
}

async function downloadModel(getWindow: () => BrowserWindow | null, toneId: number, modelId: number) {
  const [tone, models] = await Promise.all([client.tone(toneId), client.models(toneId)]);
  const model = models.find((m) => m.id === modelId);
  if (!model) throw new HostError("not-found", "This model isn't in the tone anymore");
  const ext = tone.format === "ir" ? "wav" : "nam";
  const fileName = `${model.id}.${ext}`;
  const path = join(tonesDir(), String(toneId), fileName);
  let bytes = (await stat(path).catch(() => null))?.size ?? 0;
  if (!bytes) {
    const res = await client.request(model.model_url);
    bytes = await streamToFile(res, path, (received, total) => emit(getWindow, { type: "progress", toneId, modelId, step: "download", received, total }));
  }
  const record = await writeRecord(tonesDir(), buildRecord(await readRecord(tonesDir(), toneId), tone, models, { model, file: fileName, bytes }, new Date()));
  return { path, bytes, record, tone, model, models };
}

async function prepareForSuite(getWindow: () => BrowserWindow | null, req: SendRequest) {
  const name = sanitizeSlotName(req.name);
  if (!name) throw new HostError("invalid", "Give the capture a name (letters and digits, up to 10 characters)");
  const dl = await downloadModel(getWindow, req.toneId, req.modelId);
  const progress = (step: "check" | "save") => emit(getWindow, { type: "progress", toneId: req.toneId, modelId: req.modelId, step, received: 0, total: null });
  progress("check");
  const buf = await readFile(dl.path);
  const isIr = dl.tone.format === "ir";
  let out: Buffer | string = buf;
  let check: { version: string; reshaped: boolean } | null = null;
  try {
    if (isIr) assertWav(buf);
    else {
      const prepared = prepareNam(req.text ?? buf.toString("utf8"));
      out = prepared.json;
      check = prepared.check;
    }
  } catch (e) {
    throw new HostError("invalid", e instanceof NamCheckError || e instanceof Error ? e.message : String(e));
  }
  progress("save");
  const fileName = `${name}.${isIr ? "wav" : "nam"}`;
  await mkdir(handoffDir(), { recursive: true });
  const path = join(handoffDir(), fileName);
  await writeFile(path, out);
  const prev = await readRecord(tonesDir(), req.toneId);
  const record = await writeRecord(
    tonesDir(),
    buildRecord(prev, dl.tone, dl.models, { model: dl.model, file: basename(dl.path), bytes: dl.bytes, reshaped: check?.reshaped }, new Date()),
  );
  return { path, fileName, bytes: dl.bytes, check, record };
}

async function updateRecord(toneId: number, fn: (r: ToneRecord) => ToneRecord): Promise<ToneRecord> {
  const rec = await readRecord(tonesDir(), toneId);
  if (!rec) throw new HostError("not-found", "This tone hasn't been downloaded yet");
  return writeRecord(tonesDir(), fn(rec));
}

async function openSuite(getWindow: () => BrowserWindow | null): Promise<{ watched: boolean }> {
  if (process.platform === "linux")
    throw new HostError("unsupported", "Valeton Suite runs on Windows and macOS. Copy the file to a computer with Suite, import it, then reconnect the pedal here.");
  const path = (await loadSettings()).valetonSuitePath;
  if (!path) throw new HostError("not-found", "Choose where Valeton Suite is installed first.");
  if (!existsSync(path)) throw new HostError("not-found", `Valeton Suite isn't at ${path} anymore. Choose its location again.`);
  const watch = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    emit(getWindow, { type: "suite", running: true });
    child.once("exit", () => emit(getWindow, { type: "suite", running: false }));
    child.once("error", () => emit(getWindow, { type: "suite", running: false }));
    child.unref();
  };
  // macOS: `open -W` returns when the app quits. Windows: watch the .exe process directly.
  if (process.platform === "darwin") {
    watch("open", ["-W", path]);
    return { watched: true };
  }
  if (/\.exe$/i.test(path)) {
    watch(path, []);
    return { watched: true };
  }
  const err = await shell.openPath(path);
  if (err) throw new HostError("io", err);
  return { watched: false };
}

export function registerTonesIpc(getWindow: () => BrowserWindow | null): void {
  handle("tones:account", () => account());
  handle("tones:markSplashSeen", () => patchState({ splashSeen: true }));
  handle("tones:beginFlow", (_e, req: FlowRequest, bounds: ViewBounds) => {
    const win = getWindow();
    if (!win) throw new HostError("internal", "No window");
    return beginFlow(win, req, bounds);
  });
  handle("tones:setFlowBounds", (_e, bounds: ViewBounds) => setFlowBounds(bounds));
  handle("tones:cancelFlow", () => cancelFlow());
  handle("tones:signOut", async () => {
    await tokens.clear();
    tokens.expired = false;
    listCache.clear();
    await patchState({ user: null });
  });
  handle("tones:list", (_e, kind: ToneListKind, page: number, refresh?: boolean) => list(kind, page, refresh));
  handle("tones:tone", (_e, id: number): Promise<T3kTone> => client.tone(id));
  handle("tones:models", (_e, toneId: number): Promise<T3kModel[]> => client.models(toneId));
  handle("tones:image", (_e, url: string) => image(url));
  handle("tones:downloadModel", async (_e, toneId: number, modelId: number) => {
    const { path, bytes, record } = await downloadModel(getWindow, toneId, modelId);
    return { path, bytes, record };
  });
  handle("tones:prepareForSuite", (_e, req: SendRequest) => prepareForSuite(getWindow, req));
  handle("tones:prepareLocalIr", async (_e, req: LocalIrRequest) => {
    const name = sanitizeSlotName(req.name);
    if (!name) throw new HostError("invalid", "Give the IR a name (letters and digits, up to 10 characters)");
    const buf = req.path ? await readFile(req.path) : req.bytes ? Buffer.from(req.bytes) : null;
    if (!buf) throw new HostError("invalid", "No file to prepare");
    try {
      assertWav(buf);
    } catch (e) {
      throw new HostError("invalid", e instanceof Error ? e.message : String(e));
    }
    await mkdir(handoffDir(), { recursive: true });
    const fileName = `${name}.wav`;
    const path = join(handoffDir(), fileName);
    await writeFile(path, buf);
    return { path, fileName };
  });
  handle("tones:setPending", (_e, toneId: number, pending: ToneRecord["gp5"]["pending"] | null) =>
    updateRecord(toneId, (r) => ({ ...r, gp5: { ...r.gp5, pending: pending ?? undefined } })),
  );
  handle("tones:link", (_e, toneId: number, link: { kind: "snaptone" | "ir"; slot: number; slotName: string } | null) =>
    updateRecord(toneId, (r) => {
      const { snaptoneSlot: _s, irSlot: _i, slotName: _n, linkedAt: _l, pending: _p, ...rest } = r.gp5;
      if (!link) return { ...r, gp5: rest };
      return {
        ...r,
        gp5: { ...rest, ...(link.kind === "snaptone" ? { snaptoneSlot: link.slot } : { irSlot: link.slot }), slotName: link.slotName, linkedAt: new Date().toISOString() },
      };
    }),
  );
  handle("tones:local", () => listRecords(tonesDir()));
  handle("tones:handoff", async () => {
    const dir = handoffDir();
    await mkdir(dir, { recursive: true });
    const names = (await readdir(dir)).filter((n) => /\.(nam|wav)$/i.test(n));
    const files = await Promise.all(
      names.map(async (name) => {
        const s = await stat(join(dir, name));
        return { name, path: join(dir, name), size: s.size, mtime: s.mtimeMs };
      }),
    );
    return { dir, files: files.sort((a, b) => b.mtime - a.mtime) };
  });
  handle("tones:openSuite", () => openSuite(getWindow));
  handle("tones:pickSuite", async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: "Where is Valeton Suite?",
      properties: ["openFile"],
      filters: process.platform === "darwin" ? [{ name: "Applications", extensions: ["app"] }] : [{ name: "Programs", extensions: ["exe"] }],
      defaultPath: process.platform === "darwin" ? "/Applications" : undefined,
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });
}
