import { useRef, useState, type DragEvent, type PointerEvent } from "react";
import { ChevronDownIcon } from "lucide-react";
import pedalboardUrl from "@/assets/backdrops/pedalboard.svg";
import { Capture, Dial, GearFor, knobsForBlock, modelTitle, paramTitle } from "@/components/gear";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import type { BlockState, PresetState } from "@/state/device-types";
import { BlockMenu } from "./BlockMenu";
import { editEnabled, editOrder, editParam } from "./edits";
import { groupsOf, isMovable, moveBlock } from "./order";
import { useRig } from "./rig-store";
import { snapToneName } from "./snaptone";
import { useMediaQuery } from "./use-media-query";

export const DRAG_MIME = "application/x-gp5-block";

/** Pedal art width: scales with the window height left for the board (2:3 gear), rig.md › Minimum window.
 *  --rig-banner is the offline banner height (set by RigScreen). */
const GEAR_W = "w-[clamp(calc(112px-var(--rig-banner,0px)/1.5),calc((100vh-570px-var(--rig-banner,0px))/1.5),186px)]";

const HINT: Record<"before" | "after", string> = {
  before: "Drag a pedal to reorder. NR and PRE can move; DST and NS stay in front of the amp.",
  after: "MOD, DLY and RVB can move; EQ stays right after the cab.",
};

function stateLine(b: BlockState) {
  if (b.code === "NS") return b.enabled ? "SnapTone on, replacing the amp and cab" : "SnapTone off";
  const base = `${b.code} ${b.enabled ? "on" : "off"}`;
  const time = b.model?.params.find((p) => p.name === "Time");
  if (b.enabled && b.code === "DLY" && time) return `${base}, time ${Math.round(b.params[time.index])} ${time.unit ?? "ms"}`;
  return base;
}

interface BoardProps {
  preset: PresetState;
  view: "before" | "after";
  readOnly: boolean;
  showValues: boolean;
}

/** The open group drawn large on the pedalboard backdrop: model buttons, editable pedals, on/off pills. */
export function Pedalboard({ preset, view, readOnly, showValues }: BoardProps) {
  const blocks = groupsOf(preset.order)[view];
  const nsOn = preset.blocks[9].enabled;
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ target: number; side: "before" | "after" } | null>(null);
  const snapTones = useDevice((s) => s.snapTones);
  const nsSlot = snapToneName(preset.blocks[9], snapTones);

  const hint = readOnly
    ? "Showing the last read. Pedals can't be turned, switched or moved until the GP-5 is back."
    : view === "before" && nsOn
      ? `NS is on, so ${nsSlot} plays in place of the amp and cab.`
      : HINT[view];

  const onDragOver = (target: number) => (e: DragEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    if (!moveBlock(preset.order, drag, target, side)) {
      setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (drop?.target !== target || drop.side !== side) setDrop({ target, side });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag !== null && drop) {
      const next = moveBlock(preset.order, drag, drop.target, drop.side);
      if (next) editOrder(next);
    }
    setDrag(null);
    setDrop(null);
  };

  return (
    <section
      aria-label={view === "before" ? "Before the amp" : "After the amp"}
      className="relative mx-7 my-3.5 flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden rounded-xl bg-[#070708] bg-cover bg-center bg-no-repeat px-6 pt-[18px] pb-5 shadow-[inset_0_0_0_1px_var(--glass-edge),inset_0_1px_0_rgb(255_255_255/0.07)] [@media(max-height:820px)]:my-2.5 [@media(max-height:820px)]:gap-2.5 [@media(max-height:820px)]:py-3"
      style={{ backgroundImage: `url(${pedalboardUrl})` }}
    >
      <BoardHead title={view === "before" ? "Before the amp" : "After the amp"} hint={hint} keys />
      <div role="list" aria-label="Pedals in signal order" className={cn("relative flex min-h-0 flex-1 items-start justify-center gap-[22px] overflow-x-auto overflow-y-hidden [scrollbar-width:none]", readOnly && "opacity-70")}>
        {blocks.map((b) =>
          b === 9 && nsOn ? (
            <NsColumn key={b} block={preset.blocks[9]} readOnly={readOnly} name={nsSlot} />
          ) : (
            <SlotColumn
              key={b}
              block={preset.blocks[b]}
              order={preset.order}
              readOnly={readOnly}
              showValues={showValues}
              dropSide={drop?.target === b ? drop.side : null}
              dragging={drag === b}
              onDragStart={() => setDrag(b)}
              onDragEnd={() => {
                setDrag(null);
                setDrop(null);
              }}
              onDragOver={onDragOver(b)}
              onDrop={onDrop}
              nsName={nsSlot}
            />
          ),
        )}
      </div>
    </section>
  );
}

export function BoardHead({ title, hint, keys }: { title: string; hint: string; keys?: boolean }) {
  return (
    <div className="relative -mx-2.5 -mt-1.5 flex items-center gap-4 self-stretch rounded-lg bg-[rgb(10_10_12/0.66)] px-3.5 py-2">
      <h2 className="m-0 shrink-0 text-[15px] font-semibold">{title}</h2>
      <span className="min-w-0 truncate text-sm text-silkscreen-3">{hint}</span>
      <span className="grow" />
      {keys && (
        <span className="flex shrink-0 items-center gap-1 text-sm whitespace-nowrap text-silkscreen-3 max-[1320px]:hidden">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> pedal <Kbd>Space</Kbd> on/off <Kbd>M</Kbd> change model
        </span>
      )}
    </div>
  );
}

export function ModelButton({ block, label, selected, disabled, className }: { block: BlockState; label?: string; selected?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={`${block.code} model: ${label ?? modelTitle(block)}. Change model`}
      onClick={() => {
        useRig.getState().select(block.index);
        useRig.getState().openPicker({ block: block.index });
      }}
      className={cn(
        "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-pill px-3 text-sm font-medium text-silkscreen transition-shadow disabled:cursor-default",
        selected
          ? "bg-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_0_0_1.5px_rgb(255_255_255/0.9)]"
          : "bg-[rgb(10_10_12/0.62)] shadow-[inset_0_0_0_1px_var(--glass-edge)] enabled:hover:shadow-[inset_0_0_0_1px_var(--silkscreen-2)]",
        !block.enabled && !selected && "text-silkscreen-3",
        className,
      )}
    >
      <span className="size-2 flex-none rounded-full" style={{ background: `var(--block-${block.code.toLowerCase()})` }} />
      <span className="min-w-0 flex-1 truncate text-left">{label ?? modelTitle(block)}</span>
      <ChevronDownIcon className="size-3.5 text-silkscreen-3" aria-hidden />
    </button>
  );
}

function SlotFoot({ block, readOnly, text }: { block: BlockState; readOnly: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-pill bg-[rgb(10_10_12/0.66)] py-[3px] pr-2.5 pl-1 text-xs text-silkscreen-2">
      <Switch size="sm" checked={block.enabled} disabled={readOnly} onCheckedChange={(on) => editEnabled(block.index, on)} aria-label={`${block.code} on`} />
      <span className="whitespace-nowrap">{text}</span>
    </div>
  );
}

interface SlotProps {
  block: BlockState;
  order: number[];
  readOnly: boolean;
  showValues: boolean;
  dropSide: "before" | "after" | null;
  dragging: boolean;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOver(e: DragEvent<HTMLDivElement>): void;
  onDrop(e: DragEvent): void;
  nsName: string;
}

function SlotColumn({ block, readOnly, showValues, dropSide, dragging, onDragStart, onDragEnd, onDragOver, onDrop, nsName }: SlotProps) {
  const selected = useRig((s) => s.selected === block.index);
  const fromControl = useRef(false);
  const movable = isMovable(block.index) && !readOnly;
  const label = block.code === "NS" ? nsName : modelTitle(block);
  const onPointerDownCapture = (e: PointerEvent) => {
    fromControl.current = !!(e.target as HTMLElement).closest("button,[role=slider],[role=switch],input");
    useRig.getState().select(block.index);
  };
  return (
    <BlockMenu block={block} readOnly={readOnly}>
      <div
        role="listitem"
        aria-label={`${block.code} ${label}, ${block.enabled ? "on" : "off"}${isMovable(block.index) ? ", movable" : ""}`}
        aria-current={selected || undefined}
        draggable={movable}
        onPointerDownCapture={onPointerDownCapture}
        onDragStart={(e) => {
          if (fromControl.current) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(DRAG_MIME, String(block.index));
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn("relative flex min-w-0 flex-col items-center gap-2.5 [@media(max-height:820px)]:gap-2", movable && "cursor-grab", dragging && "opacity-50")}
      >
        {dropSide && <span aria-hidden className={cn("absolute top-10 bottom-10 w-[3px] rounded-pill bg-silkscreen", dropSide === "before" ? "-left-[13px]" : "-right-[13px]")} />}
        <ModelButton block={block} label={label} selected={selected} disabled={readOnly} />
        {block.code === "NS" ? (
          <Capture
            name={label}
            on={block.enabled}
            interactive
            disabled={readOnly}
            onToggleOn={(on) => editEnabled(9, on)}
            className={cn(GEAR_W, "drop-shadow-[0_18px_24px_rgb(0_0_0/0.6)]", !block.enabled && "saturate-[.2] brightness-50")}
          />
        ) : (
          <GearFor
            block={block}
            interactive
            disabled={readOnly}
            showValues={showValues}
            onParam={(i, v) => editParam(block.index, i, v)}
            onToggleOn={(on) => editEnabled(block.index, on)}
            className={cn(GEAR_W, "drop-shadow-[0_18px_24px_rgb(0_0_0/0.6)]", !block.enabled && "saturate-[.2] brightness-50")}
          />
        )}
        <SlotFoot block={block} readOnly={readOnly} text={stateLine(block)} />
      </div>
    </BlockMenu>
  );
}

/** NS engaged: the capture plus its dials, wider than a pedal column (rig-snaptone.html). */
function NsColumn({ block, readOnly, name }: { block: BlockState; readOnly: boolean; name: string }) {
  const selected = useRig((s) => s.selected === 9);
  const knobs = knobsForBlock(block);
  const short = useMediaQuery("(max-height: 820px)");
  return (
    <BlockMenu block={block} readOnly={readOnly}>
      <div
        role="listitem"
        aria-label={`NS ${name}, on`}
        aria-current={selected || undefined}
        onPointerDownCapture={() => useRig.getState().select(9)}
        className="relative flex w-[clamp(420px,36vw,520px)] flex-none flex-col items-center gap-2.5 [@media(max-height:820px)]:gap-2"
      >
        <ModelButton block={block} label={name} selected={selected} disabled={readOnly} />
        <div className="flex w-full items-start gap-[22px]">
          <Capture
            name={name}
            on
            interactive
            disabled={readOnly}
            onToggleOn={(on) => editEnabled(9, on)}
            className="w-[clamp(104px,calc((100vh-490px-var(--rig-banner,0px))*0.38),140px)] flex-none drop-shadow-[0_18px_24px_rgb(0_0_0/0.6)]"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-lg bg-[rgb(10_10_12/0.66)] px-4 py-3.5 [@media(max-height:820px)]:gap-2.5 [@media(max-height:820px)]:px-3.5 [@media(max-height:820px)]:py-2.5">
            <div className="flex flex-col gap-1">
              <b className="text-[15px] leading-tight font-semibold text-silkscreen">{name}</b>
              <span className="text-xs text-silkscreen-3">SnapTone slot {block.fxid & 0xff}, playing in place of the amp and cab</span>
            </div>
            <div className="flex justify-between border-t border-seam pt-3 [@media(max-height:820px)]:pt-2">
              {knobs.map((k) => (
                <Dial
                  key={k.id}
                  label={paramTitle(k.label)}
                  ariaLabel={`${name} ${paramTitle(k.label)}`}
                  value={k.value}
                  spec={k}
                  size={short ? 34 : 46}
                  color="var(--block-ns)"
                  disabled={readOnly}
                  onChange={(v) => editParam(9, Number(k.id), v)}
                  className="w-[58px]"
                />
              ))}
            </div>
          </div>
        </div>
        <SlotFoot block={block} readOnly={readOnly} text={stateLine(block)} />
      </div>
    </BlockMenu>
  );
}
