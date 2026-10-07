// Shared write helpers: the "Back up slot first" snapshot and user-facing error copy (overlays.md G).
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { REPLACED_ID, type LocalPreset } from "@shared/host/files";

/** Where the "back up first" copy of a slot comes from. */
export type BackupSource =
  | { kind: "saved"; prst: Uint8Array }
  | { kind: "pedal" }
  | { kind: "backup"; prst: Uint8Array; at: string }
  | { kind: "none"; reason: string };

/**
 * The active slot uses its saved body (not the live edits). Other slots are read from the pedal, which switches
 * presets; with unsaved edits that would drop them, so the newest backup's copy is used when its name still matches.
 */
export async function resolveBackupSource(slot: number): Promise<BackupSource> {
  const d = useDevice.getState();
  if (d.slot === slot && d.saved) return { kind: "saved", prst: d.saved.prst };
  if (d.unsavedChanges === 0) return { kind: "pedal" };
  const name = d.names[slot]?.name;
  const newest = (await host.files.listCollections().catch(() => [])).find((c) => c.kind === "backup");
  const copy = newest ? (await host.files.listPresets(newest.id).catch(() => [])).find((p) => p.slot === slot) : undefined;
  if (newest && copy && copy.name === name) return { kind: "backup", prst: copy.prst, at: newest.createdAt };
  return { kind: "none", reason: `Reading slot ${slot} would drop your unsaved changes, and no backup has its current preset.` };
}

/** Save what is in `slot` now to the "Replaced presets" collection. */
export async function backUpSlot(slot: number, source?: BackupSource): Promise<LocalPreset> {
  const src = source ?? (await resolveBackupSource(slot));
  if (src.kind === "none") throw new Error(src.reason);
  const d = useDevice.getState();
  const name = d.names[slot]?.name ?? "GP-5";
  const prst = src.kind === "pedal" ? await d.readPreset(slot) : src.prst;
  const [saved] = await host.files.addPresets(REPLACED_ID, [{ name, prst, slot, source: `Slot ${slot} on GP-5` }]);
  return saved;
}

/** Plain-language reason for a failed pedal or file operation. */
export function describeError(e: unknown, slot?: number): string {
  const err: { code?: string; message?: string } | null = e && typeof e === "object" ? e : null;
  const where = slot === undefined ? "The slot" : `Slot ${slot}`;
  switch (err?.code) {
    case "unsaved":
      return "This switches presets on the pedal, which would drop your unsaved changes. Save or discard them on the Rig first.";
    case "busy":
      return err.message ?? "Wait until the current pedal job finishes.";
    case "not-connected":
    case "closed":
      return "The GP-5 isn't connected. Connect it and try again.";
    case "timeout":
      return `The GP-5 stopped answering. ${where} was not changed. Check the USB cable and try again.`;
    case "verify":
      return /unchanged|acknowledged/.test(err.message ?? "")
        ? `The GP-5 didn't acknowledge every frame and discarded the write. ${where} was not changed.`
        : `The read-back differs from what was sent. Retry, or restore ${where.toLowerCase()} from the backup.`;
    case "length":
    case "unsafe":
      return "Tone Studio stopped this write because the data looked wrong. Nothing was sent.";
    case "unsupported":
      return err.message ?? "This needs the desktop app.";
    default:
      return err?.message || String(e);
  }
}
