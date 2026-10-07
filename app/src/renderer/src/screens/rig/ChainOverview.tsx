import { useState, type DragEvent } from "react";
import { LockIcon } from "lucide-react";
import { Dial, GearFor, modelTitle } from "@/components/gear";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { editOrder, editVolume } from "./edits";
import { GROUPS, GROUP_TITLE, groupsOf, moveToGroup, type GroupId } from "./order";
import { DRAG_MIME } from "./Pedalboard";
import { useRig } from "./rig-store";

const IN_SPEC = { min: -20, max: 20, step: 1, unit: "dB" };
const OUT_SPEC = { min: 0, max: 100, step: 1 };

/** Paradise-style top strip: IN trim, the three groups as thumbnails (click to open, drop to move), lock, OUT. */
export function ChainOverview({ preset, readOnly }: { preset: PresetState; readOnly: boolean }) {
  const group = useRig((s) => s.group);
  const inputTrim = useDevice((s) => s.globals?.inputTrim);
  const connected = useDevice((s) => s.status === "connected");
  const groups = groupsOf(preset.order);
  const nsOn = preset.blocks[9].enabled;
  const [dropGroup, setDropGroup] = useState<GroupId | null>(null);

  const onDragOver = (g: GroupId) => (e: DragEvent) => {
    const raw = e.dataTransfer.types.includes(DRAG_MIME);
    if (!raw || readOnly || g === "amp") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropGroup(g);
  };
  const onDrop = (g: GroupId) => (e: DragEvent) => {
    setDropGroup(null);
    const block = Number(e.dataTransfer.getData(DRAG_MIME));
    const next = Number.isInteger(block) ? moveToGroup(preset.order, block, g) : null;
    if (!next) return;
    e.preventDefault();
    editOrder(next);
    useRig.getState().setGroup(g);
  };

  return (
    <section aria-label="Signal chain overview" className="glass mx-7 flex items-center gap-3.5 rounded-xl px-[18px] pt-3.5 pb-2.5">
      {inputTrim !== undefined && (
        <>
          <Dial
            layout="row"
            size={30}
            label="In"
            ariaLabel="Input trim"
            value={inputTrim}
            spec={IN_SPEC}
            disabled={readOnly || !connected}
            onChange={(v) => useDevice.getState().setGlobal("inputTrim", v)}
          />
          <div className="h-9 w-px bg-seam-strong" />
        </>
      )}
      <div className="relative flex flex-1 items-center justify-center gap-1.5 before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:bg-cable">
        {GROUPS.map((g) => {
          const active = g === group;
          const replaced = g === "amp" && nsOn;
          return (
            <Tooltip key={g}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${GROUP_TITLE[g]}${replaced ? ", replaced by SnapTone" : ""}`}
                  onClick={() => useRig.getState().setGroup(g)}
                  onDragOver={onDragOver(g)}
                  onDragLeave={() => setDropGroup(null)}
                  onDrop={onDrop(g)}
                  className={cn(
                    "relative mt-2 flex min-h-12 items-end gap-1.5 rounded-lg px-2.5 py-2 transition-colors",
                    active ? "bg-faceplate-raised shadow-[0_0_0_1.5px_rgb(255_255_255/0.85)]" : "hover:bg-faceplate",
                    dropGroup === g && "shadow-[0_0_0_2px_var(--silkscreen)]",
                  )}
                >
                  <span className={cn("absolute -top-[17px] left-1.5 text-xs font-medium whitespace-nowrap", active ? "text-silkscreen" : "text-silkscreen-3")}>{GROUP_TITLE[g]}</span>
                  {groups[g].map((b) => {
                    const block = preset.blocks[b];
                    const wide = block.code === "AMP" || block.code === "CAB";
                    return (
                      <GearFor
                        key={b}
                        block={block}
                        className={cn(wide ? "w-[58px]" : "w-[30px]", replaced ? "saturate-0 brightness-[.4]" : !block.enabled && "saturate-[.15] brightness-50")}
                      />
                    );
                  })}
                  {replaced && (
                    <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-surface-solid px-1.5 text-xs font-semibold whitespace-nowrap text-block-ns">Replaced by SnapTone</span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{groups[g].map((b) => `${preset.blocks[b].code} ${modelTitle(preset.blocks[b])}`).join(" · ")}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} aria-label="Fixed order" className="grid size-8 place-items-center rounded-pill text-silkscreen-4">
            <LockIcon className="size-[13px]" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>DST, NS, AMP, CAB and EQ keep a fixed order on the GP-5</TooltipContent>
      </Tooltip>
      <div className="h-9 w-px bg-seam-strong" />
      <Dial layout="row" size={30} label="Out" ariaLabel="Patch volume" value={preset.volume} spec={OUT_SPEC} disabled={readOnly} onChange={editVolume} />
    </section>
  );
}
