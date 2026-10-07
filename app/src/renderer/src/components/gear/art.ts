// Shading helpers for the gear drawings (port of design/mockups/assets/gear.js). The drawings are the one place
// with hand-tuned colours: block hues mirror the --block-* tokens because the shading math needs hex values.
import type { BlockCode } from "@/state/device-types";

export const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter Variable', Inter, system-ui, sans-serif";

export const BLOCK_HEX: Record<BlockCode, string> = {
  NR: "#8e8e93",
  PRE: "#facc15",
  DST: "#ff7a1a",
  NS: "#ec4899",
  AMP: "#ef3b36",
  CAB: "#c2865a",
  EQ: "#a3e635",
  MOD: "#4f7cff",
  DLY: "#2dd4bf",
  RVB: "#a855f7",
};

/** Amp voicing colours by catalog amp type. */
export const VOICE: Record<string, string> = {
  Clean: "#e9e2cf",
  Drive: "#e2b85f",
  "Hi Gain": "#ef3b36",
  Bass: "#5aa0ff",
  Acoustic: "#d8a46b",
};
export const voiceFor = (type?: string) => (type && VOICE[type]) || VOICE["Hi Gain"];

export const hash = (s: string) => {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const rgb = (c: string) => {
  const x = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
const hex = (a: number[]) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const shade = (c: string, f: number) => hex(rgb(c).map((v) => (f < 0 ? v * (1 + f) : v + (255 - v) * f)));
export const lum = (c: string) => {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
/** Font size that fits `t` into `maxW` viewBox units. */
export const fit = (t: string, maxW: number, base: number, caps = false) => Math.min(base, maxW / (Math.max(1, String(t).length) * (caps ? 0.68 : 0.58)));
export const clamp01 = (v: number, min: number, max: number) => Math.max(0, Math.min(1, (v - min) / (max - min || 1)));

export type Finish = "matte" | "noir" | "frost";
export interface FinishInfo {
  kind: Finish;
  body: string;
  accent: string;
}

const WORDS: Record<string, string | null> = {
  green: "#2f9e64",
  yellow: "#e9bd2c",
  black: null,
  red: "#c93a33",
  blue: "#3a6fd8",
  white: null,
  silver: null,
  orange: "#ec7a24",
  purple: "#7a55d6",
  pink: "#d95596",
};

/** Finish from the model name, then the block colour family, then a hash (gear.js finishFor). */
export function finishFor(name: string, base: string, h: number, want?: Finish, color?: string): FinishInfo {
  const pick: Finish = want ?? (["matte", "matte", "matte", "noir", "frost"] as const)[(h >>> 9) % 5];
  const word = Object.keys(WORDS).find((w) => new RegExp(`\\b${w}\\b`, "i").test(name));
  if (word === "black") return { kind: "noir", body: "#1a1a1d", accent: base };
  if (word === "white" || word === "silver") return { kind: "frost", body: "#dcdde1", accent: base };
  const hue = color || (word && WORDS[word]) || base;
  if (pick === "noir") return { kind: "noir", body: "#1a1a1d", accent: hue };
  if (pick === "frost") return { kind: "frost", body: "#dcdde1", accent: hue };
  return { kind: "matte", body: shade(hue, [0, -0.12, 0.08][(h >>> 3) % 3]), accent: lum(hue) > 0.62 ? "#1c1c1e" : "#ffffff" };
}
