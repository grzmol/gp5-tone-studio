// Device layer: one Gp5Session per app (gp5-app-development rules 1–7). Screens use `useDevice`.
import { create } from "zustand";
import { Gp5Session } from "@/gp5/lib/session.mjs";
import { MockGp5 } from "@/gp5/lib/mock-device.mjs";
import { connectWebMidi } from "@/gp5/lib/transport-webmidi.mjs";
import { applyEdits, parsePrst, rebuildPrst, bodyOf } from "@/gp5/lib/prst.mjs";
import { clampParam, modelByFxid } from "@/gp5/lib/catalog.mjs";
import { GLOBALS } from "@/gp5/lib/protocol.mjs";
import { host } from "@/host";
import { GP50_PID, GP5_PID, VALETON_VID, type DeviceHostStatus } from "@shared/host/device";
import { MIDI_LOG_CAP, MidiLogDecoder, RingBuffer } from "./midi-log";
import {
  BLOCK_CODES,
  RestoreError,
  type BackupEntry,
  type BlockState,
  type ConnectionError,
  type ConnectionErrorCode,
  type DeviceMode,
  type DeviceState,
  type GlobalName,
  type MidiLogEntry,
  type ModelInfo,
  type PresetState,
  type SlotName,
} from "./device-types";

export class DeviceError extends Error {
  constructor(
    public code: "not-connected" | "unsaved" | "busy" | "verify" | "timeout" | "unsafe" | "closed" | "length",
    message: string,
  ) {
    super(message);
    this.name = "DeviceError";
  }
}

const NAMES_KEY = "gp5.names.v1";
const LAST_CONNECTED_KEY = "gp5.lastConnected.v1";
const RESYNC_DEBOUNCE_MS = 400;
const MAX_RECONNECTS = 3;
/** While the pedal is missing (desktop only), poll the host's USB list this often and connect when the GP-5 appears. */
const WATCH_MS = 4000;
const LOG_NOTIFY_MS = 120;

// ------------------------------------------------------------------------------------------- pure helpers

export function toModel(fxid: number): ModelInfo | undefined {
  return modelByFxid(fxid) as ModelInfo | undefined;
}

export function toPresetState(slot: number, prst: Uint8Array): PresetState {
  const p = parsePrst(prst);
  const blocks: BlockState[] = p.blocks.map((b: { enabled: boolean; fxid: number; params: number[] }, index: number) => ({
    index,
    code: BLOCK_CODES[index],
    enabled: b.enabled,
    fxid: b.fxid >>> 0,
    model: toModel(b.fxid),
    params: b.params.map((v) => Math.round(v * 1000) / 1000),
  }));
  return {
    slot,
    name: p.name,
    blocks,
    order: p.order,
    volume: p.settings.volume,
    bpm: p.settings.bpm,
    footswitches: { fs1: p.footswitches.fs1, fs2: p.footswitches.fs2 },
    prst,
  };
}

/** Number of user-visible differences (params, on/off, models, order, volume, footswitches). */
export function countChanges(a: PresetState | null, b: PresetState | null): number {
  if (!a || !b) return 0;
  let n = 0;
  for (let k = 0; k < 10; k++) {
    const x = a.blocks[k];
    const y = b.blocks[k];
    if (x.enabled !== y.enabled) n++;
    if (x.fxid !== y.fxid) {
      n++;
      continue;
    }
    for (let i = 0; i < 8; i++) if (Math.abs(x.params[i] - y.params[i]) > 1e-3) n++;
  }
  if (a.order.join() !== b.order.join()) n++;
  if (a.volume !== b.volume) n++;
  if (a.footswitches.fs1.join() !== b.footswitches.fs1.join() || a.footswitches.fs2.join() !== b.footswitches.fs2.join()) n++;
  return n;
}

function loadCachedNames(): SlotName[] {
  try {
    const env = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "null");
    if (env?.v === 1 && Array.isArray(env.names)) return env.names;
  } catch {
    /* corrupt cache: start empty */
  }
  return [];
}
function cacheNames(names: SlotName[]) {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify({ v: 1, names }));
  } catch {
    /* storage full or unavailable: the cache is only an optimisation */
  }
}

const CONNECT_CODES: Record<string, ConnectionErrorCode> = {
  "no-webmidi": "unsupported",
  insecure: "insecure",
  permission: "permission",
  "sysex-denied": "no-sysex",
  "chrome-152": "broken-browser",
  "not-found": "not-found",
};

function toConnectionError(e: unknown, gotBytes: boolean): ConnectionError {
  const err = e as { code?: string; message?: string; visiblePorts?: string[] };
  if (err?.code && CONNECT_CODES[err.code]) return { code: CONNECT_CODES[err.code], message: err.message ?? String(e), ports: err.visiblePorts };
  if (err?.code === "timeout")
    return gotBytes
      ? { code: "timeout", message: "The pedal answered but not like a GP-5. Check the firmware or the device." }
      : { code: "busy", message: "The GP-5 port is open but silent. Close Valeton Suite, then reconnect." };
  if (err?.code === "length") return { code: "unknown", message: err.message ?? "Unexpected reply length (is this a GP-5?)" };
  return { code: "unknown", message: err?.message ?? String(e) };
}

/** The pedal is in firmware update mode: a Valeton (0x84EF) device that is neither a GP-5 nor a GP-50 and no GP-5 present. */
export function inUpdateMode(status: DeviceHostStatus | null): boolean {
  const valeton = status?.usb?.filter((d) => d.vendorId === VALETON_VID) ?? [];
  return !valeton.some((d) => d.productId === GP5_PID) && valeton.some((d) => d.productId !== GP5_PID && d.productId !== GP50_PID);
}

/** True when the host saw the GP-5 (normal mode) on USB. */
export const gp5OnUsb = (status: DeviceHostStatus | null) => !!status?.usb?.some((d) => d.vendorId === VALETON_VID && d.productId === GP5_PID);

/** Use the host's USB view to sharpen a failed connect: no port + a Valeton device in update mode = "bootloader". */
export function refineConnectionError(error: ConnectionError, status: DeviceHostStatus | null): ConnectionError {
  if ((error.code === "not-found" || error.code === "busy" || error.code === "timeout") && inUpdateMode(status))
    return { ...error, code: "bootloader", message: "The pedal is in firmware update mode. The app sends nothing until it restarts normally." };
  return error;
}

function loadLastConnected(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_CONNECTED_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Simulated pedal's user SnapTone (slots 50..57) and IR names, as on the pedal in design/screens/tones.md. */
const MOCK_SNAPTONES = [...new Array<string>(50).fill(""), "GP1000", "ALEXI-1", "ALEXI-2", "GP1000-YT", "PNTR-CWBYS", "PNTR-BRKEN", "PNTR-TGSTK", "Walk"];
const MOCK_USER_IRS = ["A7X-WTF", "A7X-CITY", "V30-4X12-A", "V30-4X12-B"];

/** Mock presets: the bundled 100-slot backup (dev + browser demo). Tests inject their own via `connectWith`. */
async function loadMockPresets(): Promise<Uint8Array[]> {
  const urls = import.meta.glob("../gp5/fixtures/backup/*.prst", { query: "?url", import: "default", eager: true }) as Record<string, string>;
  const files = Object.keys(urls).sort();
  return Promise.all(files.map(async (f) => new Uint8Array(await (await fetch(urls[f])).arrayBuffer())));
}

// ------------------------------------------------------------------------------------------- store

let session: Gp5Session | null = null;
let mock: MockGp5 | null = null;
let reconnects = 0;
let userDisconnected = false;
let resyncTimer: number | undefined;
/** Coalesced live edits: latest value per (block,param) with one send in flight per key. */
const pending = new Map<string, number>();
const inflight = new Set<string>();
/** Pedal settings: latest value per global with one send in flight per name (like dials on the Rig). */
const pendingGlobals = new Map<GlobalName, number>();
const inflightGlobals = new Set<GlobalName>();
/** A connection attempt the user cancelled; checked after every await in connect(). */
let connectAttempt = 0;
let watchTimer: number | undefined;
/** MIDI monitor lines (only filled while the monitor is on). */
const midiLog = new RingBuffer<MidiLogEntry>(MIDI_LOG_CAP);
let logNotifyTimer: number | undefined;

/** Advanced access for diagnostics (Device screen MIDI log); not for screens' normal use. */
export const getSession = () => session;
export const getMock = () => mock;
/** MIDI monitor lines, oldest first (re-read when `midiLogVersion` changes). */
export const getMidiLog = (): MidiLogEntry[] => midiLog.toArray();

export const useDevice = create<DeviceState>((set, get) => {
  const requireSession = () => {
    if (!session || get().status !== "connected") throw new DeviceError("not-connected", "The GP-5 is not connected");
    return session;
  };
  const requireIdle = () => {
    const busy = get().busy;
    if (busy) throw new DeviceError("busy", `Wait until the ${busy.kind} finishes`);
  };
  const guardUnsaved = (what: string) => {
    if (get().unsavedChanges > 0) throw new DeviceError("unsaved", `${what} switches presets on the pedal; save or discard the unsaved changes first`);
  };

  /** Replace the live preset (and optionally the saved copy) and recount changes. */
  const setPreset = (preset: PresetState, saved?: PresetState) => {
    const s = saved ?? get().saved;
    set({ preset, ...(saved ? { saved } : {}), unsavedChanges: countChanges(preset, s) });
  };

  const editLocal = (edits: Record<string, unknown>) => {
    const p = get().preset;
    if (!p) return;
    setPreset(toPresetState(p.slot, applyEdits(p.prst, edits)));
  };

  /** Remember a failed request on a live session (inline error line + diagnostic report). */
  const noteError = (e: unknown) => {
    const err = e as { code?: string; message?: string };
    set({ lastError: { code: err?.code ?? "unknown", message: err?.message ?? String(e), at: Date.now() } });
  };

  const logDecoder = new MidiLogDecoder((block, index) => get().preset?.blocks[block]?.model?.params.find((p) => p.index === index)?.name);
  /** Gp5Session `log` option: records frames only while the monitor is on; the UI re-reads at most every LOG_NOTIFY_MS. */
  const onLog = (dir: string, bytes: Uint8Array, decoded?: unknown) => {
    if (!get().monitor) return;
    const line = logDecoder.line(dir, bytes, decoded);
    if (!line) return;
    midiLog.push(line);
    if (logNotifyTimer === undefined)
      logNotifyTimer = window.setTimeout(() => {
        logNotifyTimer = undefined;
        set({ midiLogVersion: get().midiLogVersion + 1 });
      }, LOG_NOTIFY_MS);
  };
  const newSession = (transport: ConstructorParameters<typeof Gp5Session>[0]) => new Gp5Session(transport, { log: onLog });

  const stopWatch = () => {
    clearInterval(watchTimer);
    watchTimer = undefined;
  };
  /**
   * Desktop only: while the pedal is missing or in update mode, watch the host's USB list and connect once a GP-5
   * (normal mode) appears. Never runs after the user disconnected on purpose, and never talks to an update-mode device.
   */
  const startWatch = () => {
    if (watchTimer !== undefined || host.kind !== "electron") return;
    let seen = gp5OnUsb(get().hostStatus);
    watchTimer = window.setInterval(async () => {
      const st = get();
      if (userDisconnected || st.mode !== "webmidi" || st.status === "connected" || st.status === "connecting") return stopWatch();
      const status = await st.checkHost();
      const now = gp5OnUsb(status);
      if (now && !seen) {
        stopWatch();
        void get().connect("webmidi").catch(() => {});
      }
      seen = now;
    }, WATCH_MS);
  };

  const readActive = async (s: Gp5Session, names = get().names) => {
    const slot: number = await s.readCurrentSlot();
    const body: Uint8Array = await s.readCurrentBody();
    const prst = rebuildPrst(names[slot]?.name ?? "", body, "gp5");
    const state = toPresetState(slot, prst);
    set({ slot });
    setPreset(state, state);
  };

  const scheduleResync = () => {
    clearTimeout(resyncTimer);
    resyncTimer = window.setTimeout(() => {
      resyncTimer = undefined;
      if (session && get().status === "connected" && !get().busy) void readActive(session).catch(() => {});
    }, RESYNC_DEBOUNCE_MS);
  };

  const onUnsolicited = (ev: Event) => {
    const msg = (ev as Event & { message: { type: string; block?: number; index?: number; value?: number; enabled?: boolean; fxid?: number; slot?: number } }).message;
    const p = get().preset;
    if (msg.type === "slot" || msg.type === "presetChanged" || msg.type === "model") return scheduleResync();
    if (!p) return;
    if (msg.type === "param" && msg.block !== undefined && msg.index !== undefined && msg.value !== undefined)
      editLocal({ blocks: { [msg.block]: { params: { [msg.index]: msg.value } } } });
    else if (msg.type === "block" && msg.block !== undefined) editLocal({ blocks: { [msg.block]: { enabled: msg.enabled } } });
  };

  const attach = async (s: Gp5Session, mode: DeviceMode, portName: string) => {
    let gotBytes = false;
    s.addEventListener("message", onUnsolicited);
    s.addEventListener("badframe", () => (gotBytes = true));
    session = s;
    try {
      const snap = await s.syncState();
      gotBytes = true;
      const names: SlotName[] = snap.names.map((n: { slot: number; name: string }) => ({ slot: n.slot, name: n.name }));
      cacheNames(names);
      const state = toPresetState(snap.slot, snap.prst);
      reconnects = 0;
      const { records, ...globals } = snap.globals ?? { records: [] };
      const now = Date.now();
      try {
        localStorage.setItem(LAST_CONNECTED_KEY, String(now));
      } catch {
        /* storage unavailable: "last connected" is informational only */
      }
      set({
        mode,
        status: "connected",
        error: null,
        portName,
        names,
        slot: snap.slot,
        globals: snap.globals ? globals : null,
        globalRecords: snap.globals ? records : null,
        snapTones: null,
        userIRs: null,
        connectedAt: now,
        lastConnectedAt: now,
        disconnectReason: null,
        lastError: null,
      });
      setPreset(state, state);
    } catch (e) {
      session = null;
      await s.close().catch(() => {});
      throw toConnectionError(e, gotBytes);
    }
  };

  const onPortLost = () => {
    const s = session;
    session = null;
    void s?.close().catch(() => {});
    set({ status: "disconnected", portName: null, busy: null, connectedAt: null, disconnectReason: "lost" });
    if (!userDisconnected && get().mode === "webmidi" && reconnects < MAX_RECONNECTS) {
      reconnects++;
      setTimeout(() => void get().connect("webmidi").catch(() => {}), 1000 * reconnects);
    } else startWatch();
  };

  /** Send the latest coalesced value for `key`, then any value queued while it was in flight. */
  const pump = async (key: string, block: number, paramIndex: number) => {
    if (inflight.has(key) || !session) return;
    inflight.add(key);
    try {
      while (pending.has(key) && session) {
        const v = pending.get(key)!;
        pending.delete(key);
        await session.setParam(block, paramIndex, v).catch(noteError);
      }
    } finally {
      inflight.delete(key);
    }
  };

  const pumpGlobal = async (name: GlobalName) => {
    if (inflightGlobals.has(name) || !session) return;
    inflightGlobals.add(name);
    try {
      while (pendingGlobals.has(name) && session) {
        const v = pendingGlobals.get(name)!;
        pendingGlobals.delete(name);
        await session.setGlobal(name, v).catch(noteError);
      }
    } finally {
      inflightGlobals.delete(name);
    }
  };

  return {
    mode: "webmidi",
    status: "idle",
    error: null,
    portName: null,
    names: loadCachedNames(),
    slot: null,
    preset: null,
    saved: null,
    unsavedChanges: 0,
    globals: null,
    snapTones: null,
    userIRs: null,
    busy: null,
    disconnectReason: null,
    connectedAt: null,
    lastConnectedAt: loadLastConnected(),
    globalRecords: null,
    lastError: null,
    hostStatus: null,
    monitor: false,
    midiLogVersion: 0,

    setMonitor(on) {
      set({ monitor: on });
    },

    clearMidiLog() {
      midiLog.clear();
      set({ midiLogVersion: get().midiLogVersion + 1 });
    },

    async checkHost() {
      try {
        const hostStatus = await host.device.status();
        set({ hostStatus });
        return hostStatus;
      } catch {
        return null;
      }
    },

    async cancelConnect() {
      if (get().status !== "connecting") return;
      connectAttempt++;
      userDisconnected = true;
      const s = session;
      session = null;
      mock = null;
      await s?.close().catch(() => {});
      set({ status: "disconnected", error: null, portName: null, disconnectReason: "user" });
    },

    clearLastError() {
      set({ lastError: null });
    },

    async connect(mode = get().mode) {
      if (get().status === "connecting") return;
      stopWatch();
      userDisconnected = false;
      if (session) await get().disconnect();
      userDisconnected = false;
      const attempt = ++connectAttempt;
      const cancelled = () => attempt !== connectAttempt;
      set({ mode, status: "connecting", error: null });
      // OS-side checks (USB, driver, Suite) run alongside; they sharpen errors and feed the Diagnostics card.
      const hostCheck = mode === "webmidi" ? get().checkHost() : Promise.resolve(null);
      try {
        if (mode === "mock") {
          const presets = await loadMockPresets();
          if (cancelled()) return;
          mock = new MockGp5({ presets, latencyMs: 2, snapTones: MOCK_SNAPTONES, userIRs: MOCK_USER_IRS });
          await attach(newSession(mock.transport()), "mock", "GP-5 (simulated)");
        } else {
          const settings = await host.app.getSettings().catch(() => null);
          const port = settings?.portPattern ? settings.portPattern : undefined;
          const transport = await connectWebMidi({ ...(port ? { port } : {}), onDisconnect: onPortLost });
          if (cancelled()) {
            await transport.close();
            return;
          }
          await attach(newSession(transport), "webmidi", transport.name);
        }
      } catch (e) {
        if (cancelled()) return;
        // attach() throws a ConnectionError; connectWebMidi throws a Gp5ConnectError (an Error) that still needs mapping.
        const base = e instanceof Error ? toConnectionError(e, false) : (e as ConnectionError);
        const error = refineConnectionError(base, await hostCheck);
        set({ status: "error", error });
        if (mode === "webmidi" && (error.code === "not-found" || error.code === "bootloader")) startWatch();
        throw e;
      }
    },

    async disconnect() {
      userDisconnected = true;
      stopWatch();
      const s = session;
      session = null;
      mock = null;
      pending.clear();
      pendingGlobals.clear();
      await s?.close().catch(() => {});
      set({ status: "disconnected", portName: null, busy: null, connectedAt: null, disconnectReason: "user" });
    },

    async sync() {
      const s = requireSession();
      requireIdle();
      set({ busy: { kind: "sync", progress: 0, label: "Reading the pedal" } });
      try {
        const names: SlotName[] = (await s.readPresetNames()).map((n: { slot: number; name: string }) => ({ slot: n.slot, name: n.name }));
        cacheNames(names);
        set({ names });
        await readActive(s, names);
        const raw = await s.readGlobals().catch(() => null);
        if (raw) {
          const { records, ...globals } = raw;
          set({ globals, globalRecords: records });
        }
        set({ lastError: null });
      } catch (e) {
        noteError(e);
        throw e;
      } finally {
        set({ busy: null });
      }
    },

    async selectSlot(slot) {
      const s = requireSession();
      requireIdle();
      pending.clear();
      await s.selectPreset(slot);
      await readActive(s);
    },

    setParam(block, paramIndex, value) {
      const p = get().preset;
      if (!p) return;
      const info = p.blocks[block]?.model?.params.find((x) => x.index === paramIndex);
      const v = info ? (clampParam(info, value) as number) : value;
      editLocal({ blocks: { [block]: { params: { [paramIndex]: v } } } });
      if (!session || get().status !== "connected") return;
      const key = `${block}:${paramIndex}`;
      pending.set(key, v);
      void pump(key, block, paramIndex);
    },

    setBlockEnabled(block, on) {
      editLocal({ blocks: { [block]: { enabled: on } } });
      if (session && get().status === "connected") void session.setBlockEnabled(block, on).catch(() => {});
    },

    async setModel(block, fxid) {
      const s = requireSession();
      await s.setModel(block, fxid);
      const p = get().preset!;
      // The pedal loads the model's defaults: re-read the active buffer, keep `saved` as it was.
      const body: Uint8Array = await s.readCurrentBody();
      setPreset(toPresetState(p.slot, rebuildPrst(p.name, body, "gp5")));
    },

    // Order and footswitch assignments have no live command: they change the preset and reach the pedal on save.
    setOrder(order) {
      editLocal({ order });
    },
    setFootswitches(fs) {
      editLocal({ footswitches: fs });
    },

    setVolume(volume) {
      editLocal({ volume });
      if (session && get().status === "connected") void session.setPatchVolume(volume).catch(() => {});
    },

    async discard() {
      const s = requireSession();
      requireIdle();
      const slot = get().slot!;
      pending.clear();
      // Re-selecting the active slot does not reload flash: hop away and back.
      await s.selectPreset((slot + 1) % 100);
      await s.selectPreset(slot);
      await readActive(s);
    },

    async saveToSlot(slot, name) {
      const p = get().preset;
      if (!p) throw new DeviceError("not-connected", "No preset loaded");
      const prst = name !== undefined && name !== p.name ? applyEdits(p.prst, { name }) : p.prst;
      // A full write keeps everything (order and footswitches have no live command, so the edit buffer alone is not enough).
      await get().writePreset(slot, prst);
    },

    async rename(slot, name) {
      const s = requireSession();
      requireIdle();
      await s.renamePreset(slot, name, { confirm: true });
      const names = get().names.map((n) => (n.slot === slot ? { ...n, name } : n));
      cacheNames(names);
      set({ names });
      const { preset, saved } = get();
      if (preset?.slot === slot && saved) {
        const rename = (x: PresetState) => toPresetState(slot, applyEdits(x.prst, { name }));
        setPreset(rename(preset), rename(saved));
      }
    },

    async writePreset(slot, prst, opts) {
      const s = requireSession();
      requireIdle();
      set({ busy: { kind: "write", progress: 0, label: `Writing slot ${slot}` } });
      try {
        await s.writePreset(slot, prst, {
          confirm: true,
          onProgress: (done: number, total: number) => {
            const f = done / total;
            set({ busy: { kind: "write", progress: f, label: `Writing slot ${slot}` } });
            opts?.onProgress?.(f);
          },
        });
        const written = toPresetState(slot, prst);
        const names = get().names.map((n) => (n.slot === slot ? { ...n, name: written.name } : n));
        cacheNames(names);
        // writePreset verifies by selecting `slot`, so it is now the active preset.
        set({ names, slot });
        setPreset(written, written);
      } finally {
        set({ busy: null });
      }
    },

    async readPreset(slot) {
      const s = requireSession();
      const p = get().preset;
      if (p && p.slot === slot) return p.prst;
      requireIdle();
      guardUnsaved("Reading another slot");
      const original = get().slot;
      const prst: Uint8Array = await s.readPreset(slot, { names: get().names });
      if (original !== null) {
        await s.selectPreset(original);
        await readActive(s);
      }
      return prst;
    },

    async backupAll(opts) {
      const s = requireSession();
      requireIdle();
      guardUnsaved("A backup");
      set({ busy: { kind: "backup", progress: 0, label: "Backing up 100 slots" } });
      try {
        const entries: BackupEntry[] = await s.backupAll({
          onProgress: (done: number, total: number) => {
            const f = done / total;
            set({ busy: { kind: "backup", progress: f, label: `Backing up slot ${done} of ${total}` } });
            opts?.onProgress?.(f);
          },
        });
        await readActive(s);
        return entries.map((e) => ({ slot: e.slot, name: e.name, prst: e.prst }));
      } finally {
        set({ busy: null });
      }
    },

    setGlobal(name, value) {
      requireSession();
      const g = GLOBALS[name];
      const v = Math.max(g.min, Math.min(g.max, Math.round(value)));
      set({ globals: { ...(get().globals ?? {}), [name]: v } });
      pendingGlobals.set(name, v);
      void pumpGlobal(name);
    },

    async readSnapTones() {
      const s = requireSession();
      const list: SlotName[] = (await s.readSnapTones()).map((x) => ({ slot: x.index, name: x.name, kind: x.kind }));
      set({ snapTones: list });
      return list;
    },

    async uploadSnapTone(slot, name, file, opts) {
      const s = requireSession();
      requireIdle();
      const label = `Writing SnapTone slot ${slot}`;
      set({ busy: { kind: "snaptone", progress: 0, label } });
      try {
        const result = await s.uploadSnapTone(slot, name, file, {
          confirm: true,
          onProgress: (done: number, total: number) => {
            set({ busy: { kind: "snaptone", progress: done / total, label } });
            opts?.onProgress?.(done / total);
          },
        });
        await get().readSnapTones();
        return result.name;
      } catch (e) {
        noteError(e);
        throw e;
      } finally {
        set({ busy: null });
      }
    },

    async readUserIRs() {
      const s = requireSession();
      const list: SlotName[] = (await s.readUserIRs()).map((x) => ({ slot: x.index, name: x.name, kind: x.kind }));
      set({ userIRs: list });
      return list;
    },

    async restoreAll(entries, opts) {
      const s = requireSession();
      requireIdle();
      guardUnsaved("A restore");
      const slots = entries.map((e) => e.slot);
      const done: number[] = [];
      const total = entries.length;
      const label = (i: number) => `Restoring slot ${entries[i].slot} (${i + 1} of ${total})`;
      set({ busy: { kind: "restore", progress: 0, label: total ? label(0) : "Restoring" } });
      try {
        for (let i = 0; i < total; i++) {
          if (opts?.signal?.aborted) throw new RestoreError("Restore cancelled", done, null, slots.slice(i));
          const { slot, prst } = entries[i];
          set({ busy: { kind: "restore", progress: i / total, label: label(i) } });
          try {
            await s.writePreset(slot, prst, {
              confirm: true,
              verify: true,
              attempts: 3,
              onProgress: (f: number, n: number) => set({ busy: { kind: "restore", progress: (i + f / n) / total, label: label(i) } }),
            });
          } catch (e) {
            noteError(e);
            throw new RestoreError(`Slot ${slot} failed: ${(e as Error)?.message ?? e}`, done, slot, slots.slice(i + 1), e);
          }
          done.push(slot);
          opts?.onProgress?.(done.length, total, slot);
        }
      } finally {
        // Names changed on the pedal: refresh them and the active preset, whatever happened.
        if (session === s) {
          const names: SlotName[] | null = await s
            .readPresetNames()
            .then((list) => list.map((n) => ({ slot: n.slot, name: n.name })))
            .catch(() => null);
          if (names) {
            cacheNames(names);
            set({ names });
          }
          await readActive(s).catch(noteError);
        }
        set({ busy: null });
      }
    },
  };
});

/** Body bytes of a .prst, for components that compare against device reads. */
export { bodyOf };
