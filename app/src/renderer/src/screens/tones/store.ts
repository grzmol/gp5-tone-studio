import { useEffect } from "react";
import { create } from "zustand";
import type { AccountState, FlowRequest, SendResult, T3kTone, ToneListKind, ToneRecord } from "@shared/host/tones";
import { HostError } from "@shared/ipc";
import { changedSlots, firstEmptySlot } from "@shared/tone3000";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import { notifySuccess } from "@/app/notify";
import type { DeviceMode, SlotName } from "@/state/device-types";
import type { PresetRef } from "./usage";

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

export type SendPhase = "idle" | "running" | "ready" | "suite" | "linking" | "linked" | "error";

export interface SendState {
  toneId: number;
  modelId: number;
  name: string;
  kind: "snaptone" | "ir";
  phase: SendPhase;
  /** 1 download, 2 check, 3 save, 4 Suite, 5 link */
  step: 1 | 2 | 3 | 4 | 5;
  received: number;
  total: number | null;
  error: string | null;
  result: SendResult | null;
  proposedSlot: number | null;
  /** Suite launch could be watched (process exit is reported) */
  watched: boolean;
  linkedSlot: number | null;
  /** Edited .nam text from the capture editor, used instead of the download */
  text: string | null;
}

/**
 * Link dialog: after Suite, pick which slot holds the tone ("slot"; candidates = slots that changed, empty
 * when none was detected), or from a slot's context menu, pick which downloaded tone it holds ("tone").
 */
export type LinkChoice =
  | { mode: "slot"; toneId: number; kind: "snaptone" | "ir"; candidates: number[] }
  | { mode: "tone"; kind: "snaptone" | "ir"; slot: number };

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
  suiteRunning: boolean;
  send: Record<number, SendState>;
  linkChoice: LinkChoice | null;
  /** Mode to reconnect in after Valeton Suite */
  pausedMode: DeviceMode | null;
}

const empty = (): ListState => ({ tones: [], page: 0, totalPages: 1, total: 0, fetchedAt: 0, loading: false, error: null, loaded: false });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useTones = create<TonesState>(() => ({
  account: null,
  tab: "favorited",
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
  suiteRunning: false,
  send: {},
  linkChoice: null,
  pausedMode: null,
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
    set({ account: { status: "signed-out", user: null, configured: false, splashSeen: true } });
    console.warn("TONE3000 account", e);
  }
}

let recordsLoad: Promise<void> | null = null;
export function loadRecords(): Promise<void> {
  recordsLoad = host.tones
    .local()
    .catch(() => [])
    .then((list) => set({ records: Object.fromEntries(list.map((r) => [r.tone_id, r])) }));
  return recordsLoad;
}

/**
 * The TONE3000 tone linked to a pedal slot (Rig's NS/CAB blocks show its image, title, creator: TONE3000
 * requirement 5). Undefined when the slot isn't linked. Loads the local records once.
 */
export function useLinkedTone(kind: "snaptone" | "ir", slot: number | null): ToneRecord | undefined {
  useEffect(() => {
    if (!recordsLoad) void loadRecords();
  }, []);
  return useTones((s) =>
    slot === null ? undefined : Object.values(s.records).find((r) => (kind === "snaptone" ? r.gp5.snaptoneSlot === slot : r.gp5.irSlot === slot)),
  );
}

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

/** "Browse TONE3000": splash first (once), then the Select flow scoped to what the GP-5 can load. */
export async function browse(req: FlowRequest = { prompt: "select_tone", architecture: "1" }): Promise<void> {
  if (!get().account) await loadAccount();
  const account = get().account;
  set({ flow: req });
  if (!account?.splashSeen) set({ splashOpen: true });
  else set({ flowOpen: true });
}

/**
 * Entry point from a signal block (TONE3000 requirement 1): Rig › NS "Browse TONE3000 captures" or
 * Rig › CAB "Browse TONE3000 IRs". Opens Tones with the Select flow scoped to what that block can load.
 */
export function browseForBlock(kind: "capture" | "ir"): void {
  useNav.getState().go("tones");
  void browse(
    kind === "capture"
      ? { prompt: "select_tone", format: "nam", architecture: "1", gears: "amp_amp-cab_pedal" }
      : { prompt: "select_tone", format: "ir", gears: "cab" },
  );
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
    detectPendingLinks();
  } catch (e) {
    set({ slotsError: message(e) });
  }
}

/** On each slot read, link pending hand-offs whose new slot is unambiguous (stale links show in the slot map). */
function detectPendingLinks(): void {
  const d = useDevice.getState();
  for (const r of Object.values(get().records)) {
    if (r.gp5.pending && r.gp5.pending.before) void detectSent(r.tone_id, d.snapTones, d.userIRs, true);
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
 * the hand-off file is made from it instead of the TONE3000 download.
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
        error: null,
        result: null,
        proposedSlot: firstEmptySlot(kind, kind === "snaptone" ? d.snapTones : d.userIRs),
        watched: false,
        linkedSlot: null,
        text: opts.text ?? null,
      },
    },
  }));
}

export function updateDraft(toneId: number, patch: Partial<Pick<SendState, "modelId" | "name">>): void {
  patchSend(toneId, patch);
}

export function cancelSend(toneId: number): void {
  const s = get().send[toneId];
  if (s?.result) void host.tones.setPending(toneId, null).then(storeRecord).catch(() => {});
  set((st) => {
    const next = { ...st.send };
    delete next[toneId];
    return { send: next };
  });
}

/** Steps 1–3 in main: download, check (+ reshape), save to the hand-off folder. */
export async function runSend(toneId: number): Promise<void> {
  const s = get().send[toneId];
  if (!s) return;
  patchSend(toneId, { phase: "running", step: 1, error: null, received: 0, total: null });
  try {
    const result = await host.tones.prepareForSuite({ toneId, modelId: s.modelId, name: s.name, text: s.text ?? undefined });
    storeRecord(result.record);
    patchSend(toneId, { phase: "ready", step: 4, result });
  } catch (e) {
    if (onUnauthorized(e)) patchSend(toneId, { phase: "error", error: "Your TONE3000 sign-in expired. Sign in again, then retry." });
    else patchSend(toneId, { phase: "error", error: message(e) });
  }
}

/** Progress events from main move the stepper. */
export function onSendProgress(toneId: number, step: "download" | "check" | "save", received: number, total: number | null): void {
  const s = get().send[toneId];
  if (!s || s.phase !== "running") return;
  patchSend(toneId, { step: step === "download" ? 1 : step === "check" ? 2 : 3, received, total });
}

/**
 * Step 4: remember the slot table, let go of the USB port (Suite needs it exclusively on Windows),
 * then launch Suite. Nothing is written to the pedal by Tone Studio.
 */
export async function openSuite(toneId: number): Promise<void> {
  const s = get().send[toneId];
  if (!s?.result) return;
  const d = useDevice.getState();
  let table: SlotName[] | null = s.kind === "snaptone" ? d.snapTones : d.userIRs;
  if (d.status === "connected" && !table) table = await (s.kind === "snaptone" ? d.readSnapTones() : d.readUserIRs()).catch(() => null);
  const before = table ? slotNames(table, s.kind === "snaptone" ? 80 : 20) : null;
  const rec = await host.tones.setPending(toneId, {
    kind: s.kind,
    fileName: s.result.fileName,
    path: s.result.path,
    proposedSlot: s.proposedSlot,
    before,
    at: new Date().toISOString(),
  });
  storeRecord(rec);
  const launch = await host.tones.openSuite();
  if (d.status === "connected") {
    set({ pausedMode: d.mode });
    await d.disconnect();
  }
  patchSend(toneId, { phase: "suite", step: 5, watched: launch.watched });
}

function slotNames(table: SlotName[], count: number): string[] {
  const out = Array<string>(count).fill("");
  for (const s of table) if (s.slot < count) out[s.slot] = s.name;
  return out;
}

/** Suite exited (or the user says it's done): reconnect, read the slot table, link the new slot. */
export async function finishSuite(toneId?: number): Promise<void> {
  set({ suiteRunning: false });
  const d = useDevice.getState();
  if (d.status !== "connected") {
    try {
      await d.connect(get().pausedMode ?? d.mode);
    } catch {
      /* the device chip reports connection problems; the link step waits for the pedal */
    }
  }
  set({ pausedMode: null });
  const now = useDevice.getState();
  if (now.status !== "connected") return;
  const snap = await now.readSnapTones().catch(() => null);
  const irs = await now.readUserIRs().catch(() => null);
  set({ slotsReadAt: Date.now() });
  const ids = toneId !== undefined ? [toneId] : Object.values(get().records).filter((r) => r.gp5.pending).map((r) => r.tone_id);
  for (const id of ids) await detectSent(id, snap, irs, false);
}

/** Diff the slot table against the one read before Suite opened. One change links; otherwise ask. */
async function detectSent(toneId: number, snap: SlotName[] | null, irs: SlotName[] | null, quiet: boolean): Promise<void> {
  const rec = get().records[toneId];
  const pending = rec?.gp5.pending;
  if (!pending) return;
  const table = pending.kind === "snaptone" ? snap : irs;
  if (!table) return;
  const changed = pending.before ? changedSlots(pending.before, table, pending.kind === "snaptone" ? [50, 79] : [0, 19]) : [];
  if (changed.length === 1) {
    await linkSlot(toneId, pending.kind, changed[0]);
    return;
  }
  if (!quiet) set({ linkChoice: { mode: "slot", toneId, kind: pending.kind, candidates: changed } });
}

export async function linkSlot(toneId: number, kind: "snaptone" | "ir", slot: number): Promise<ToneRecord> {
  const d = useDevice.getState();
  const table = kind === "snaptone" ? d.snapTones : d.userIRs;
  const slotName = table?.find((s) => s.slot === slot)?.name ?? "";
  const rec = await host.tones.link(toneId, { kind, slot, slotName });
  storeRecord(rec);
  patchSend(toneId, { phase: "linked", linkedSlot: slot });
  set({ linkChoice: null });
  notifySuccess(`Linked to ${kind === "snaptone" ? "SnapTone" : "User IR"} slot ${slot} on your GP-5`, rec.title);
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
