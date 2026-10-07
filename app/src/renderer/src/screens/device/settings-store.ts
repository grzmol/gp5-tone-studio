// AppSettings in the renderer: loaded once, patched through the host so every screen sees the same values.
import { create } from "zustand";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/host/app";
import { host } from "@/host";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  /** Saves through the host; on failure the previous values come back and the error is rethrown. */
  patch(patch: Partial<AppSettings>): Promise<void>;
}

export const useAppSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    set({ settings: await host.app.getSettings(), loaded: true });
  },
  async patch(patch) {
    const before = get().settings;
    set({ settings: { ...before, ...patch } });
    try {
      set({ settings: await host.app.setSettings(patch) });
    } catch (e) {
      set({ settings: before });
      throw e;
    }
  },
}));
