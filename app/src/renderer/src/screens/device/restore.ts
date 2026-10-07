// Restore sources: a backup collection or a folder picked by the user → slot-addressed GP-5 presets to write.
import { detectDevice, readName } from "@/gp5/lib/prst.mjs";
import { parseSlotFileName } from "@shared/files-naming";
import type { BackupEntry } from "@/state/device-types";

export interface RestoreSource {
  /** "gp5-2026-10-07" or the picked folder's name */
  title: string;
  /** "backups/gp5-2026-10-07" or the folder path */
  location: string;
  /** One per slot, sorted by slot */
  entries: BackupEntry[];
  /** Files that can't be restored, with the reason */
  skipped: string[];
}

export interface SourceFile {
  fileName: string;
  /** Slot recorded with the file (backups), otherwise taken from an `NN-` file name prefix */
  slot?: number | null;
  bytes: Uint8Array | null;
  error?: string | null;
}

/** Keep GP-5 presets with a known slot, one per slot (the first wins); explain everything else. */
export function restoreEntries(files: SourceFile[]): { entries: BackupEntry[]; skipped: string[] } {
  const bySlot = new Map<number, BackupEntry>();
  const skipped: string[] = [];
  for (const f of files) {
    if (!f.bytes) {
      skipped.push(`${f.fileName}: ${f.error ?? "unreadable"}`);
      continue;
    }
    const slot = f.slot ?? parseSlotFileName(f.fileName)?.slot ?? null;
    if (slot === null || slot < 0 || slot > 99) {
      skipped.push(`${f.fileName}: no slot number in the file name`);
      continue;
    }
    let key: string;
    try {
      key = detectDevice(f.bytes).key;
    } catch {
      skipped.push(`${f.fileName}: not a GP-5 preset`);
      continue;
    }
    if (key !== "gp5") {
      skipped.push(`${f.fileName}: GP-50 preset (import it in the Library to convert it)`);
      continue;
    }
    if (bySlot.has(slot)) {
      skipped.push(`${f.fileName}: slot ${slot} appears twice`);
      continue;
    }
    bySlot.set(slot, { slot, name: readName(f.bytes).trim() || "GP-5", prst: f.bytes });
  }
  return { entries: [...bySlot.values()].sort((a, b) => a.slot - b.slot), skipped };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Slots 00–99", "Slots 00–04 and 07", "Slot 12" */
export function describeSlots(slots: number[]): string {
  if (!slots.length) return "No slots";
  const runs: [number, number][] = [];
  for (const s of [...slots].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && s === last[1] + 1) last[1] = s;
    else runs.push([s, s]);
  }
  const parts = runs.map(([a, b]) => (a === b ? pad2(a) : `${pad2(a)}–${pad2(b)}`));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${slots.length === 1 ? "Slot" : "Slots"} ${list}`;
}
