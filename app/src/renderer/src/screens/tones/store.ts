import { create } from "zustand";
import type { AccountState, FlowRequest, NamCheck, SendStep, T3kTone, ToneListKind, ToneRecord } from "@shared/host/tones";
import { HostError } from "@shared/ipc";
import { firstEmptySlot } from "@shared/tone3000";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { notifySuccess } from "@/app/notify";
import type { PresetRef } from "./usage";
import { convertToSnapTone } from "@/snaptone/convert";
import { prepareUserIr, type UserIrFile } from "@/userir/convert";

export interface ListState {
  tones: T3kTone[];
  page: number;
  totalPages: number;
  total: number;
  fetchedAt: number;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

/** "converting" is SnapTone-only; "ready" waits for the write (IR: for the user to pick the slot and press Write). */
export type SendPhase = "idle" | "running" | "converting" | "ready" | "writing" | "linked" | "error";

export interface SendState {
  toneId: number;
  modelId: number;
  name: string;
  kind: "snaptone" | "ir";
  phase: SendPhase;
  /** SnapTone: 1 download, 2 check, 3 convert, 4 write, 5 linked. IR: 1 download, 2 check and convert, 3 slot, 4 write, 5 linked */
  step: 1 | 2 | 3 | 4 | 5;
  received: number;
  total: number | null;
  /** Fraction of the SnapTone conversion or of the write */
  progress: number;
  error: string | null;
  /** SnapTone: the checked NAM file */
  check: NamCheck | null;
  /** SnapTone: the converted 2696-byte file, kept for retrying the write */
  file: Uint8Array | null;
  /** IR: the converted 2048-byte User IR block and what was cut, kept for retrying the write */
  ir: UserIrFile | null;
  /** Target slot chosen by the user: SnapTone 50–79, User IR 0–19 (shown as User IR 1–20) */
  proposedSlot: number | null;
  linkedSlot: number | null;
  /** Edited .nam text from the capture editor, used instead of the download */
  text: string | null;
}

/** Slot context menu: pick which downloaded tone a slot holds. */
export interface LinkChoice {
  kind: "snaptone" | "ir";
  slot: number;
}

export interface UsageInfo {
  presets: (PresetRef & { prst: Uint8Array })[];
  /** "the backup from 7 Oct 2026" — where the index came from */
  source: string;
}

export const TAB_ORDER: ToneListKind[] = ["favorited", "created", "downloaded", "trending", "latest"];

interface TonesState {
  account: AccountState | null;
  tab: ToneListKind;
  format: "all" | "nam" | "ir";
  compatOnly: boolean;
  lists: Partial<Record<ToneListKind, ListState>>;
  records: Record<number, ToneRecord>;
  images: Record<string, string | null>;
  sheet: { toneId: number; tone: T3kTone | null } | null;
  splashOpen: boolean;
  /** Request waiting behind the splash, or running in the embedded view */
  flow: FlowRequest | null;
  flowOpen: boolean;
  slotsReadAt: number | null;
  slotsError: string | null;
  usage: UsageInfo | null;
  send: Record<number, SendState>;
  linkChoice: LinkChoice | null;
}

const empty = (): ListState => ({ tones: [], page: 0, totalPages: 1, total: 0, fetchedAt: 0, loading: false, error: null, loaded: false });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useTones = create<TonesState>(() => ({
  account: null,
  tab: "trending",
  format: "all",
  compatOnly: false,
  lists: {},
  records: {},
  images: {},
  sheet: null,
  splashOpen: false,
  flow: null,
  flowOpen: false,
  slotsReadAt: null,
  slotsError: null,
  usage: null,
  send: {},
  linkChoice: null,
}));

const set = useTones.setState;
const get = useTones.getState;

function patchList(kind: ToneListKind, patch: Partial<ListState>) {
  set((s) => ({ lists: { ...s.lists, [kind]: { ...(s.lists[kind] ?? empty()), ...patch } } }));
}

function patchSend(toneId: number, patch: Partial<SendState>) {
  set((s) => {
    const cur = s.send[toneId];
    return cur ? { send: { ...s.send, [toneId]: { ...cur, ...patch } } } : {};
  });
}

function onUnauthorized(e: unknown): boolean {
  if (e instanceof HostError && e.code === "unauthorized") {
    void loadAccount();
    return true;
  }
  return false;
}

export async function loadAccount(): Promise<void> {
  try {
    const account = await host.tones.account();
    set({ account });
    if (account.status !== "signed-in") set({ lists: {} });
  } catch (e) {
    set({ account: { status: "signed-out", user: null, configured: false, appKey: null, splashSeen: true } });
    console.warn("TONE3000 account", e);
  }
}

export async function loadRecords(): Promise<void> {
  const list = await host.tones.local().catch(() => []);
  set({ records: Object.fromEntries(list.map((r) => [r.tone_id, r])) });
}

/** User IR slots are 0-based on the wire and 1-based on the pedal and in Valeton Suite ("User IR 1" = slot 0). */
export const irSlotLabel = (slot: number) => `User IR ${slot + 1}`;

export const slotLabel = (kind: "snaptone" | "ir", slot: number) => (kind === "ir" ? irSlotLabel(slot) : `SnapTone slot ${slot}`);

function storeRecord(r: ToneRecord) {
  set((s) => ({ records: { ...s.records, [r.tone_id]: r } }));
}

/** Load page 1 (or the next page with `more`). Cached in main for 10 minutes unless `refresh`. */
export async function loadList(kind: ToneListKind, opts: { more?: boolean; refresh?: boolean } = {}): Promise<void> {
  const cur = get().lists[kind] ?? empty();
  if (cur.loading) return;
  if (opts.more && cur.page >= cur.totalPages) return;
  const page = opts.more ? cur.page + 1 : 1;
  patchList(kind, { loading: true, error: null });
  try {
    const res = await host.tones.list(kind, page, opts.refresh);
    const seen = new Set(opts.more ? cur.tones.map((t) => t.id) : []);
    const tones = opts.more ? [...cur.tones, ...res.tones.filter((t) => !seen.has(t.id))] : res.tones;
    patchList(kind, { tones, page: res.page, totalPages: res.totalPages, total: res.total, fetchedAt: res.fetchedAt, loading: false, loaded: true });
  } catch (e) {
    if (onUnauthorized(e)) {
      patchList(kind, { loading: false });
      return;
    }
    patchList(kind, { loading: false, error: message(e) });
  }
}

/** Tab counts come from each list's first page. */
export function loadAllCounts(): void {
  for (const kind of ["favorited", "created", "downloaded"] as const) if (!get().lists[kind]?.loaded) void loadList(kind);
}

const imageRequests = new Set<string>();
export function requestImage(url: string): void {
  if (imageRequests.has(url) || url in get().images) return;
  imageRequests.add(url);
  void host.tones
    .image(url)
    .catch(() => null)
    .then((data) => set((s) => ({ images: { ...s.images, [url]: data } })));
}

// ---------------------------------------------------------------------------------- sign-in / Select flow

/** "Browse TONE3000": splash first (once), then the Select flow (A1 and A2 tones both become SnapTones). */
export async function browse(req: FlowRequest = { prompt: "select_tone" }): Promise<void> {
  if (!get().account) await loadAccount();
  const account = get().account;
  set({ flow: req });
  if (!account?.splashSeen) set({ splashOpen: true });
  else set({ flowOpen: true });
}

/** Plain sign-in: authorize without a prompt, so TONE3000 returns right after login instead of asking for a tone. */
export function signIn(): Promise<void> {
  return browse({});
}

export function continueFromSplash(): void {
  set({ splashOpen: false, flowOpen: true, account: get().account ? { ...get().account!, splashSeen: true } : null });
  void host.tones.markSplashSeen();
}

export function closeSplash(): void {
  set({ splashOpen: false, flow: null });
}

export function closeFlow(): void {
  set({ flowOpen: false, flow: null });
}

export async function signOut(): Promise<void> {
  await host.tones.signOut();
  set({ lists: {} });
  await loadAccount();
}

/** Save the TONE3000 app key from Settings; a different key signs out, so the lists go too. */
export async function setAppKey(appKey: string | null): Promise<void> {
  const account = await host.tones.setAppKey(appKey);
  set({ account, lists: {} });
}

// ---------------------------------------------------------------------------------- sheet

export function openSheet(toneId: number, tone: T3kTone | null = null): void {
  set({ sheet: { toneId, tone } });
}

export function closeSheet(): void {
  set({ sheet: null });
}

// ---------------------------------------------------------------------------------- pedal slots

export async function readSlots(): Promise<void> {
  const d = useDevice.getState();
  if (d.status !== "connected") return;
  try {
    await d.readSnapTones();
    await d.readUserIRs();
    set({ slotsReadAt: Date.now(), slotsError: null });
  } catch (e) {
    set({ slotsError: message(e) });
  }
}

/** Index "used in" from the newest backup in the Library (plus the live preset, which is always known). */
export async function loadUsage(): Promise<void> {
  try {
    const cols = await host.files.listCollections();
    const backup = cols.find((c) => c.kind === "backup");
    if (!backup) {
      set({ usage: null });
      return;
    }
    const presets = await host.files.listPresets(backup.id);
    const date = new Date(backup.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    set({ usage: { presets: presets.map((p) => ({ slot: p.slot ?? -1, name: p.name, prst: p.prst })), source: `the backup from ${date}` } });
  } catch {
    set({ usage: null });
  }
}

// ---------------------------------------------------------------------------------- send to GP-5

/**
 * Create (or replace an idle/finished) send draft. `opts.text` is an edited .nam from the capture editor:
 * it is sent instead of the TONE3000 download.
 */
export function startSendDraft(toneId: number, modelId: number, name: string, kind: "snaptone" | "ir", opts: { text?: string } = {}): void {
  const cur = get().send[toneId];
  if (cur && cur.phase !== "idle" && cur.phase !== "error" && cur.phase !== "linked") return;
  const d = useDevice.getState();
  set((s) => ({
    send: {
      ...s.send,
      [toneId]: {
        toneId,
        modelId,
        name,
        kind,
        phase: "idle",
        step: 1,
        received: 0,
        total: null,
        progress: 0,
        error: null,
        check: null,
        file: null,
        ir: null,
        proposedSlot: firstEmptySlot(kind, kind === "snaptone" ? d.snapTones : d.userIRs),
        linkedSlot: null,
        text: opts.text ?? null,
      },
    },
  }));
}

export function updateDraft(toneId: number, patch: Partial<Pick<SendState, "modelId" | "name" | "proposedSlot">>): void {
  patchSend(toneId, patch);
}

/** Running SnapTone conversions, so cancelSend can stop the worker. */
const conversions = new Map<number, AbortController>();

export function cancelSend(toneId: number): void {
  conversions.get(toneId)?.abort();
  set((st) => {
    const next = { ...st.send };
    delete next[toneId];
    return { send: next };
  });
}

function sendError(toneId: number, e: unknown): void {
  if (onUnauthorized(e)) patchSend(toneId, { phase: "error", error: "Your TONE3000 sign-in expired. Sign in again, then retry." });
  else patchSend(toneId, { phase: "error", error: message(e) });
}

/**
 * SnapTone: download and check in main, convert in a worker, then write the slot when the pedal is connected
 * and a slot is chosen (otherwise it waits in "ready"). IR: download and check in main, convert here, then wait
 * in "ready" until the user picks the slot and writes it (the converted IR says what the pedal keeps).
 */
export async function runSend(toneId: number): Promise<void> {
  const s = get().send[toneId];
  if (!s) return;
  patchSend(toneId, { phase: "running", step: 1, error: null, received: 0, total: null, progress: 0 });
  const req = { toneId, modelId: s.modelId, name: s.name, text: s.text ?? undefined };
  if (s.kind === "ir") {
    try {
      const source = await host.tones.prepareIr(req);
      storeRecord(source.record);
      patchSend(toneId, { step: 2 });
      patchSend(toneId, { phase: "ready", step: 3, ir: prepareUserIr(source.wav) });
    } catch (e) {
      sendError(toneId, e);
    }
    return;
  }
  const abort = new AbortController();
  conversions.set(toneId, abort);
  try {
    const source = await host.tones.prepareSnapTone(req);
    storeRecord(source.record);
    patchSend(toneId, { phase: "converting", step: 3, check: source.check, progress: 0 });
    const file = await convertToSnapTone(source.text, (progress) => patchSend(toneId, { progress }), abort.signal);
    patchSend(toneId, { phase: "ready", step: 4, file, progress: 0 });
  } catch (e) {
    if (!abort.signal.aborted) sendError(toneId, e);
    return;
  } finally {
    conversions.delete(toneId);
  }
  if (useDevice.getState().status === "connected" && get().send[toneId]?.proposedSlot != null) await writeSnapTone(toneId);
}

/** SnapTone step 4: write the converted file to the chosen slot, then link the slot to the tone. */
export async function writeSnapTone(toneId: number): Promise<void> {
  const s = get().send[toneId];
  if (!s?.file || s.proposedSlot === null) return;
  const slot = s.proposedSlot;
  patchSend(toneId, { phase: "writing", step: 4, error: null, progress: 0 });
  try {
    const stored = await useDevice.getState().uploadSnapTone(slot, s.name, s.file, { onProgress: (progress) => patchSend(toneId, { progress }) });
    const rec = await host.tones.link(toneId, { kind: "snaptone", slot, slotName: stored });
    storeRecord(rec);
    patchSend(toneId, { phase: "linked", step: 5, linkedSlot: slot });
    notifySuccess(`Wrote ${slotLabel("snaptone", slot)} on your GP-5`, rec.title);
  } catch (e) {
    patchSend(toneId, { phase: "error", error: message(e) });
  }
}

/** IR step 4: write the converted IR to the chosen User IR slot, then link the slot to the tone. */
export async function writeUserIr(toneId: number): Promise<void> {
  const s = get().send[toneId];
  if (!s?.ir || s.proposedSlot === null) return;
  const slot = s.proposedSlot;
  patchSend(toneId, { phase: "writing", step: 4, error: null, progress: 0 });
  try {
    const stored = await useDevice.getState().uploadUserIr(slot, s.name, s.ir.data, { onProgress: (progress) => patchSend(toneId, { progress }) });
    const rec = await host.tones.link(toneId, { kind: "ir", slot, slotName: stored });
    storeRecord(rec);
    patchSend(toneId, { phase: "linked", step: 5, linkedSlot: slot });
    notifySuccess(`Wrote ${irSlotLabel(slot)} on your GP-5`, rec.title);
  } catch (e) {
    patchSend(toneId, { phase: "error", error: message(e) });
  }
}

/** Progress events from main move the stepper. */
export function onSendProgress(toneId: number, step: SendStep, received: number, total: number | null): void {
  const s = get().send[toneId];
  if (!s || s.phase !== "running") return;
  patchSend(toneId, { step: step === "download" ? 1 : 2, received, total });
}

export async function linkSlot(toneId: number, kind: "snaptone" | "ir", slot: number): Promise<ToneRecord> {
  const d = useDevice.getState();
  const table = kind === "snaptone" ? d.snapTones : d.userIRs;
  const slotName = table?.find((s) => s.slot === slot)?.name ?? "";
  const rec = await host.tones.link(toneId, { kind, slot, slotName });
  storeRecord(rec);
  patchSend(toneId, { phase: "linked", linkedSlot: slot });
  set({ linkChoice: null });
  notifySuccess(`Linked to ${slotLabel(kind, slot)} on your GP-5`, rec.title);
  return rec;
}

export async function unlink(toneId: number): Promise<void> {
  storeRecord(await host.tones.link(toneId, null));
}

export function closeLinkChoice(): void {
  set({ linkChoice: null });
}

export function openLinkChoice(choice: LinkChoice): void {
  set({ linkChoice: choice });
}
