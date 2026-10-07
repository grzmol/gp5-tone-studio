import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowDownToLineIcon, ArrowUpDownIcon, CopyIcon, DownloadIcon, FolderPlusIcon, GripVerticalIcon, HardDriveDownloadIcon, InfoIcon, MoveIcon, PencilIcon, PlayIcon, SearchIcon, Trash2Icon, UnplugIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MiniChain } from "@/components/write/MiniChain";
import { ampOrSnapTone, summarize, type PresetSummary } from "@/components/write/preset-summary";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import type { SlotName } from "@/state/device-types";
import { knownBody, useLibraryActions } from "./actions";
import { endDrag, hasFiles, LOCAL_MIME, SLOTS_MIME, startDrag } from "./dnd";
import { writableCollections } from "./LocalPane";
import { isEmptyName, useLibrary, type SlotFilter } from "./store";

const COLS = "grid grid-cols-[16px_22px_minmax(96px,128px)_160px_minmax(0,1fr)_96px] items-center gap-3";

/** Slots copied with Ctrl C (pasted onto the focused slot with Ctrl V). */
let clipboard: number[] = [];

interface RowData {
  slot: number;
  name: string;
  empty: boolean;
  summary: PresetSummary | null;
}

/** Can the pedal be written now (connected, idle)? */
function useWritable() {
  return useDevice((s) => s.status === "connected" && s.busy === null);
}

export function SlotList({ sheetMode }: { sheetMode: boolean }) {
  const names = useDevice((s) => s.names);
  const status = useDevice((s) => s.status);
  const activeSlot = useDevice((s) => s.slot);
  const saved = useDevice((s) => s.saved);
  const snapTones = useDevice((s) => s.snapTones);
  const bodies = useLibrary((s) => s.bodies);
  const filter = useLibrary((s) => s.slotFilter);
  const query = useLibrary((s) => s.slotQuery);
  const selected = useLibrary((s) => s.selected);
  const focus = useLibrary((s) => s.focus);
  const drag = useLibrary((s) => s.drag);
  const actions = useLibraryActions();
  const writable = useWritable();
  const connected = status === "connected";
  const gridRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");

  const rows: RowData[] = useMemo(
    () =>
      names.map((n: SlotName) => {
        const empty = isEmptyName(n.name);
        const body = n.slot === activeSlot && saved ? saved.prst : bodies[n.slot]?.prst;
        const summary = body ? summarize(body) : null;
        // A body read under another name is stale (the slot was rewritten elsewhere).
        return { slot: n.slot, name: n.name, empty, summary: summary && summary.name === n.name ? summary : null };
      }),
    [names, bodies, activeSlot, saved],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "used" && r.empty) return false;
      if (filter === "empty" && !r.empty) return false;
      if (!q) return true;
      const lead = r.summary ? ampOrSnapTone(r.summary, snapTones)?.title : undefined;
      return r.name.toLowerCase().includes(q) || String(r.slot).padStart(2, "0").includes(q) || (lead?.toLowerCase().includes(q) ?? false);
    });
  }, [rows, filter, query, snapTones]);

  const used = rows.filter((r) => !r.empty).length;
  const selSet = new Set(selected);
  const visibleSelected = visible.filter((r) => selSet.has(r.slot)).length;
  const lib = useLibrary.getState;

  useEffect(() => {
    if (focus === null) return;
    document.getElementById(`slot-row-${focus}`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const clickRow = (e: MouseEvent, slot: number) => {
    const { anchor } = lib();
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < slot ? [anchor, slot] : [slot, anchor];
      lib().select(visible.filter((r) => r.slot >= a && r.slot <= b).map((r) => r.slot), { focus: slot });
    } else if (e.ctrlKey || e.metaKey) {
      lib().select(selSet.has(slot) ? selected.filter((s) => s !== slot) : [...selected, slot], { anchor: slot, focus: slot });
    } else {
      lib().select([slot], { anchor: slot, focus: slot });
      if (sheetMode) useLibrary.setState({ sheetOpen: true });
    }
  };

  const toggleRow = (slot: number) => lib().select(selSet.has(slot) ? selected.filter((s) => s !== slot) : [...selected, slot], { anchor: slot, focus: slot });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!visible.length) return;
    const idx = Math.max(0, visible.findIndex((r) => r.slot === focus));
    const mod = e.ctrlKey || e.metaKey;
    const move = (delta: number) => {
      const next = visible[Math.min(visible.length - 1, Math.max(0, (focus === null ? -1 : idx) + delta))]?.slot ?? visible[0].slot;
      if (e.shiftKey) {
        const anchor = lib().anchor ?? next;
        const [a, b] = anchor < next ? [anchor, next] : [next, anchor];
        lib().select(visible.filter((r) => r.slot >= a && r.slot <= b).map((r) => r.slot), { focus: next });
      } else lib().select([next], { anchor: next, focus: next });
    };
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      if (!selected.length || !writable) return;
      const target = selected[0] + (e.key === "ArrowUp" ? -1 : 1);
      if (target >= 0 && target + selected.length <= 100) actions.moveSlots(selected, target);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return move(1);
      case "ArrowUp":
        e.preventDefault();
        return move(-1);
      case "Home":
        e.preventDefault();
        return move(-1000);
      case "End":
        e.preventDefault();
        return move(1000);
      case " ":
        e.preventDefault();
        if (focus !== null) toggleRow(focus);
        return;
      case "Enter":
        e.preventDefault();
        if (focus !== null && connected) actions.play(focus);
        return;
      case "Delete":
      case "Backspace":
        if (selected.length && writable) {
          e.preventDefault();
          actions.clearSlots(selected);
        }
        return;
      case "F2":
        e.preventDefault();
        if (focus !== null && connected) useLibrary.setState({ selected: [focus], sheetOpen: sheetMode, renaming: focus });
        return;
      case "Escape":
        if (lib().sheetOpen) useLibrary.setState({ sheetOpen: false });
        else lib().select([], { anchor: null });
        return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      lib().select(visible.map((r) => r.slot));
    } else if (mod && e.key.toLowerCase() === "c" && selected.length) {
      e.preventDefault();
      clipboard = selected;
      setAnnounce(`Copied ${selected.length === 1 ? `slot ${selected[0]}` : `${selected.length} slots`}. Focus a slot and press Ctrl V to paste.`);
    } else if (mod && e.key.toLowerCase() === "v" && clipboard.length && focus !== null && writable) {
      e.preventDefault();
      actions.copySlots(clipboard, focus);
    }
  };

  // ---- drop targets
  const canDrop = (e: DragEvent, slot: number) => {
    if (!writable) return false;
    if (drag?.kind === "local") return e.dataTransfer.types.includes(LOCAL_MIME);
    if (drag?.kind === "slots") return e.dataTransfer.types.includes(SLOTS_MIME) && !drag.slots.includes(slot);
    return hasFiles(e);
  };
  const onDragOver = (e: DragEvent, slot: number) => {
    if (!canDrop(e, slot)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = drag?.kind === "slots" && !e.altKey ? "move" : "copy";
    if (over !== slot) {
      setOver(slot);
      const row = rows[slot];
      const what = drag?.kind === "local" ? drag.preset.name : drag?.kind === "slots" ? (drag.slots.length === 1 ? rows[drag.slots[0]]?.name : `${drag.slots.length} slots`) : "the file";
      setAnnounce(`Drop to ${row?.empty ? "write" : "replace"} ${what} ${row?.empty ? "to" : "in"} slot ${slot}`);
    }
  };
  const onDrop = (e: DragEvent, slot: number) => {
    setOver(null);
    if (!canDrop(e, slot)) return;
    e.preventDefault();
    e.stopPropagation();
    const d = lib().drag;
    endDrag();
    if (d?.kind === "local") actions.writeLocal(d.preset, slot);
    else if (d?.kind === "slots") (e.altKey ? actions.copySlots : actions.moveSlots)(d.slots, slot);
    else if (hasFiles(e)) void actions.importDropped(Array.from(e.dataTransfer.files), slot);
  };

  const loading = !names.length && (status === "connecting" || status === "idle");
  const head = (
    <div className="flex min-h-8 items-center gap-3 px-2">
      <h2 className="text-[15px] font-[650] whitespace-nowrap text-silkscreen">On GP-5</h2>
      {names.length > 0 && (
        <span className="text-sm whitespace-nowrap text-silkscreen-3">
          {used} used, {rows.length - used} empty
        </span>
      )}
      <span className="flex-1" />
      <Tabs value={filter} onValueChange={(v) => useLibrary.setState({ slotFilter: v as SlotFilter })}>
        <TabsList aria-label="Show">
          <TabsTrigger value="all">All {rows.length || 100}</TabsTrigger>
          <TabsTrigger value="used">Used</TabsTrigger>
          <TabsTrigger value="empty">Empty</TabsTrigger>
        </TabsList>
      </Tabs>
      <InputGroup className="h-8 max-w-[188px] min-w-[132px] flex-[0_1_188px]">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Filter by name or amp" aria-label="Filter slots by name or amp" value={query} onChange={(e) => useLibrary.setState({ slotQuery: e.target.value })} />
      </InputGroup>
    </div>
  );

  return (
    <section aria-label="On GP-5" className="glass relative flex min-h-0 min-w-0 flex-col rounded-xl px-2 pt-3.5 pb-2">
      {head}
      {status !== "connected" && names.length > 0 && <OfflineBanner />}
      <BulkBar visible={visible.map((r) => r.slot)} visibleSelected={visibleSelected} sheetMode={sheetMode} />
      <div
        ref={gridRef}
        role="grid"
        aria-label="Preset slots"
        aria-multiselectable="true"
        aria-rowcount={visible.length}
        aria-activedescendant={focus !== null ? `slot-row-${focus}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => focus === null && visible[0] && lib().select(selected, { focus: visible[0].slot })}
        className="flex min-h-0 flex-1 flex-col rounded-sm focus-visible:outline-none"
      >
        <div role="row" className={cn(COLS, "h-[30px] shrink-0 pr-2.5 pl-2 text-xs font-medium tracking-[0.04em] text-silkscreen-3 uppercase")}>
          <span role="columnheader" aria-label="Selected" />
          <span role="columnheader">Slot</span>
          <span role="columnheader">Name</span>
          <span role="columnheader">Chain</span>
          <span role="columnheader">Amp or SnapTone</span>
          <span role="columnheader" aria-label="Status" />
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto", status !== "connected" && "opacity-60")} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}>
          {loading && Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="mx-2 my-1 h-6" />)}
          {!loading && !names.length && (
            <p className="px-3 py-6 text-sm text-silkscreen-3">Connect the GP-5 to see its 100 slots. Presets on this computer work without it.</p>
          )}
          {names.length > 0 && !visible.length && (
            <p className="px-3 py-6 text-sm text-silkscreen-3">
              No slots match “{query || filter}”.{" "}
              <button type="button" className="text-silkscreen underline underline-offset-2" onClick={() => useLibrary.setState({ slotQuery: "", slotFilter: "all" })}>
                Clear filter
              </button>
            </p>
          )}
          {visible.map((r) => (
            <SlotRow
              key={r.slot}
              row={r}
              selected={selSet.has(r.slot)}
              focused={focus === r.slot}
              active={r.slot === activeSlot && connected}
              drop={over === r.slot}
              draggable={writable}
              onClick={clickRow}
              onToggle={toggleRow}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          ))}
        </div>
      </div>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </section>
  );
}

function OfflineBanner() {
  const status = useDevice((s) => s.status);
  const error = useDevice((s) => s.error);
  const busyPort = error?.code === "busy";
  return (
    <Alert className="mx-2 mt-2.5 w-auto">
      <UnplugIcon />
      <AlertTitle>{busyPort ? "Another app is using the GP-5" : "GP-5 not connected"}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-x-2">
        {busyPort
          ? "Close Valeton Suite, then reconnect. Showing the slots from the last connection."
          : `Showing the slots as of the last connection.${status === "connecting" ? " Connecting…" : " Connect the pedal to write."}`}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => useNav.getState().go("device")}>
          Open Device
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function BulkBar({ visible, visibleSelected, sheetMode }: { visible: number[]; visibleSelected: number; sheetMode: boolean }) {
  const selected = useLibrary((s) => s.selected);
  const sheetOpen = useLibrary((s) => s.sheetOpen);
  const names = useDevice((s) => s.names);
  const connected = useDevice((s) => s.status === "connected");
  const writable = useWritable();
  const actions = useLibraryActions();
  const n = selected.length;
  const allUsedEmpty = selected.every((s) => isEmptyName(names[s]?.name));
  const readable = connected || selected.every((s) => knownBody(s) !== null);
  const checked = visibleSelected === 0 ? false : visibleSelected === visible.length ? true : "indeterminate";
  const swapTip = n === 2 ? `Swap slots ${selected[0]} and ${selected[1]}` : "Select two slots to swap them";

  return (
    <div role="toolbar" aria-label="Selected slots" className="mt-2.5 flex h-11 shrink-0 items-center gap-0.5 border-y border-border px-1.5">
      <Checkbox
        className="mr-2 ml-2.5"
        aria-label="Select all slots in this list"
        checked={checked}
        onCheckedChange={() => useLibrary.getState().select(checked === true ? [] : visible)}
      />
      <span className="mr-1.5 ml-0.5 text-sm font-semibold whitespace-nowrap text-silkscreen">{n ? `${n} selected` : "None selected"}</span>
      <Button variant="ghost" size="sm" disabled={!n || !readable} onClick={() => void actions.backupSlots(selected)}>
        <HardDriveDownloadIcon data-icon="inline-start" />
        Back up
      </Button>
      <Button variant="ghost" size="sm" disabled={!n || !readable} onClick={() => void actions.exportSlots(selected)}>
        <DownloadIcon data-icon="inline-start" />
        Export
      </Button>
      <Separator orientation="vertical" className="mx-0.5 my-3 data-[orientation=vertical]:h-5" />
      <Button variant="ghost" size="sm" disabled={!n || !writable || allUsedEmpty} onClick={() => actions.copySlots(selected)}>
        <CopyIcon data-icon="inline-start" />
        Copy to…
      </Button>
      <Button variant="ghost" size="sm" disabled={!n || !writable} onClick={() => actions.moveSlots(selected)}>
        <MoveIcon data-icon="inline-start" />
        Move to…
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span keeps the tooltip working while the button is disabled */}
          <span tabIndex={n === 2 && writable ? -1 : 0}>
            <Button variant="ghost" size="sm" disabled={n !== 2 || !writable} onClick={() => actions.swapSlots(selected[0], selected[1])}>
              <ArrowUpDownIcon data-icon="inline-start" />
              Swap
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{swapTip}</TooltipContent>
      </Tooltip>
      <span className="flex-1" />
      <Button variant="ghost" size="sm" className="text-led-fault hover:text-led-fault" disabled={!n || !writable || allUsedEmpty} onClick={() => actions.clearSlots(selected)}>
        <Trash2Icon data-icon="inline-start" />
        Clear
      </Button>
      {sheetMode && (
        <>
          <Separator orientation="vertical" className="mx-0.5 my-3 data-[orientation=vertical]:h-5" />
          <Button
            variant="ghost"
            size="sm"
            aria-controls="library-inspector"
            aria-expanded={sheetOpen}
            onClick={() => useLibrary.setState({ sheetOpen: !useLibrary.getState().sheetOpen })}
          >
            <InfoIcon data-icon="inline-start" />
            Details
          </Button>
        </>
      )}
    </div>
  );
}

interface SlotRowProps {
  row: RowData;
  selected: boolean;
  focused: boolean;
  active: boolean;
  drop: boolean;
  draggable: boolean;
  onClick(e: MouseEvent, slot: number): void;
  onToggle(slot: number): void;
  onDragOver(e: DragEvent, slot: number): void;
  onDrop(e: DragEvent, slot: number): void;
}

const SlotRow = memo(function SlotRow({ row, selected, focused, active, drop, draggable, onClick, onToggle, onDragOver, onDrop }: SlotRowProps) {
  const drag = useLibrary((s) => (drop ? s.drag : null));
  const snapTones = useDevice((s) => s.snapTones);
  const connected = useDevice((s) => s.status === "connected");
  const writable = useWritable();
  const collections = useLibrary((s) => s.collections);
  const actions = useLibraryActions();
  const { slot, empty } = row;

  // While a local preset hovers, the row previews it.
  const incoming = drop && drag?.kind === "local" ? drag.preset : null;
  const incomingSummary = incoming ? summarize(incoming.prst) : null;
  const shown = incomingSummary ?? row.summary;
  const name = incoming ? incoming.name : empty ? "Empty" : row.name;
  const lead = shown && (!empty || incoming) ? ampOrSnapTone(shown, snapTones) : null;
  const sel = useLibrary.getState().selected;
  const dragSlots = selected ? sel : [slot];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={`slot-row-${slot}`}
          role="row"
          aria-selected={selected}
          data-name={row.name}
          draggable={draggable && !empty}
          onDragStart={(e) => startDrag(e, { kind: "slots", slots: dragSlots }, SLOTS_MIME)}
          onDragEnd={endDrag}
          onDragOver={(e) => onDragOver(e, slot)}
          onDrop={(e) => onDrop(e, slot)}
          onClick={(e) => onClick(e, slot)}
          onDoubleClick={() => connected && !empty && void actions.openInRig(slot)}
          className={cn(
            COLS,
            "group h-8 rounded-sm pr-2.5 pl-2 text-[13px] hover:bg-accent",
            selected && "bg-faceplate-raised shadow-[inset_0_0_0_1px_var(--seam-strong)] hover:bg-faceplate-raised",
            focused && "outline-2 -outline-offset-2 outline-ring [[role=grid]:not(:focus-visible)_&]:outline-none",
            drop && "bg-lamp-glow shadow-[inset_0_0_0_1.5px_var(--lamp)] hover:bg-lamp-glow",
          )}
        >
          <span role="gridcell" className="flex items-center">
            <Checkbox checked={selected} aria-label={`Select slot ${slot}`} tabIndex={-1} onClick={(e) => e.stopPropagation()} onCheckedChange={() => onToggle(slot)} />
          </span>
          <span role="gridcell" className={cn("text-sm font-semibold tabular-nums", selected ? "text-silkscreen" : "text-silkscreen-3", drop && "text-lamp", empty && !drop && "font-medium text-silkscreen-4")}>
            {String(slot).padStart(2, "0")}
          </span>
          <span role="gridcell" className={cn("truncate font-semibold text-silkscreen", empty && !incoming && "font-medium text-silkscreen-4", drop && "font-[650] text-lamp")}>
            {name}
          </span>
          <span role="gridcell" className={cn("flex", drop && "opacity-85")}>
            {empty && !incoming ? <MiniChain enabled={null} /> : <MiniChain order={shown?.order} enabled={shown ? shown.blocks.map((b) => b.enabled) : null} />}
          </span>
          <span role="gridcell" className="flex min-w-0 items-center gap-2 text-silkscreen-2">
            {lead && (
              <>
                <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", lead.kind === "snaptone" ? "bg-block-ns" : "bg-block-amp")} />
                <span className="truncate">{lead.title}</span>
                {lead.kind === "snaptone" && <span className="text-xs text-silkscreen-3">SnapTone</span>}
              </>
            )}
            {!lead && !empty && !incoming && <span className="text-xs text-silkscreen-4">Not read yet</span>}
          </span>
          <span role="gridcell" className={cn("flex items-center justify-end gap-1.5 text-xs whitespace-nowrap text-silkscreen-3", drop && "text-lamp")}>
            {drop ? (
              <>
                <ArrowDownToLineIcon className="size-3.5" aria-hidden />
                {empty ? "Drop to write" : "Drop to replace"}
              </>
            ) : active ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-led-on" />
                Active
              </>
            ) : (
              draggable && !empty && <GripVerticalIcon className="size-3.5 text-silkscreen-4 opacity-0 group-hover:opacity-100" aria-hidden />
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem disabled={!connected || active} onSelect={() => actions.play(slot)}>
            <PlayIcon />
            Play on pedal
            <ContextMenuShortcut>Enter</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!connected || empty} onSelect={() => void actions.openInRig(slot)}>
            Open in Rig
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!connected || empty}
            onSelect={() => {
              useLibrary.getState().select([slot], { anchor: slot, focus: slot });
              useLibrary.setState({ renaming: slot, sheetOpen: true });
            }}
          >
            <PencilIcon />
            {connected ? "Rename" : "Rename (needs the GP-5)"}
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem disabled={!writable || empty} onSelect={() => actions.copySlots(dragSlots)}>
            <CopyIcon />
            Copy to…
          </ContextMenuItem>
          <ContextMenuItem disabled={!writable} onSelect={() => actions.moveSlots(dragSlots)}>
            <MoveIcon />
            Move to…
          </ContextMenuItem>
          <ContextMenuItem disabled={!writable || empty} onSelect={() => actions.duplicateSlot(slot)}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem disabled={empty} onSelect={() => void actions.exportSlots(dragSlots)}>
            <DownloadIcon />
            Export .prst
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={empty}>
              <FolderPlusIcon />
              Add to collection
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuGroup>
                {writableCollections(collections).map((c) => (
                  <ContextMenuItem key={c.id} onSelect={() => void actions.addSlotsToCollection(dragSlots, c.id)}>
                    {c.title}
                  </ContextMenuItem>
                ))}
                <ContextMenuItem onSelect={() => actions.collectionDialog({ kind: "new", then: (c) => void actions.addSlotsToCollection(dragSlots, c.id) })}>
                  New collection…
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive" disabled={!writable || empty} onSelect={() => actions.clearSlots(dragSlots)}>
            <Trash2Icon />
            Clear
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
});
