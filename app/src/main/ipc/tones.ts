import { app, BrowserWindow, nativeImage, net, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { HostError } from "@shared/ipc";
import type { AccountState, FlowRequest, FlowResult, SendRequest, SnapToneSource, T3kModel, T3kTone, T3kUser, TonePage, ToneRecord, TonesEvent, ToneListKind, UserIrSource, ViewBounds } from "@shared/host/tones";
import { assertWav, NamCheckError, prepareNam } from "@shared/nam";
import { handle } from "./handle";
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
/** Printable ASCII without spaces; client_ids are opaque tokens. */
const APP_KEY = /^[\x21-\x7e]{1,256}$/;
/** Opened WAVs are read whole; real IRs are a few hundred KB, so anything this big isn't one. */
const MAX_LOCAL_IR = 64 * 1024 * 1024;

const userData = () => app.getPath("userData");
const tonesDir = () => join(userData(), "tones");
const cacheDir = () => join(userData(), "tone-cache");
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
    appKey: s.clientId || null,
    splashSeen: Boolean(s.splashSeen),
  };
}

async function dropSession(): Promise<void> {
  await tokens.clear();
  tokens.expired = false;
  listCache.clear();
  await patchState({ user: null });
}

/** Tokens belong to the client_id that issued them, so switching the effective key signs out. */
async function setAppKey(value: unknown): Promise<AccountState> {
  if (value !== null && typeof value !== "string") throw new HostError("invalid", "The TONE3000 app key must be text");
  const next = value?.trim() || undefined;
  if (next && !APP_KEY.test(next)) throw new HostError("invalid", "A TONE3000 app key has no spaces and is at most 256 characters");
  const before = (await config()).clientId;
  await patchState({ clientId: next });
  if ((await config()).clientId !== before) await dropSession();
  return account();
}

async function beginFlow(win: BrowserWindow, req: FlowRequest, bounds: ViewBounds): Promise<FlowResult> {
  const { clientId, redirectUri } = await config();
  if (!clientId)
    return { status: "error", message: "No TONE3000 app key is set. Enter one in Settings › TONE3000 account." };
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

interface DownloadedModel {
  path: string;
  bytes: number;
  record: ToneRecord;
  tone: T3kTone;
  model: T3kModel;
  models: T3kModel[];
}

async function downloadModel(getWindow: () => BrowserWindow | null, toneId: number, modelId: number): Promise<DownloadedModel> {
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

/** Send steps 1–2: download the model, then check it (WAV) or check and reshape it to NAM 0.5.x. */
async function downloadAndCheck(getWindow: () => BrowserWindow | null, req: SendRequest) {
  const dl = await downloadModel(getWindow, req.toneId, req.modelId);
  emit(getWindow, { type: "progress", toneId: req.toneId, modelId: req.modelId, step: "check", received: 0, total: null });
  const buf = await readFile(dl.path);
  const isIr = dl.tone.format === "ir";
  try {
    if (isIr) {
      assertWav(buf);
      return { dl, isIr, out: buf as Buffer | string, check: null };
    }
    const prepared = prepareNam(req.text ?? buf.toString("utf8"));
    return { dl, isIr, out: prepared.json as Buffer | string, check: prepared.check };
  } catch (e) {
    throw new HostError("invalid", e instanceof NamCheckError || e instanceof Error ? e.message : String(e));
  }
}

async function recordSent(dl: DownloadedModel, reshaped: boolean | undefined): Promise<ToneRecord> {
  const prev = await readRecord(tonesDir(), dl.tone.id);
  return writeRecord(tonesDir(), buildRecord(prev, dl.tone, dl.models, { model: dl.model, file: basename(dl.path), bytes: dl.bytes, reshaped }, new Date()));
}

/** IR send steps 1–2: download the WAV and check it is one; the renderer converts it and writes the slot. */
async function prepareIr(getWindow: () => BrowserWindow | null, req: SendRequest): Promise<UserIrSource> {
  const { dl, isIr, out } = await downloadAndCheck(getWindow, req);
  if (!isIr) throw new HostError("invalid", "This tone is a NAM capture, not an impulse response");
  return { wav: new Uint8Array(out as Buffer), record: await recordSent(dl, undefined) };
}

async function prepareSnapTone(getWindow: () => BrowserWindow | null, req: SendRequest): Promise<SnapToneSource> {
  const { dl, isIr, out, check } = await downloadAndCheck(getWindow, req);
  if (isIr || !check) throw new HostError("invalid", "This tone is an impulse response, not a NAM capture");
  return { text: String(out), bytes: dl.bytes, check, record: await recordSent(dl, check.reshaped) };
}

async function updateRecord(toneId: number, fn: (r: ToneRecord) => ToneRecord): Promise<ToneRecord> {
  const rec = await readRecord(tonesDir(), toneId);
  if (!rec) throw new HostError("not-found", "This tone hasn't been downloaded yet");
  return writeRecord(tonesDir(), fn(rec));
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
  handle("tones:signOut", () => dropSession());
  handle("tones:setAppKey", (_e, appKey: unknown) => setAppKey(appKey));
  handle("tones:list", (_e, kind: ToneListKind, page: number, refresh?: boolean) => list(kind, page, refresh));
  handle("tones:tone", (_e, id: number): Promise<T3kTone> => client.tone(id));
  handle("tones:models", (_e, toneId: number): Promise<T3kModel[]> => client.models(toneId));
  handle("tones:image", (_e, url: string) => image(url));
  handle("tones:downloadModel", async (_e, toneId: number, modelId: number) => {
    const { path, bytes, record } = await downloadModel(getWindow, toneId, modelId);
    return { path, bytes, record };
  });
  handle("tones:prepareIr", (_e, req: SendRequest) => prepareIr(getWindow, req));
  handle("tones:prepareSnapTone", (_e, req: SendRequest) => prepareSnapTone(getWindow, req));
  // An IR opened from the OS ("Open with", second instance) arrives as a path only; the renderer converts it.
  handle("tones:readLocalIr", async (_e, path: unknown) => {
    if (typeof path !== "string" || extname(path).toLowerCase() !== ".wav") throw new HostError("invalid", "Only .wav files can go to a User IR slot");
    const size = (await stat(path).catch(() => null))?.size;
    if (size === undefined) throw new HostError("not-found", `${basename(path)} isn't there anymore`);
    if (size > MAX_LOCAL_IR) throw new HostError("invalid", `${basename(path)} is too large for an impulse response`);
    return new Uint8Array(await readFile(path));
  });
  handle("tones:link", (_e, toneId: number, link: { kind: "snaptone" | "ir"; slot: number; slotName: string } | null) =>
    updateRecord(toneId, (r) => {
      const { snaptoneSlot: _s, irSlot: _i, slotName: _n, linkedAt: _l, ...rest } = r.gp5;
      if (!link) return { ...r, gp5: rest };
      return {
        ...r,
        gp5: { ...rest, ...(link.kind === "snaptone" ? { snaptoneSlot: link.slot } : { irSlot: link.slot }), slotName: link.slotName, linkedAt: new Date().toISOString() },
      };
    }),
  );
  handle("tones:local", () => listRecords(tonesDir()));
}
