// Local tone records: `<tonesDir>/<tone_id>/meta.json` plus the downloaded model files beside it.
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { T3kModel, T3kTone, ToneRecord } from "@shared/host/tones";
import { modelsVerdict } from "@shared/tone3000";

export const metaPath = (tonesDir: string, toneId: number) => join(tonesDir, String(toneId), "meta.json");

export async function readRecord(tonesDir: string, toneId: number): Promise<ToneRecord | null> {
  try {
    return JSON.parse(await readFile(metaPath(tonesDir, toneId), "utf8")) as ToneRecord;
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) so a crash never leaves half a meta.json. */
export async function writeRecord(tonesDir: string, record: ToneRecord): Promise<ToneRecord> {
  const dir = join(tonesDir, String(record.tone_id));
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, "meta.json.tmp");
  await writeFile(tmp, JSON.stringify(record, null, 2));
  await rename(tmp, metaPath(tonesDir, record.tone_id));
  return record;
}

/**
 * Merge TONE3000 metadata and (optionally) a downloaded model into the record, keeping slot links
 * and earlier downloads.
 */
export function buildRecord(
  previous: ToneRecord | null,
  tone: T3kTone,
  models: T3kModel[] | null,
  download: { model: T3kModel; file: string; bytes: number; reshaped?: boolean } | null,
  now: Date,
): ToneRecord {
  const kept = (previous?.models ?? []).filter((m) => m.id !== download?.model.id);
  const added = download
    ? [{ id: download.model.id, name: download.model.name, size: download.model.size, architecture: download.model.architecture_version, file: download.file, bytes: download.bytes }]
    : [];
  const prevGp5 = previous?.gp5;
  let verdict = models ? modelsVerdict(tone.format, models).kind : (prevGp5?.verdict ?? (tone.format === "ir" ? "ir" : "ready"));
  if (download?.reshaped) verdict = "reshape";
  else if (download?.reshaped === false && verdict === "reshape") verdict = "ready";
  else if (prevGp5?.verdict === "reshape" && verdict === "ready") verdict = "reshape";
  return {
    tone_id: tone.id,
    title: tone.title,
    gear: tone.gear,
    format: tone.format,
    creator: { username: tone.user.username, avatar_url: tone.user.avatar_url },
    image_url: tone.images?.[0] ?? null,
    license: tone.license,
    url: tone.url,
    models: [...kept, ...added],
    gp5: { ...prevGp5, verdict },
    savedAt: now.toISOString(),
  };
}

/** Every readable record under tonesDir (folders without a valid meta.json are skipped). */
export async function listRecords(tonesDir: string): Promise<ToneRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(tonesDir);
  } catch {
    return [];
  }
  const ids = entries.filter((e) => /^\d+$/.test(e)).map(Number);
  const records = await Promise.all(ids.map((id) => readRecord(tonesDir, id)));
  return records.filter((r): r is ToneRecord => r !== null);
}
