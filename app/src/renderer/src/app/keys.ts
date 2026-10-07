import { host } from "@/host";

const isMac = host.platform === "darwin" || (host.platform === "web" && /Mac|iPhone|iPad/.test(navigator.platform));

const MAC_GLYPH: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥" };

/** ["Mod", "S"] → "Ctrl S" (Windows/Linux) or "⌘S" (macOS). */
export function keyLabel(keys: readonly string[]): string {
  if (isMac) return keys.map((k) => MAC_GLYPH[k] ?? k).join("");
  return keys.map((k) => (k === "Mod" ? "Ctrl" : k)).join(" ");
}

/** Ctrl on Windows/Linux, Cmd on macOS. */
export const modKey = (e: KeyboardEvent | React.KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey);
