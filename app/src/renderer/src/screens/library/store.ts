// Library screen state: local collections, the known body of each pedal slot, and the slot selection.
import { create } from "zustand";
import { host } from "@/host";
import type { BackupEntry } from "@/state/device-types";
import type { CollectionInfo, LocalPreset } from "@shared/host/files";

/** What the app knows about a slot's preset body (names come from the pedal; bodies only from backups or reads). */
export interface SlotBody {
  prst: Uint8Array;
  from: "backup" | "pedal";
  /** ISO time of the backup or read */
  at: string;
}

export type SlotFilter = "all" | "used" | "empty";

export type LibraryDrag = { kind: "local"; preset: LocalPreset } | { kind: "slots"; slots: number[] };

export interface LibraryState {
  collections: CollectionInfo[];
  collectionsLoaded: boolean;
  /** Collection shown in the left column */
  currentId: string | null;
  presets: LocalPreset[];
  presetsLoading: boolean;
  localQuery: string;
  /** Local preset shown in the inspector (instead of the slot selection) */
  localSelected: string | null;

  bodies: Record<number, SlotBody>;
  /** Slots selected in the GP-5 list, ascending */
  selected: number[];
  anchor: number | null;
  focus: number | null;
  slotFilter: SlotFilter;
  slotQuery: string;
  backupStartedAt: number | null;
  /** A library job reading slots (export, add to collection), shown in the page head */
  job: { label: string; progress: number } | null;
  /** What is being dragged inside the app (dataTransfer can't be read during dragover) */
  drag: LibraryDrag | null;
  /** Details sheet below 1400px */
  sheetOpen: boolean;
  /** Slot whose name is being edited in the inspector */
  renaming: number | null;

  refreshCollections(): Promise<void>;
  openCollection(id: string): Promise<void>;
  reloadPresets(): Promise<void>;
  setBody(slot: number, prst: Uint8Array, from: SlotBody["from"]): void;
  noteBackup(info: CollectionInfo, entries: BackupEntry[]): void;
  select(slots: number[], opts?: { anchor?: number | null; focus?: number | null }): void;
  selectLocal(id: string | null): void;
}

export const isEmptyName = (name: string | undefined) => !name || name.trim() === "GP-5";

/** Load bodies from the newest backup once, so chains show without stepping through presets on the pedal. */
async function loadNewestBackup(collections: CollectionInfo[]): Promise<Record<number, SlotBody>> {
  const newest = collections.find((c) => c.kind === "backup");
  if (!newest) return {};
  const presets = await host.files.listPresets(newest.id);
  const out: Record<number, SlotBody> = {};
  for (const p of presets) if (p.slot !== null) out[p.slot] = { prst: p.prst, from: "backup", at: newest.createdAt };
  return out;
}

let presetsToken = 0;

export const useLibrary = create<LibraryState>((set, get) => ({
  collections: [],
  collectionsLoaded: false,
  currentId: null,
  presets: [],
  presetsLoading: false,
  localQuery: "",
  localSelected: null,
  bodies: {},
  selected: [],
  anchor: null,
  focus: null,
  slotFilter: "all",
  slotQuery: "",
  backupStartedAt: null,
  job: null,
  drag: null,
  sheetOpen: false,
  renaming: null,

  async refreshCollections() {
    const collections = await host.files.listCollections();
    const first = !get().collectionsLoaded;
    set({ collections, collectionsLoaded: true });
    if (first) {
      const fromBackup = await loadNewestBackup(collections).catch(() => ({}));
      // Pedal reads made meanwhile win over the backup.
      set({ bodies: { ...fromBackup, ...get().bodies } });
    }
    const current = get().currentId;
    if (!current || !collections.some((c) => c.id === current)) {
      const next = collections.find((c) => c.kind === "imported") ?? collections[0];
      if (next) await get().openCollection(next.id);
      else set({ currentId: null, presets: [] });
    }
  },

  async openCollection(id) {
    set({ currentId: id, localQuery: "", localSelected: null });
    await get().reloadPresets();
  },

  async reloadPresets() {
    const id = get().currentId;
    if (!id) return;
    const token = ++presetsToken;
    set({ presetsLoading: true });
    try {
      const presets = await host.files.listPresets(id);
      if (token === presetsToken) set({ presets });
    } finally {
      if (token === presetsToken) set({ presetsLoading: false });
    }
  },

  setBody(slot, prst, from) {
    set({ bodies: { ...get().bodies, [slot]: { prst, from, at: new Date().toISOString() } } });
  },

  noteBackup(info, entries) {
    const bodies = { ...get().bodies };
    for (const e of entries) bodies[e.slot] = { prst: e.prst, from: "backup", at: info.createdAt };
    set({ bodies });
  },

  select(slots, opts) {
    const selected = [...new Set(slots)].sort((a, b) => a - b);
    set({
      selected,
      localSelected: null,
      ...(opts && "anchor" in opts ? { anchor: opts.anchor ?? null } : {}),
      ...(opts && "focus" in opts ? { focus: opts.focus ?? null } : {}),
    });
  },

  selectLocal(id) {
    set({ localSelected: id });
  },
}));
