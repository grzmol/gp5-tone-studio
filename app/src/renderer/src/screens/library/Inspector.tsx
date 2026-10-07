import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLineIcon, ArrowUpDownIcon, CableIcon, CopyIcon, DownloadIcon, FolderPlusIcon, HardDriveDownloadIcon, InfoIcon, PencilIcon, ScanSearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GearFor, paramTitle } from "@/components/gear";
import { MiniChain } from "@/components/write/MiniChain";
import { summarize, type PresetSummary, type SummaryBlock } from "@/components/write/preset-summary";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { BLOCK_CODES } from "@/state/device-types";
import type { LocalPreset } from "@shared/host/files";
import { useLibraryActions } from "./actions";
import { formatDay } from "./dnd";
import { writableCollections } from "./LocalPane";
import { isEmptyName, useLibrary } from "./store";

const CORE = [2, 9, 3, 4, 5];
const NAME_RE = /^[\x20-\x7E]*$/;

/** Inspector body for the current selection: one slot, several slots, or a preset on this computer. */
export function Inspector({ onClose }: { onClose?: () => void }) {
  const selected = useLibrary((s) => s.selected);
  const localSelected = useLibrary((s) => s.localSelected);
  const presets = useLibrary((s) => s.presets);
  const local = localSelected ? presets.find((p) => p.id === localSelected) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3.5">
      {onClose && (
        <Button variant="ghost" size="icon-sm" className="absolute top-0 right-0 z-10" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <XIcon />
        </Button>
      )}
      {local ? <LocalInspector p={local} /> : selected.length > 1 ? <MultiInspector slots={selected} /> : selected.length === 1 ? <SlotInspector slot={selected[0]} /> : <NothingSelected />}
    </div>
  );
}

function NothingSelected() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-1 px-2 text-center">
      <p className="font-semibold text-silkscreen">Select a slot</p>
      <p className="text-sm text-pretty text-silkscreen-3">Its chain, volume and footswitches show here. Ctrl-click or Shift-click to select several.</p>
    </div>
  );
}

function Head({ title, meta, children }: { title: ReactNode; meta: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 pr-10">
      {children ?? <h2 className="truncate text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-balance text-silkscreen">{title}</h2>}
      <p className="text-sm text-silkscreen-3">{meta}</p>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border pt-3 [&>[data-slot=button]]:w-full">{children}</div>;
}

// ------------------------------------------------------------------------------------------ one slot

function SlotInspector({ slot }: { slot: number }) {
  const names = useDevice((s) => s.names);
  const activeSlot = useDevice((s) => s.slot);
  const saved = useDevice((s) => s.saved);
  const status = useDevice((s) => s.status);
  const busy = useDevice((s) => s.busy);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const body = useLibrary((s) => s.bodies[slot]);
  const renaming = useLibrary((s) => s.renaming === slot);
  const job = useLibrary((s) => s.job);
  const actions = useLibraryActions();
  const name = names[slot]?.name ?? "GP-5";
  const empty = isEmptyName(name);
  const connected = status === "connected";
  const writable = connected && !busy;
  const active = activeSlot === slot && connected;
  const prst = activeSlot === slot && saved ? saved.prst : body?.prst;
  const parsed = prst ? summarize(prst) : null;
  const summary = parsed && parsed.name === name ? parsed : null;
  const source = activeSlot === slot && saved ? "Read from the GP-5" : body ? (body.from === "backup" ? `Chain from the backup of ${formatDay(body.at)}` : "Read from the GP-5") : null;

  return (
    <>
      <Head
        title={empty ? "Empty slot" : name}
        meta={
          <>
            Slot {slot} on GP-5{active && ", playing now"}
          </>
        }
      >
        {renaming ? (
          <RenameField slot={slot} name={name} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-silkscreen">{empty ? "Empty slot" : name}</h2>
            {!empty && (
              <Button variant="ghost" size="icon-sm" aria-label="Rename" title={connected ? "Rename (F2)" : "Rename needs the GP-5"} disabled={!connected} onClick={() => useLibrary.setState({ renaming: slot })}>
                <PencilIcon />
              </Button>
            )}
          </div>
        )}
      </Head>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        {empty ? (
          <p className="text-sm text-pretty text-silkscreen-3">This slot holds the factory empty preset. Drag a preset here, or use Copy to… on another slot.</p>
        ) : summary ? (
          <>
            <ChainPreview s={summary} />
            <Patch s={summary} />
            {source && <p className="text-xs text-silkscreen-3">{source}</p>}
          </>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-well p-3.5 text-sm">
            <p className="text-pretty text-silkscreen-2">The chain of this slot hasn't been read yet. Back up now reads every slot; reading just this one switches the pedal to it for a moment and back.</p>
            <Button variant="outline" size="sm" disabled={!writable || unsaved > 0 || job !== null} onClick={() => void actions.readSlot(slot)}>
              <ScanSearchIcon data-icon="inline-start" />
              {job ? "Reading…" : "Read from GP-5"}
            </Button>
            {unsaved > 0 && <p className="text-xs text-silkscreen-3">Save or discard your unsaved changes on the Rig first.</p>}
          </div>
        )}
      </div>

      <Actions>
        <Button disabled={!connected || empty} onClick={() => void actions.openInRig(slot)}>
          <CableIcon data-icon="inline-start" />
          Open in Rig
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!writable || empty} onClick={() => actions.copySlots([slot])}>
            <ArrowDownToLineIcon data-icon="inline-start" />
            Copy to…
          </Button>
          <Button variant="outline" disabled={!writable || empty} onClick={() => actions.duplicateSlot(slot)}>
            <CopyIcon data-icon="inline-start" />
            Duplicate
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={empty || (!connected && !summary)} onClick={() => void actions.exportSlots([slot])}>
            <DownloadIcon data-icon="inline-start" />
            Export .prst
          </Button>
          <AddToCollection disabled={empty || (!connected && !summary)} onAdd={(id) => void actions.addSlotsToCollection([slot], id)} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-led-fault hover:text-led-fault"
            aria-label={`Clear slot ${slot}`}
            title={`Clear slot ${slot}`}
            disabled={!writable || empty}
            onClick={() => actions.clearSlots([slot])}
          >
            <Trash2Icon />
          </Button>
        </div>
      </Actions>
    </>
  );
}

function RenameField({ slot, name }: { slot: number; name: string }) {
  const [value, setValue] = useState(name);
  const actions = useLibraryActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  useEffect(() => inputRef.current?.select(), []);
  const trimmed = value.replace(/\s+$/, "");
  const bad = [...value].find((c) => !NAME_RE.test(c));
  const error = bad ? `The GP-5 can't show “${bad}”. Use letters A to Z, digits, spaces and keyboard symbols.` : trimmed ? null : "A slot needs a name.";
  const cancel = () => useLibrary.setState({ renaming: null });
  const commit = () => {
    if (error || trimmed === name) return cancel();
    cancel();
    actions.renameSlot(slot, trimmed);
  };
  return (
    <Field data-invalid={error ? true : undefined} className="gap-1.5">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          maxLength={10}
          aria-label={`New name for slot ${slot}`}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setValue(e.target.value.slice(0, 10))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Keep Enter from also activating the confirmation dialog's focused button.
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              cancel();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" disabled={!!error || trimmed === name} onClick={commit}>
          Rename
        </Button>
        <Button variant="ghost" size="icon" aria-label="Cancel rename" onClick={cancel}>
          <XIcon />
        </Button>
      </div>
      {error ? (
        <FieldError id={hintId}>{error}</FieldError>
      ) : (
        <div id={hintId} className="flex justify-between gap-3 text-xs text-silkscreen-3">
          <span className="text-pretty">{value.length >= 10 ? "The GP-5 stores 10 characters. Further typing is ignored." : "The GP-5 shows up to 10 characters."}</span>
          <span className={cn("tabular-nums", value.length >= 10 && "text-led-warn")}>{value.length}/10</span>
        </div>
      )}
    </Field>
  );
}

// ------------------------------------------------------------------------------------------ several slots

function MultiInspector({ slots }: { slots: number[] }) {
  const names = useDevice((s) => s.names);
  const writable = useDevice((s) => s.status === "connected" && s.busy === null);
  const connected = useDevice((s) => s.status === "connected");
  const bodies = useLibrary((s) => s.bodies);
  const actions = useLibraryActions();
  const both = slots.length === 2;
  const usedSlots = slots.filter((s) => !isEmptyName(names[s]?.name));

  return (
    <>
      <Head title={`${slots.length} slots selected`} meta="On GP-5" />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        <ul className="flex flex-col gap-0.5 rounded-lg bg-well p-1.5">
          {slots.map((slot) => {
            const name = names[slot]?.name ?? "GP-5";
            const s = bodies[slot] ? summarize(bodies[slot].prst) : null;
            const ok = s && s.name === name;
            return (
              <li key={slot} className="grid h-8 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 px-1.5 text-[13px]">
                <span className="text-sm font-semibold text-silkscreen-3 tabular-nums">{String(slot).padStart(2, "0")}</span>
                <span className={cn("truncate font-semibold text-silkscreen", isEmptyName(name) && "font-medium text-silkscreen-4")}>{isEmptyName(name) ? "Empty" : name}</span>
                <MiniChain order={ok ? s.order : undefined} enabled={ok ? s.blocks.map((b) => b.enabled) : null} />
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-pretty text-silkscreen-3">
          {both ? "Swapping writes both slots on the pedal." : "Copying, moving and clearing write these slots on the pedal."} You confirm before anything is stored.
        </p>
      </div>
      <Actions>
        {both ? (
          <Button disabled={!writable} onClick={() => actions.swapSlots(slots[0], slots[1])}>
            <ArrowUpDownIcon data-icon="inline-start" />
            Swap slots {slots[0]} and {slots[1]}
          </Button>
        ) : (
          <Button disabled={!writable || !usedSlots.length} onClick={() => actions.copySlots(slots)}>
            <CopyIcon data-icon="inline-start" />
            Copy {slots.length} slots to…
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!connected} onClick={() => void actions.backupSlots(slots)}>
            <HardDriveDownloadIcon data-icon="inline-start" />
            {both ? "Back up both" : `Back up ${slots.length}`}
          </Button>
          <Button variant="outline" disabled={!connected} onClick={() => void actions.exportSlots(slots)}>
            <DownloadIcon data-icon="inline-start" />
            {both ? "Export both" : `Export ${slots.length}`}
          </Button>
        </div>
        <div className="flex gap-1">
          <AddToCollection disabled={!connected} onAdd={(id) => void actions.addSlotsToCollection(slots, id)} />
          <Button variant="ghost" size="sm" className="ml-auto text-led-fault hover:text-led-fault" disabled={!writable || !usedSlots.length} onClick={() => actions.clearSlots(slots)}>
            <Trash2Icon data-icon="inline-start" />
            Clear {usedSlots.length === 1 ? "1 slot" : `${usedSlots.length} slots`}
          </Button>
        </div>
      </Actions>
    </>
  );
}

// ------------------------------------------------------------------------------------------ a preset on this computer

function LocalInspector({ p }: { p: LocalPreset }) {
  const collections = useLibrary((s) => s.collections);
  const writable = useDevice((s) => s.status === "connected" && s.busy === null);
  const actions = useLibraryActions();
  const collection = collections.find((c) => c.id === p.collectionId);
  const s = summarize(p.prst);
  const restore = collection?.kind === "backup" && p.slot !== null;

  return (
    <>
      <Head title={p.name} meta={`${collection?.title ?? "This computer"}, ${p.fileName}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        {s ? (
          <>
            {s.device === "gp50" && (
              <p className="flex items-start gap-1.5 text-sm text-pretty text-silkscreen-2">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Made on a GP-50. Converted for the GP-5 when you write it{s.gp50Only.length ? `; ${s.gp50Only.join(", ")} has no GP-5 equivalent and is left empty.` : "."}
              </p>
            )}
            <ChainPreview s={s} />
            <Patch s={s} />
            {p.source && <p className="text-xs text-silkscreen-3">From {p.source}, added {formatDay(p.addedAt)}</p>}
          </>
        ) : (
          <p className="text-sm text-led-fault">This file can't be read as a GP-5 or GP-50 preset.</p>
        )}
      </div>
      <Actions>
        <Button disabled={!writable || !s} onClick={() => actions.writeLocal(p)}>
          <ArrowDownToLineIcon data-icon="inline-start" />
          {restore ? `Restore to slot ${p.slot}…` : "Write to slot…"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void actions.exportLocal([p])}>
            <DownloadIcon data-icon="inline-start" />
            Export .prst
          </Button>
          <AddToCollection variant="outline" exclude={p.collectionId} onAdd={(id) => void actions.addLocalToCollection([p], id)} />
        </div>
        {collection && collection.kind !== "backup" && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="ml-auto text-led-fault hover:text-led-fault" onClick={() => void actions.removeLocal(p)}>
              <Trash2Icon data-icon="inline-start" />
              Remove from {collection.title}
            </Button>
          </div>
        )}
      </Actions>
    </>
  );
}

function AddToCollection({ onAdd, disabled, exclude, variant = "ghost" }: { onAdd(id: string): void; disabled?: boolean; exclude?: string; variant?: "ghost" | "outline" }) {
  const collections = useLibrary((s) => s.collections);
  const actions = useLibraryActions();
  const targets = writableCollections(collections).filter((c) => c.id !== exclude);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={variant === "ghost" ? "sm" : "default"} disabled={disabled}>
          <FolderPlusIcon data-icon="inline-start" />
          Add to collection
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {targets.length > 0 && (
          <>
            <DropdownMenuGroup>
              {targets.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => onAdd(c.id)}>
                  {c.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => actions.collectionDialog({ kind: "new", then: (c) => onAdd(c.id) })}>New collection…</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ------------------------------------------------------------------------------------------ chain + patch

function valueText(b: SummaryBlock): string {
  const p = b.model?.params.find((x) => x.index === 0) ?? b.model?.params[0];
  if (!p) return "";
  const v = b.params[p.index];
  if (p.options?.length) return p.options[Math.round(v)] ?? "";
  const n = Number.isInteger(p.step) ? Math.round(v) : Math.round(v * 10) / 10;
  return `${paramTitle(p.name)} ${n}${p.unit ? ` ${p.unit}` : ""}`;
}

function ChainRow({ b, replaced }: { b: SummaryBlock; replaced: boolean }) {
  const wide = b.code === "AMP" || b.code === "CAB";
  return (
    <div className={cn("grid h-[30px] grid-cols-[36px_30px_minmax(0,1fr)_auto_7px] items-center gap-2 px-1 text-sm", !b.enabled && "text-silkscreen-4")}>
      <span className={cn("grid h-[29px] place-items-center overflow-hidden", !b.enabled && (replaced ? "brightness-40 saturate-0" : "brightness-55 saturate-20"))} aria-hidden>
        <GearFor block={b} className={wide ? "w-9" : "w-[19px]"} />
      </span>
      <span className={cn("text-xs font-semibold tracking-[0.04em]", b.enabled ? "text-silkscreen-2" : "text-silkscreen-4")}>{b.code}</span>
      <span className={cn("truncate", b.enabled ? "text-silkscreen" : "text-silkscreen-4")}>{b.model?.title ?? "Unknown model"}</span>
      <span className="text-xs whitespace-nowrap text-silkscreen-3">{replaced ? "Replaced" : valueText(b)}</span>
      <span className={cn("size-[7px] rounded-full", b.enabled ? "bg-led-on" : "bg-led-off")} aria-label={b.enabled ? "On" : "Off"} role="img" />
    </div>
  );
}

function ChainPreview({ s }: { s: PresetSummary }) {
  const seq = s.order.length === 10 ? s.order : [0, 1, 2, 9, 3, 4, 5, 6, 7, 8];
  const start = seq.findIndex((i) => CORE.includes(i));
  const nsOn = s.blocks[9].enabled;
  const row = (i: number) => <ChainRow key={i} b={s.blocks[i]} replaced={nsOn && (i === 3 || i === 4)} />;
  return (
    <section aria-label="Chain" className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold text-silkscreen">Chain</h3>
      <div className="flex shrink-0 flex-col rounded-lg bg-well px-1.5 py-1">
        {seq.slice(0, start).map(row)}
        <div className="my-[3px] flex flex-col border-y border-seam-strong py-[3px]">{seq.slice(start, start + 5).map(row)}</div>
        {seq.slice(start + 5).map(row)}
        {nsOn && (
          <p className="flex items-center gap-1.5 px-1.5 pt-0.5 text-xs text-silkscreen-3">
            <InfoIcon className="size-3" aria-hidden />
            SnapTone is on, so it replaces AMP and CAB.
          </p>
        )}
      </div>
    </section>
  );
}

function FsChips({ blocks }: { blocks: number[] }) {
  if (!blocks.length) return <span className="text-sm text-silkscreen-3">None</span>;
  return (
    <span className="col-span-3 flex flex-wrap gap-1">
      {blocks.map((k) => (
        <span key={k} className="inline-flex h-5 items-center gap-[5px] rounded-full px-[7px] text-xs font-semibold tracking-[0.04em] text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
          <span className="size-1.5 rounded-full" style={{ background: `var(--block-${BLOCK_CODES[k].toLowerCase()})` }} aria-hidden />
          {BLOCK_CODES[k]}
        </span>
      ))}
    </span>
  );
}

function Patch({ s }: { s: PresetSummary }) {
  const key = "text-xs font-medium tracking-[0.04em] text-silkscreen-3 uppercase";
  return (
    <dl className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <dt className={key}>Volume</dt>
      <dd className="font-semibold text-silkscreen">{s.volume}</dd>
      <dt className={key}>Tempo</dt>
      <dd className="font-semibold text-silkscreen">
        {s.bpm} <small className="text-xs font-medium text-silkscreen-3">BPM</small>
      </dd>
      <dt className={key}>FS1</dt>
      <dd className="col-span-3">
        <FsChips blocks={s.footswitches.fs1} />
      </dd>
      <dt className={key}>FS2</dt>
      <dd className="col-span-3">
        <FsChips blocks={s.footswitches.fs2} />
      </dd>
    </dl>
  );
}
