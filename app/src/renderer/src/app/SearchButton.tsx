import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { useUi } from "@/state/ui";
import { keyLabel } from "./keys";

/** Title-bar entry to the command palette. */
export function SearchButton() {
  const open = useUi((s) => s.setPaletteOpen);
  return (
    <button
      type="button"
      aria-label="Search everything"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={() => open(true)}
      className="no-drag glass-float flex h-8 items-center gap-2 rounded-pill px-3 text-[13px] text-silkscreen-3 shadow-[var(--glass-shine),0_0_0_1px_var(--glass-edge),0_4px_16px_rgb(0_0_0/0.3)] transition-colors hover:text-silkscreen"
    >
      <Search className="size-4" aria-hidden />
      Search
      <Kbd className="h-5 rounded-xs bg-white/8 px-1.5 text-[11px] font-semibold text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--glass-edge)]">{keyLabel(["Mod", "K"])}</Kbd>
    </button>
  );
}
