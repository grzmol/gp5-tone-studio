// Capture editor state: the open capture, its versions, the working draft (undo/redo) and audition choices.
import { create } from "zustand";
import type { CaptureKey, CaptureRecipe, CaptureSource, CaptureState, CaptureVersion } from "@shared/host/capture";
import { HostError } from "@shared/ipc";
import { host } from "@/host";
import { inspectNam, parseNam, serializeNam, type NamFile, type NamInfo } from "./nam/model";
import { applyRecipe, originalRecipe, recipesEqual, summarize } from "./nam/recipe";
import type { ClipId } from "./audio/engine";

export type EditTab = "info" | "level" | "size" | "shape";
export type AuditionSource = ClipId | "live";

interface Loaded {
  key: CaptureKey;
  source: CaptureSource;
  file: NamFile;
  info: NamInfo;
  versions: CaptureVersion[];
}

export interface CaptureEditorState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** What the loading state is doing ("Downloading … from TONE3000"), null = opening */
  progress: string | null;
  /** The ref the screen asked for (nav param) */
  ref: string | null;
  loaded: Loaded | null;
  /** Version the working recipe started from (0 = original) */
  base: number;
  recipe: CaptureRecipe | null;
  past: CaptureRecipe[];
  future: CaptureRecipe[];
  /** Version shown read-only, null = the working state */
  viewing: number | null;
  /** Last version this session saved, for "Saved as version N" */
  savedN: number | null;
  saving: boolean;
  tab: EditTab;
  choice: string;
  source: AuditionSource;
  levelMatched: boolean;

  open(ref: string, modelId?: number | null): Promise<void>;
  edit(change: (r: CaptureRecipe) => CaptureRecipe, group?: string): void;
  undo(): void;
  redo(): void;
  /** Close the draft as the next version (no-op when nothing changed). */
  saveVersion(): Promise<CaptureVersion | null>;
  restore(n: number): Promise<void>;
  deleteVersion(n: number): Promise<void>;
  view(n: number | null): void;
  set(patch: Partial<Pick<CaptureEditorState, "tab" | "choice" | "source" | "levelMatched">>): void;
  reset(): void;
}

/** Recipe of version `n` (0 = original). */
export function recipeOf(loaded: Loaded, n: number): CaptureRecipe {
  if (n === 0) return originalRecipe(loaded.file);
  return loaded.versions.find((v) => v.n === n)?.recipe ?? originalRecipe(loaded.file);
}

/** The lossless file of a recipe, as text (what "Export A2 .nam" and each version's export write). */
export function exportText(loaded: Loaded, recipe: CaptureRecipe): string {
  return serializeNam(applyRecipe(loaded.file, recipe, loaded.info));
}

const DRAFT_DELAY_MS = 600;
const GROUP_MS = 800;
let draftTimer: number | undefined;
let lastGroup: { group: string; at: number } | null = null;

const IDLE = {
  status: "idle" as const,
  error: null,
  progress: null,
  ref: null,
  loaded: null,
  base: 0,
  recipe: null,
  past: [],
  future: [],
  viewing: null,
  savedN: null,
  saving: false,
};

/**
 * Open a capture. A TONE3000 tone without a downloaded model gets one first (Tones downloads it into the
 * tone's folder): the requested model, else the A2 model, else the A1 model.
 */
async function openOrDownload(ref: string, modelId: number | null | undefined, onProgress: (text: string) => void): Promise<CaptureState> {
  try {
    return await host.capture.open(ref, modelId);
  } catch (e) {
    if (!(e instanceof HostError && e.code === "not-found" && /^\d+$/.test(ref))) throw e;
    const toneId = Number(ref);
    const models = await host.tones.models(toneId);
    const pick =
      models.find((m) => m.id === modelId) ?? models.find((m) => m.architecture_version === "2") ?? models.find((m) => m.architecture_version === "1");
    if (!pick) throw new Error("This tone has no NAM model that can be edited.");
    onProgress(`Downloading “${pick.name}” from TONE3000`);
    await host.tones.downloadModel(toneId, pick.id);
    return host.capture.open(ref, pick.id);
  }
}

export const useCapture = create<CaptureEditorState>((set, get) => {
  /** Autosave the working state as the draft (cleared when it equals its base version). */
  const scheduleDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      draftTimer = undefined;
      const { loaded, recipe, base } = get();
      if (!loaded || !recipe) return;
      const clean = recipesEqual(recipe, recipeOf(loaded, base));
      void host.capture.saveDraft(loaded.key, clean ? null : { from: base, recipe, savedAt: new Date().toISOString() }).catch(() => {});
    }, DRAFT_DELAY_MS);
  };

  const commitVersion = async (recipe: CaptureRecipe, prev: CaptureRecipe, restoredFrom?: number) => {
    const loaded = get().loaded!;
    const startRecipe = get().recipe;
    set({ saving: true });
    try {
      clearTimeout(draftTimer);
      draftTimer = undefined;
      const summary = restoredFrom ? `Restored version ${restoredFrom}` : summarize(prev, recipe);
      const version = await host.capture.saveVersion(loaded.key, { recipe, summary, restoredFrom, file: exportText(loaded, recipe) });
      const cur = get();
      // The screen moved to another capture while saving: the version is stored, nothing to update here.
      if (!cur.loaded || cur.loaded.key.ref !== loaded.key.ref || cur.loaded.source.sha256 !== loaded.source.sha256) return version;
      // Edits made while saving stay as the draft on top of the new version.
      const editedMeanwhile = !!cur.recipe && !!startRecipe && !recipesEqual(cur.recipe, startRecipe);
      set({
        loaded: { ...cur.loaded, versions: [...cur.loaded.versions, version] },
        base: version.n,
        recipe: editedMeanwhile ? cur.recipe : recipe,
        past: editedMeanwhile ? cur.past : [],
        future: editedMeanwhile ? cur.future : [],
        viewing: null,
        savedN: version.n,
        saving: false,
      });
      if (editedMeanwhile) scheduleDraft();
      return version;
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  };

  return {
    ...IDLE,
    tab: "info",
    choice: "full",
    source: "di-guitar",
    levelMatched: true,

    open: async (ref, modelId) => {
      set({ ...IDLE, status: "loading", ref });
      try {
        const state = await openOrDownload(ref, modelId, (progress) => get().ref === ref && set({ progress }));
        if (get().ref !== ref) return;
        const file = parseNam(state.source.text);
        const info = inspectNam(file);
        const loaded: Loaded = { key: { ref: state.source.ref, modelId: state.source.modelId }, source: state.source, file, info, versions: state.versions };
        const latest = state.versions.at(-1)?.n ?? 0;
        const draftBase = state.draft && (state.draft.from === 0 || state.versions.some((v) => v.n === state.draft!.from)) ? state.draft : null;
        const base = draftBase ? draftBase.from : latest;
        const recipe = draftBase ? draftBase.recipe : recipeOf(loaded, base);
        set({
          status: "ready",
          progress: null,
          loaded,
          base,
          recipe,
          choice: info.arch.kind === "A2" ? "full" : "a1",
          tab: get().tab === "size" && info.arch.kind !== "A2" ? "info" : get().tab,
        });
      } catch (e) {
        if (get().ref !== ref) return;
        set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },

    edit: (change, group) => {
      const { recipe, viewing, past } = get();
      if (!recipe || viewing !== null) return;
      const next = change(recipe);
      if (recipesEqual(next, recipe)) return;
      const now = Date.now();
      // Continuous gestures (dial drags, typing) are one undo step.
      const coalesce = group && lastGroup?.group === group && now - lastGroup.at < GROUP_MS;
      lastGroup = group ? { group, at: now } : null;
      set({ recipe: next, past: coalesce ? past : [...past, recipe].slice(-200), future: [], savedN: null });
      scheduleDraft();
    },

    undo: () => {
      const { past, recipe, future } = get();
      if (!past.length || !recipe) return;
      lastGroup = null;
      set({ recipe: past[past.length - 1], past: past.slice(0, -1), future: [recipe, ...future] });
      scheduleDraft();
    },

    redo: () => {
      const { past, recipe, future } = get();
      if (!future.length || !recipe) return;
      lastGroup = null;
      set({ recipe: future[0], past: [...past, recipe], future: future.slice(1) });
      scheduleDraft();
    },

    saveVersion: async () => {
      const { loaded, recipe, base, saving } = get();
      if (!loaded || !recipe || saving) return null;
      const prev = recipeOf(loaded, base);
      if (recipesEqual(recipe, prev)) return null;
      return commitVersion(recipe, prev);
    },

    restore: async (n) => {
      const { loaded } = get();
      if (!loaded) return;
      await get().saveVersion(); // the open draft becomes its own version first; nothing is lost
      const target = recipeOf(loaded, n);
      await commitVersion(target, get().recipe ?? target, n);
    },

    deleteVersion: async (n) => {
      const { loaded, base } = get();
      if (!loaded || n < 1) return;
      await host.capture.deleteVersion(loaded.key, n);
      const versions = loaded.versions.filter((v) => v.n !== n);
      const next = { ...loaded, versions };
      // The working draft keeps its recipe; it now counts as changes on top of the latest remaining version.
      set({ loaded: next, viewing: get().viewing === n ? null : get().viewing, base: base === n ? (versions.at(-1)?.n ?? 0) : base });
      scheduleDraft();
    },

    view: (n) => set({ viewing: n }),
    set: (patch) => set(patch),
    reset: () => {
      clearTimeout(draftTimer);
      draftTimer = undefined;
      lastGroup = null;
      set({ ...IDLE });
    },
  };
});

/** The recipe on screen: the viewed version (read-only) or the working one. */
export function useShownRecipe(): CaptureRecipe | null {
  return useCapture((s) => (s.loaded && s.viewing !== null ? recipeOf(s.loaded, s.viewing) : s.recipe));
}

export const isDirty = (s: CaptureEditorState) => !!s.loaded && !!s.recipe && !recipesEqual(s.recipe, recipeOf(s.loaded, s.base));
