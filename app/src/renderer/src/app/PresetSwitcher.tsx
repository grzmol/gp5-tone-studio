import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { keyLabel } from "./keys";
import { requestPresetSwitch } from "./preset-switch";

const pad = (n: number) => String(n).padStart(2, "0");

/** ‹ 63 Shatte-GT1 ⌄ › : step or pick the active preset on the pedal (unsaved edits ask first). */
export function PresetSwitcher() {
  const names = useDevice((s) => s.names);
  const slot = useDevice((s) => s.slot);
  const status = useDevice((s) => s.status);
  const busy = useDevice((s) => s.busy);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const [open, setOpen] = useState(false);
  const connected = status === "connected" && slot !== null;
  const canSwitch = connected && !busy;
  const current = slot === null ? undefined : names.find((n) => n.slot === slot);

  const select = (target: number) => {
    setOpen(false);
    void requestPresetSwitch(target);
  };

  const step = (dir: -1 | 1) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={dir < 0 ? "Previous preset" : "Next preset"}
          disabled={!canSwitch}
          onClick={() => select(slot! + dir)}
          className="grid w-8 place-items-center rounded-pill text-silkscreen-3 transition-colors hover:text-silkscreen disabled:opacity-40"
        >
          {dir < 0 ? <ChevronLeft className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {dir < 0 ? "Previous preset" : "Next preset"} <span className="text-silkscreen-3">{keyLabel(["Mod", dir < 0 ? "[" : "]"])}</span>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div
      role="group"
      aria-label="Preset"
      className="no-drag glass-float flex h-8 shrink-0 items-stretch rounded-pill text-[13px] shadow-[var(--glass-shine),0_0_0_1px_var(--glass-edge),0_4px_16px_rgb(0_0_0/0.3)]"
    >
      {step(-1)}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!canSwitch}
            aria-label={current ? `Preset ${pad(current.slot)} ${current.name}${unsaved ? `, ${unsaved} unsaved changes` : ""}. Choose a preset` : "Choose a preset"}
            className="flex w-[260px] items-center gap-2 border-x border-glass-edge px-3 text-left font-medium text-silkscreen transition-colors hover:bg-white/6 disabled:hover:bg-transparent"
          >
            {current ? (
              <>
                <span className={cn("font-semibold text-silkscreen-3 tabular-nums", !connected && "opacity-70")}>{pad(current.slot)}</span>
                <span className={cn("min-w-0 flex-1 truncate", !connected && "text-silkscreen-3")}>{current.name}</span>
                {connected && unsaved > 0 && <span className="size-1.5 shrink-0 rounded-full bg-led-warn" aria-hidden />}
              </>
            ) : (
              <span className="flex-1 text-silkscreen-3">{status === "connecting" ? "Reading the GP-5…" : "No preset loaded"}</span>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-silkscreen-3" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="center" sideOffset={8}>
          <Command>
            <CommandInput placeholder="Find a preset or slot number" />
            <CommandList className="max-h-[360px]">
              <CommandEmpty>No preset with that name</CommandEmpty>
              <CommandGroup>
                {names.map((n) => (
                  <CommandItem key={n.slot} value={`${pad(n.slot)} ${n.name}`} onSelect={() => select(n.slot)} className="min-h-8">
                    <span className="w-5 font-semibold text-silkscreen-3 tabular-nums">{pad(n.slot)}</span>
                    <span className="flex-1 truncate">{n.name}</span>
                    {n.slot === slot && <span className="text-xs text-silkscreen-3">Current</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {step(1)}
    </div>
  );
}
