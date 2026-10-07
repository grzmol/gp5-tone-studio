import { useDevice } from "@/state/device";
import { useUi } from "@/state/ui";
import { notifyError } from "./notify";

/**
 * Switch the pedal to `slot` (wraps 0–99). With unsaved edits this opens the shell's
 * "Save your changes to …?" AlertDialog instead (overlays.md B); the dialog finishes the switch.
 */
export async function requestPresetSwitch(slot: number): Promise<void> {
  const target = ((slot % 100) + 100) % 100;
  const d = useDevice.getState();
  if (d.status !== "connected" || d.busy || target === d.slot) return;
  if (d.unsavedChanges > 0) {
    useUi.getState().setSwitchTarget(target);
    return;
  }
  await switchNow(target);
}

/** Select `target` without asking (the caller has dealt with unsaved edits). */
export async function switchNow(target: number): Promise<void> {
  const from = useDevice.getState().slot;
  try {
    await useDevice.getState().selectSlot(target);
    const ui = useUi.getState();
    if (from !== null) ui.noteRecentSlot(from);
    ui.noteRecentSlot(target);
  } catch (e) {
    notifyError("Couldn't switch presets", e, () => switchNow(target));
  }
}
