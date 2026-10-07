// Pure naming rules for the library on disk (main) and in IndexedDB (browser build). Owner: Library.

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A file/folder name that is safe on Windows, macOS and Linux. Keeps spaces and case. */
export function sanitizeFileName(name: string, fallback = "Preset"): string {
  let s = name.normalize("NFC").replace(ILLEGAL, "_").replace(/\s+/g, " ").trim();
  // Windows drops trailing dots and spaces; leading dots hide files on macOS/Linux.
  s = s.replace(/[. ]+$/, "").replace(/^\.+/, "");
  if (s.length > 64) s = s.slice(0, 64).trimEnd();
  if (!s) return fallback;
  if (RESERVED.test(s.split(".")[0])) s = `_${s}`;
  return s;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `NN-Name.prst`, the naming of `backupAll` and Valeton's own backup folders. */
export function slotFileName(slot: number, name: string): string {
  return `${pad2(slot)}-${sanitizeFileName(name, "GP-5")}.prst`;
}

/** Inverse of slotFileName: `07-Blues Man.prst` → { slot: 7, name: "Blues Man" }. */
export function parseSlotFileName(fileName: string): { slot: number; name: string } | null {
  const m = /^(\d{2})-(.*)\.prst$/i.exec(fileName);
  if (!m) return null;
  const slot = Number(m[1]);
  return slot <= 99 ? { slot, name: m[2] } : null;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `gp5-YYYY-MM-DD`, then `gp5-YYYY-MM-DD-2`, `-3` … when a backup of that day exists. */
export function backupDirName(date: Date, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (x) => x.toLowerCase()));
  const base = `gp5-${isoDay(date)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Date of a backup folder (local midnight), or null for folders the app did not name. */
export function parseBackupDirName(dir: string): Date | null {
  const m = /^gp5-(\d{4})-(\d{2})-(\d{2})(?:-\d+)?$/.exec(dir);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d;
}

/** `name.ext`, then `name (2).ext` … so imports never overwrite each other. Case-insensitive like Windows/macOS. */
export function uniqueFileName(fileName: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (x) => x.toLowerCase()));
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Fixed library folders; user collections never take these names. */
export const RESERVED_COLLECTION_DIRS = ["imported", "replaced"] as const;

/** Folder for a new user collection: sanitized title, unique, never a reserved folder. */
export function collectionDirName(title: string, existing: Iterable<string>): string {
  const base = sanitizeFileName(title, "Collection");
  const taken = [...existing, ...RESERVED_COLLECTION_DIRS];
  return uniqueFileName(base, taken);
}

export type CollectionRoot = "backups" | "library";

/** Validate a collection id (`backups/<dir>` or `library/<dir>`); rejects anything that could leave the root. */
export function parseCollectionId(id: string): { root: CollectionRoot; dir: string } | null {
  const m = /^(backups|library)\/([^/\\]+)$/.exec(id);
  if (!m) return null;
  const dir = m[2];
  if (dir === "." || dir === ".." || dir !== sanitizeFileName(dir, "")) return null;
  return { root: m[1] as CollectionRoot, dir };
}

/** A preset file name inside a collection: one path segment, .prst. */
export function isSafePresetFileName(fileName: string): boolean {
  return /\.prst$/i.test(fileName) && fileName === sanitizeFileName(fileName, "") && !fileName.includes("/");
}

/** Default file name for a preset added to a collection. */
export function presetFileName(name: string, slot: number | null | undefined): string {
  return slot === null || slot === undefined ? `${sanitizeFileName(name)}.prst` : slotFileName(slot, name);
}

/** `.prst` files are 507 (GP-5) or 552 (GP-50) bytes; anything far larger is not a preset. */
export const MAX_PRST_BYTES = 4096;
