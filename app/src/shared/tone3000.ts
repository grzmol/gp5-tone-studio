// Pure TONE3000 → GP-5 helpers shared by main and renderer (no I/O).
import type { T3kGear, T3kModel, T3kTone, ToneRecord } from "./host/tones";

export type Verdict =
  | { kind: "ready" }
  | { kind: "reshape" }
  | { kind: "not-loadable"; reason: "a2" | "small" | "custom" | "format" }
  | { kind: "ir" };

/** The GP-5 (via Valeton Suite) loads NAM A1 standard WaveNet only. */
export const isGp5Model = (m: Pick<T3kModel, "architecture_version" | "size">) => m.architecture_version === "1" && m.size === "standard";

/**
 * Verdict from list data only (cards). Exact per-model answers need `models()`; whether a file needs the
 * 0.7 → 0.5.x update is only known after download, so "reshape" comes from the local record.
 */
export function toneVerdict(tone: Pick<T3kTone, "format" | "a1_models_count" | "a2_models_count" | "custom_models_count" | "sizes">, record?: ToneRecord | null): Verdict {
  if (tone.format === "ir") return { kind: "ir" };
  if (tone.format !== "nam") return { kind: "not-loadable", reason: "format" };
  if (record?.gp5.verdict === "reshape") return { kind: "reshape" };
  if (tone.a1_models_count > 0 && tone.sizes.includes("standard")) return { kind: "ready" };
  if (tone.a1_models_count > 0) return { kind: "not-loadable", reason: "small" };
  if (tone.a2_models_count > 0) return { kind: "not-loadable", reason: "a2" };
  return { kind: "not-loadable", reason: "custom" };
}

/** Verdict from the full model list (sheet). */
export function modelsVerdict(format: T3kTone["format"], models: Pick<T3kModel, "architecture_version" | "size">[], record?: ToneRecord | null): Verdict {
  if (format === "ir") return { kind: "ir" };
  if (format !== "nam") return { kind: "not-loadable", reason: "format" };
  if (models.some(isGp5Model)) return record?.gp5.verdict === "reshape" ? { kind: "reshape" } : { kind: "ready" };
  if (models.some((m) => m.architecture_version === "1")) return { kind: "not-loadable", reason: "small" };
  if (models.some((m) => m.architecture_version === "2")) return { kind: "not-loadable", reason: "a2" };
  return { kind: "not-loadable", reason: "custom" };
}

export function verdictLabel(v: Verdict): string {
  switch (v.kind) {
    case "ready":
      return "Ready for GP-5";
    case "reshape":
      return "Ready for GP-5 after a format update";
    case "ir":
      return "Goes to a User IR slot";
    case "not-loadable":
      return v.reason === "a2"
        ? "GP-5 can't load this (A2 only)"
        : v.reason === "small"
          ? "GP-5 can't load this (lite and nano only)"
          : v.reason === "format"
            ? "GP-5 can't load this format"
            : "GP-5 can't load this (custom layout)";
  }
}

const GEAR_LABEL: Record<T3kGear, string> = {
  amp: "Amp",
  "amp-cab": "Amp + cab",
  pedal: "Pedal",
  outboard: "Outboard",
  cab: "Cab",
  space: "Space",
  experimental: "Experimental",
};
export const gearLabel = (g: string) => GEAR_LABEL[g as T3kGear] ?? g;

const LICENSE_LABEL: Record<string, string> = {
  t3k: "TONE3000 license",
  "cc-by": "CC BY, credit the creator",
  "cc-by-sa": "CC BY-SA",
  "cc-by-nc": "CC BY-NC, non-commercial",
  "cc-by-nc-sa": "CC BY-NC-SA",
  "cc-by-nd": "CC BY-ND",
  "cc-by-nc-nd": "CC BY-NC-ND",
  cco: "CC0, public domain",
};
export const licenseLabel = (l: string) => LICENSE_LABEL[l] ?? l;

export const ARCH_LABEL = (m: Pick<T3kModel, "architecture_version" | "size">) =>
  m.architecture_version === "2" ? "A2" : m.architecture_version === "custom" ? "Custom" : m.architecture_version === "1" ? `A1 ${m.size}` : m.size;

/**
 * Pedal name proposal: at most 10 characters, letters/digits/dash, upper case (like the factory list).
 * "EVH 5150III 50W, red channel" + model "Gain 4" → "5150III-G4"-style names are left to the user;
 * we take significant words of the title and fit them.
 */
export function proposeSlotName(title: string, modelName?: string): string {
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, " ")
      .replace(/_/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const words = clean(title).map((w) => w.toUpperCase());
  const tail = modelName ? (clean(modelName).find((w) => /\d/.test(w)) ?? "").toUpperCase() : "";
  let base = words.find((w) => /\d/.test(w) && w.length >= 3) ?? words[0] ?? "TONE";
  const rest = words.filter((w) => w !== base);
  if (rest.length && base.length + 1 + rest[0].length <= 10 - (tail ? tail.length : 0)) base = `${base}-${rest[0]}`;
  const name = tail ? `${base.slice(0, 9 - tail.length)}${tail}` : base;
  return sanitizeSlotName(name);
}

/** Keep names the pedal and file systems both accept: ASCII letters, digits, space, dash; ≤ 10 chars. */
export function sanitizeSlotName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .trim()
    .slice(0, 10)
    .trim();
}

/** First empty user SnapTone slot (50–79) or User IR slot (0–19). */
export function firstEmptySlot(kind: "snaptone" | "ir", slots: { slot: number; name: string }[] | null): number | null {
  if (!slots) return null;
  const range = kind === "snaptone" ? slots.filter((s) => s.slot >= 50 && s.slot < 80) : slots.filter((s) => s.slot < 20);
  return range.find((s) => isEmptySlotName(s.name))?.slot ?? null;
}

/** Pedal slot tables mark empty slots by name: "Empty" (SnapTone) or "User IR n" (IR). */
export const isEmptySlotName = (name: string) => name === "Empty" || name === "" || /^User IR \d+$/.test(name);

/** Slots whose name changed between two reads of the same table. */
export function changedSlots(before: string[], after: { slot: number; name: string }[], range: [number, number]): number[] {
  return after.filter((s) => s.slot >= range[0] && s.slot <= range[1] && before[s.slot] !== s.name && !isEmptySlotName(s.name)).map((s) => s.slot);
}
