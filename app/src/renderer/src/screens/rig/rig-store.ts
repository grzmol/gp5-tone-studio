// Rig view state: open group, selected block, model picker, Compare with saved, copied block settings.
import { create } from "zustand";
import type { PresetState } from "@/state/device-types";
import type { BlockSnapshot } from "./history";
import type { GroupId } from "./order";

export interface PickerState {
  block: number;
  /** Model highlighted on open (palette request) */
  highlight?: number;
  /** Tab to open on (e.g. "User IR" from the cab source toggle) */
  tab?: string;
}

interface RigState {
  group: GroupId;
  selected: number | null;
  picker: PickerState | null;
  /** The edited preset while Compare with saved plays the saved one */
  compare: { edited: PresetState; changes: number } | null;
  comparing: boolean;
  clipboard: (BlockSnapshot & { code: string; title: string }) | null;
  setGroup(group: GroupId): void;
  select(block: number | null): void;
  openPicker(p: PickerState | null): void;
}

export const useRig = create<RigState>((set) => ({
  group: "before",
  selected: null,
  picker: null,
  compare: null,
  comparing: false,
  clipboard: null,
  setGroup: (group) => set({ group }),
  select: (selected) => set({ selected }),
  openPicker: (picker) => set({ picker }),
}));
