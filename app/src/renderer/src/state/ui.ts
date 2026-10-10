import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useNav, type Screen } from "./nav";

/*
 * App-wide UI state owned by the shell (src/renderer/src/app): overlays, the command bus, file hand-off,
 * Rig focus requests and status-bar hints.
 *
 * ── Command bus ────────────────────────────────────────────────────────────────────────────────────
 * Menu items, keyboard shortcuts and the command palette all call `runCommand(cmd)`. Screens implement
 * the commands they own with the hook
 *
 *     useCommand("save-to-slot", () => openSaveDialog(), enabled);
 *
 * The most recently registered (still mounted, enabled) handler wins. When no handler is registered,
 * the shell opens the command's home screen (`COMMAND_HOME`) and delivers the command as soon as that
 * screen registers a handler (within 3 s), so "Back up now" from the palette on the Rig opens the
 * Library and starts the backup there. The shell itself handles go-*, command-palette, about and reconnect.
 * Commands that write pedal memory still go through the owner's confirmation dialog.
 *
 * ── Opening files (drag and drop, OS "Open with", second instance) ────────────────────────────────
 *     useFileHandler("prst", (files) => importFiles(files));
 * `files` are `OpenFile`s: `path` is set in Electron, `file` (a browser File) is set when dropped in the
 * web build or in Electron. Same delivery rule as commands: .prst → Library, .nam → capture editor,
 * .wav → Tones, other audio (mp3, flac …) → Song. The Song screen also takes .wav while it is showing (its
 * handler is the most recent one then).
 *
 * ── Rig focus ─────────────────────────────────────────────────────────────────────────────────────
 * `focusRig({ block, picker, fxid })` switches to the Rig and asks it to select block `block` (GP-5 storage
 * index) and, with `picker: true`, open its model picker with `fxid` highlighted. The Rig reads
 * `rigFocus`, acts on it, then calls `clearRigFocus()`. `nonce` changes on every request.
 *
 * ── Preset switching ──────────────────────────────────────────────────────────────────────────────
 * `requestPresetSwitch(slot)` is the only way UI switches presets: with unsaved edits it opens the
 * shell's "Save your changes to …?" AlertDialog instead of switching (overlays.md B).
 *
 * ── Status bar ────────────────────────────────────────────────────────────────────────────────────
 * `useStatusHints([{ keys: ["Mod", "S"], label: "save" }])` replaces the default right-side hints while
 * the calling component is mounted ("Mod" renders as Ctrl or ⌘). `useStatusMessage({ led: "warn", text })`
 * replaces the left-side live/offline message (e.g. during a backup).
 */

export type AppCommand =
  // Rig
  | "undo"
  | "redo"
  | "copy-block"
  | "paste-block"
  | "save-to-slot"
  | "compare-with-saved"
  | "discard-changes"
  | "rename-slot"
  // Library
  | "import-presets"
  | "export-preset"
  | "write-file-to-slot"
  | "backup-pedal"
  // Device
  | "open-backups-folder"
  | "diagnostics-report"
  // Tones
  | "browse-tone3000";

export const COMMAND_HOME: Record<AppCommand, Screen> = {
  undo: "rig",
  redo: "rig",
  "copy-block": "rig",
  "paste-block": "rig",
  "save-to-slot": "rig",
  "compare-with-saved": "rig",
  "discard-changes": "rig",
  "rename-slot": "rig",
  "import-presets": "library",
  "export-preset": "library",
  "write-file-to-slot": "library",
  "backup-pedal": "library",
  "open-backups-folder": "device",
  "diagnostics-report": "device",
  "browse-tone3000": "tones",
};

/** "audio": songs for the Song screen (mp3, flac, m4a, aac, ogg, opus). A .wav is an IR for Tones, unless Song is showing. */
export type FileKind = "prst" | "nam" | "wav" | "audio";
export const FILE_HOME: Record<FileKind, Screen> = { prst: "library", nam: "capture", wav: "tones", audio: "song" };
const SONG_EXTENSIONS = ["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus"];

export interface OpenFile {
  name: string;
  /** Absolute path (Electron); null in the web build */
  path: string | null;
  /** The dropped File, when the file came from a drop */
  file: File | null;
}

export const fileKind = (name: string): FileKind | null => {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "prst" || ext === "nam" || ext === "wav") return ext;
  return ext && SONG_EXTENSIONS.includes(ext) ? "audio" : null;
};

// ── bus internals ──────────────────────────────────────────────────────────────────────────────────
type Key = AppCommand | `open:${FileKind}`;
type Handler = (payload?: unknown) => void | Promise<void>;
const handlers = new Map<Key, Handler[]>();
let pending: { key: Key; payload?: unknown; until: number } | null = null;
const PENDING_MS = 3000;

function register(key: Key, fn: Handler): () => void {
  const list = handlers.get(key) ?? [];
  list.push(fn);
  handlers.set(key, list);
  if (pending && pending.key === key) {
    const p = pending;
    pending = null;
    // Let the screen finish mounting before it opens dialogs.
    if (p.until >= Date.now()) setTimeout(() => void fn(p.payload), 0);
  }
  return () => {
    const l = handlers.get(key);
    const i = l?.lastIndexOf(fn) ?? -1;
    if (l && i >= 0) l.splice(i, 1);
  };
}

function dispatch(key: Key, home: Screen, payload?: unknown): void {
  const list = handlers.get(key);
  const fn = list?.[list.length - 1];
  if (fn) {
    void fn(payload);
    return;
  }
  // Already on the home screen with no handler: the command isn't available right now (e.g. nothing to undo).
  const nav = useNav.getState();
  if (nav.screen === home) return;
  pending = { key, payload, until: Date.now() + PENDING_MS };
  nav.go(home);
}

/** Run a command: the active handler, or the command's home screen once it mounts. */
export function runCommand(cmd: AppCommand): void {
  dispatch(cmd, COMMAND_HOME[cmd]);
}

/** True when a mounted screen currently handles `cmd` (used to label palette items). */
export function hasCommandHandler(cmd: AppCommand): boolean {
  return (handlers.get(cmd)?.length ?? 0) > 0;
}

/** Hand files to their owner (Library for .prst, capture editor for .nam, Tones for .wav, Song for other audio). */
export function openFiles(files: OpenFile[]): { ignored: OpenFile[] } {
  const groups = new Map<FileKind, OpenFile[]>();
  const ignored: OpenFile[] = [];
  for (const f of files) {
    const k = fileKind(f.name);
    if (!k) ignored.push(f);
    else groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  // One screen can be shown at a time: .prst wins, then .nam, then .wav, then songs.
  for (const kind of ["audio", "wav", "nam", "prst"] as const) {
    const g = groups.get(kind);
    if (g) dispatch(`open:${kind}`, FILE_HOME[kind], g);
  }
  return { ignored };
}

/** Implement `cmd` while the calling component is mounted (and `enabled`). */
export function useCommand(cmd: AppCommand, handler: () => void | Promise<void>, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => (enabled ? register(cmd, () => ref.current()) : undefined), [cmd, enabled]);
}

/** Receive files of `kind` opened or dropped anywhere in the app. */
export function useFileHandler(kind: FileKind, handler: (files: OpenFile[]) => void | Promise<void>, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => (enabled ? register(`open:${kind}`, (p) => ref.current(p as OpenFile[])) : undefined), [kind, enabled]);
}

/** Test hook: forget registered handlers and pending deliveries. */
export function resetBusForTests(): void {
  handlers.clear();
  pending = null;
  overrides.hints.length = 0;
  overrides.message.length = 0;
  useUi.setState({ hints: null, message: null });
}

// ── store ──────────────────────────────────────────────────────────────────────────────────────────
export interface StatusHint {
  /** Key caps, e.g. ["Mod", "S"] → "Ctrl S" / "⌘S"; ["F2"] */
  keys: string[];
  label: string;
}

export interface StatusMessage {
  led: "on" | "off" | "warn" | "fault";
  text: string;
}

export interface RigFocus {
  /** GP-5 storage block index (0 NR … 9 NS) */
  block: number;
  /** Open the model picker for this block */
  picker: boolean;
  /** Model to highlight in the picker */
  fxid?: number;
  nonce: number;
}

export interface UiState {
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  aboutOpen: boolean;
  setAboutOpen(open: boolean): void;
  /** Target slot of a preset switch waiting for the unsaved-changes dialog */
  switchTarget: number | null;
  setSwitchTarget(slot: number | null): void;
  rigFocus: RigFocus | null;
  focusRig(req: Omit<RigFocus, "nonce">): void;
  clearRigFocus(): void;
  /** Slots selected this session, newest first (palette "Recent") */
  recentSlots: number[];
  noteRecentSlot(slot: number): void;
  hints: StatusHint[] | null;
  message: StatusMessage | null;
}

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  switchTarget: null,
  setSwitchTarget: (switchTarget) => set({ switchTarget }),
  rigFocus: null,
  focusRig: (req) => {
    set({ rigFocus: { ...req, nonce: (get().rigFocus?.nonce ?? 0) + 1 } });
    useNav.getState().go("rig");
  },
  clearRigFocus: () => set({ rigFocus: null }),
  recentSlots: [],
  noteRecentSlot: (slot) => set({ recentSlots: [slot, ...get().recentSlots.filter((s) => s !== slot)].slice(0, 8) }),
  hints: null,
  message: null,
}));

/**
 * Status-bar overrides form a stack per side: each mounted caller owns one entry (its position is fixed at
 * mount), the newest non-null entry is shown, and unmounting or passing null brings back the previous value.
 */
type Override<K extends "hints" | "message"> = { value: UiState[K] };
const overrides: { hints: Override<"hints">[]; message: Override<"message">[] } = { hints: [], message: [] };

function showTop<K extends "hints" | "message">(field: K): void {
  const stack = overrides[field] as Override<K>[];
  const top = [...stack].reverse().find((e) => e.value !== null);
  useUi.setState({ [field]: top?.value ?? null } as Partial<UiState>);
}

function useStatusOverride<K extends "hints" | "message">(field: K, value: UiState[K]): void {
  const key = JSON.stringify(value);
  const entry = useRef<Override<K>>({ value: null as UiState[K] });
  useEffect(() => {
    const stack = overrides[field] as Override<K>[];
    const e = entry.current;
    stack.push(e);
    return () => {
      stack.splice(stack.indexOf(e), 1);
      showTop(field);
    };
  }, [field]);
  useEffect(() => {
    entry.current.value = JSON.parse(key) as UiState[K];
    showTop(field);
  }, [field, key]);
}

/** Replace the status bar's right-side shortcut hints while mounted (and non-null). */
export function useStatusHints(hints: StatusHint[] | null): void {
  useStatusOverride("hints", hints);
}

/** Replace the status bar's left-side message while mounted and non-null. */
export function useStatusMessage(message: StatusMessage | null): void {
  useStatusOverride("message", message);
}
