// Import: validate picked/dropped .prst files with the toolkit, then copy them into "Imported files".
import { convertPrst, detectDevice, isCrcValid, parsePrst, validateOrder } from "@/gp5/lib/prst.mjs";
import { host } from "@/host";
import { IMPORTED_ID, type LocalPreset, type NewPreset, type PickedFile } from "@shared/host/files";

export interface Rejected {
  fileName: string;
  reason: string;
}

/** Check one file. GP-50 files are accepted when they convert (their GP-50-only blocks are named at write time). */
export function checkPrst(bytes: Uint8Array): { ok: true; name: string; device: "gp5" | "gp50" } | { ok: false; reason: string } {
  let device: { key: "gp5" | "gp50" };
  try {
    device = detectDevice(bytes);
  } catch {
    return { ok: false, reason: "Not a GP-5 or GP-50 preset." };
  }
  try {
    const p = parsePrst(bytes);
    if (!isCrcValid(bytes)) return { ok: false, reason: "The file is damaged (its checksum doesn't match)." };
    if (validateOrder(p.order)) return { ok: false, reason: "The file is damaged (its chain order is invalid)." };
    if (device.key === "gp50") convertPrst(bytes, "gp5", { force: true });
    return { ok: true, name: p.name || "Untitled", device: device.key };
  } catch {
    return { ok: false, reason: "Not a GP-5 or GP-50 preset." };
  }
}

/** Validate and store; returns what was added and what was turned away (with reasons). */
export async function importPicked(files: PickedFile[]): Promise<{ added: LocalPreset[]; rejected: Rejected[] }> {
  const rejected: Rejected[] = [];
  const items: NewPreset[] = [];
  for (const f of files) {
    if (f.error || !f.bytes) {
      rejected.push({ fileName: f.fileName, reason: f.error ?? "Couldn't read the file." });
      continue;
    }
    const check = checkPrst(f.bytes);
    if (!check.ok) rejected.push({ fileName: f.fileName, reason: check.reason });
    else items.push({ name: check.name, prst: f.bytes, source: f.fileName, fileName: f.fileName });
  }
  const added = items.length ? await host.files.addPresets(IMPORTED_ID, items) : [];
  return { added, rejected };
}
