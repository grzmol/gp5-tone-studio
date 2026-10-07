import { useState } from "react";
import { CheckIcon, ChevronDownIcon, EllipsisIcon, GitCompareArrowsIcon, Redo2Icon, SaveIcon, Undo2Icon, XIcon } from "lucide-react";
import { keyLabel } from "@/app/keys";
import { notifyError, notifySuccess, notifyWriteDone } from "@/app/notify";
import { ConfirmWriteDialog } from "@/components/write/ConfirmWriteDialog";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { useCommand } from "@/state/ui";
import { playPreset, redo, undo } from "./edits";
import { useHistory } from "./history";
import { useRig } from "./rig-store";

const pad = (n: number) => String(n).padStart(2, "0");
/** overlays.md F: 10 printable ASCII characters. */
const NAME_MAX = 10;
const BAD_CHAR = /[^\x20-\x7e]/;

interface Props {
  preset: PresetState;
  connected: boolean;
}

/** Preset name, unsaved count, tempo, FS chips; undo/redo, Compare with saved, Discard, Save split button. */
export function RigHeader({ preset, connected }: Props) {
  const saved = useDevice((s) => s.saved);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const busy = useDevice((s) => s.busy);
  const names = useDevice((s) => s.names);
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);
  const compare = useRig((s) => s.compare);
  const comparing = useRig((s) => s.comparing);
  const [target, setTarget] = useState<number | null>(null);
  const [slotPicker, setSlotPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const live = connected && !busy;
  const editable = live && !compare && !comparing;
  const shownChanges = compare ? compare.changes : unsaved;

  const toggleCompare = async () => {
    const rig = useRig.getState();
    const d = useDevice.getState();
    if (rig.comparing || !d.preset || !d.saved) return;
    useRig.setState({ comparing: true });
    try {
      if (rig.compare) {
        await playPreset(rig.compare.edited);
        useRig.setState({ compare: null });
      } else {
        useRig.setState({ compare: { edited: d.preset, changes: d.unsavedChanges } });
        await playPreset(d.saved);
      }
    } catch (e) {
      notifyError("Couldn't compare with the saved preset", e);
    } finally {
      useRig.setState({ comparing: false });
    }
  };

  const discard = async () => {
    try {
      useRig.setState({ compare: null });
      await useDevice.getState().discard();
      useHistory.getState().clear();
    } catch (e) {
      notifyError("Couldn't discard the changes", e, discard);
    }
  };

  const exportPrst = async () => {
    try {
      const where = await host.files.exportPresets([{ fileName: `${pad(preset.slot)}-${preset.name.trim() || "Preset"}.prst`, prst: preset.prst }]);
      if (where) notifySuccess(`Exported ${preset.name}`, where);
    } catch (e) {
      notifyError("Couldn't export the preset", e);
    }
  };

  const saveTarget = (slot: number) => {
    if (!editable) return;
    setTarget(slot);
  };

  // Registered whenever the Rig can act (not only when there is something to do): an unhandled command is
  // queued by the shell and would fire later.
  useCommand("undo", () => void undo(), editable);
  useCommand("redo", () => void redo(), editable);
  useCommand("compare-with-saved", () => void ((useDevice.getState().unsavedChanges > 0 || useRig.getState().compare) && toggleCompare()), live);
  useCommand("discard-changes", () => void ((useDevice.getState().unsavedChanges > 0 || useRig.getState().compare) && discard()), live);
  useCommand("save-to-slot", () => saveTarget(preset.slot), editable);
  useCommand("rename-slot", () => setRenaming(true), editable);

  const writeTitle =
    target === null
      ? ""
      : target === preset.slot
        ? `Overwrite ${saved?.name ?? preset.name} in slot ${pad(target)}?`
        : `Write ${preset.name} to slot ${pad(target)}?`;
  const replacingName = target === null ? "" : target === preset.slot ? (saved?.name ?? preset.name) : (names[target]?.name ?? "");

  return (
    <div className="flex items-center gap-6 px-7 pt-4 pb-3 max-[1320px]:gap-4 [@media(max-height:820px)]:pt-2.5 [@media(max-height:820px)]:pb-2">
      <div className="min-w-0">
        {renaming ? (
          <RenameField preset={preset} onDone={() => setRenaming(false)} />
        ) : (
          <h1
            className={cn("m-0 truncate text-[32px] leading-[1.05] font-bold tracking-[-0.02em]", !connected && "text-silkscreen-2")}
            onDoubleClick={() => editable && setRenaming(true)}
          >
            <span className="mr-3 font-semibold text-silkscreen-4">{pad(preset.slot)}</span>
            {preset.name}
          </h1>
        )}
        <div className="mt-2 flex items-center gap-[18px] text-sm whitespace-nowrap text-silkscreen-3 max-[1320px]:gap-3.5">
          {shownChanges > 0 ? (
            <span className="flex items-center gap-1.5 font-semibold text-silkscreen">
              <span className="size-1.5 rounded-full bg-led-warn" aria-hidden />
              {shownChanges === 1 ? "1 unsaved change" : `${shownChanges} unsaved changes`}
              {compare && <span className="font-normal text-silkscreen-3">· playing the saved version</span>}
            </span>
          ) : (
            <span>No unsaved changes</span>
          )}
          <span className="flex items-center gap-1.5">
            Tempo <b className="font-semibold text-silkscreen">{preset.bpm} BPM</b>
          </span>
          <FsChips label="FS1" blocks={preset.footswitches.fs1} preset={preset} />
          <FsChips label="FS2" blocks={preset.footswitches.fs2} preset={preset} />
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <IconTip label="Undo" keys={["Mod", "Z"]}>
          <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!editable || !canUndo} onClick={() => void undo()}>
            <Undo2Icon aria-hidden />
          </Button>
        </IconTip>
        <IconTip label="Redo" keys={["Mod", "Shift", "Z"]}>
          <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!editable || !canRedo} onClick={() => void redo()}>
            <Redo2Icon aria-hidden />
          </Button>
        </IconTip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              aria-label="Compare with saved"
              aria-pressed={!!compare}
              disabled={!live || comparing || (!compare && unsaved === 0)}
              onClick={() => void toggleCompare()}
              className={cn("max-[1320px]:w-[34px] max-[1320px]:px-0", compare && "bg-silkscreen text-lamp-ink hover:bg-silkscreen/90")}
            >
              <GitCompareArrowsIcon aria-hidden />
              <span className="max-[1320px]:hidden">{compare ? "Back to your edits" : "Compare with saved"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="min-[1321px]:hidden">{compare ? "Back to your edits" : "Compare with saved"}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" className="max-[1320px]:hidden" disabled={!live || (unsaved === 0 && !compare)} onClick={() => void discard()}>
          Discard
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions" className="min-[1321px]:hidden">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!live || (unsaved === 0 && !compare)} onSelect={() => void discard()}>
              Discard changes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={connected ? -1 : 0}>
                <Button disabled={!editable} onClick={() => saveTarget(preset.slot)} className="rounded-r-none pr-3">
                  <SaveIcon aria-hidden />
                  {busy?.kind === "write" ? `Writing ${Math.round(busy.progress * 100)}%` : `Save to slot ${pad(preset.slot)}`}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{!connected ? "Connect the GP-5 to save" : compare ? "Go back to your edits to save" : keyLabel(["Mod", "S"])}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="More save options" className="rounded-l-none border-l border-black/15 px-2.5">
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={!editable} onSelect={() => saveTarget(preset.slot)}>
                Save to slot {pad(preset.slot)}
                <DropdownMenuShortcut>{keyLabel(["Mod", "S"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => setSlotPicker(true)}>
                Save to another slot…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => setRenaming(true)}>
                Rename on pedal…
                <DropdownMenuShortcut>F2</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void exportPrst()}>Export .prst…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CommandDialog open={slotPicker} onOpenChange={setSlotPicker} title="Save to another slot" description="Pick the slot to write this preset to">
        <CommandInput placeholder="Find a slot by number or name" />
        <CommandList className="max-h-[360px]">
          <CommandEmpty>No slot matches</CommandEmpty>
          <CommandGroup heading="GP-5 slots">
            {names.map((n) => (
              <CommandItem
                key={n.slot}
                value={`${pad(n.slot)} ${n.name}`}
                disabled={n.slot === preset.slot}
                onSelect={() => {
                  setSlotPicker(false);
                  saveTarget(n.slot);
                }}
              >
                <span className="w-6 font-semibold text-silkscreen-3 tabular-nums">{pad(n.slot)}</span>
                <span className="flex-1 truncate">{n.name}</span>
                {n.slot === preset.slot && <span className="text-xs text-silkscreen-3">This preset</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {target !== null && (
        <ConfirmWriteDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={writeTitle}
          slot={target}
          replacing={replacingName.trim() ? { name: replacingName, detail: target === preset.slot ? `Saved version of ${replacingName}` : undefined } : null}
          incoming={{ name: preset.name, detail: unsaved > 0 ? `As edited now, including ${unsaved === 1 ? "1 unsaved change" : `${unsaved} unsaved changes`}` : "As shown on the Rig", prst: preset.prst }}
          action={`Write to slot ${pad(target)}`}
          onConfirm={async ({ backupFirst }) => {
            const slot = target;
            await useDevice.getState().saveToSlot(slot);
            useHistory.getState().clear();
            notifyWriteDone({ name: preset.name, slot, backedUp: backupFirst });
          }}
        />
      )}
    </div>
  );
}

function IconTip({ label, keys, children }: { label: string; keys: string[]; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label} <span className="text-silkscreen-3">{keyLabel(keys)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function FsChips({ label, blocks, preset }: { label: string; blocks: number[]; preset: PresetState }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <span className="flex gap-1">
        {blocks.length === 0 && <span className="text-silkscreen-4">none</span>}
        {blocks.map((b) => {
          const code = preset.blocks[b]?.code ?? "?";
          return (
            <span key={b} className="inline-flex h-5 items-center gap-[5px] rounded-pill px-[7px] text-xs font-semibold text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
              <span className="size-1.5 rounded-full" style={{ background: `var(--block-${code.toLowerCase()})` }} />
              {code}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** overlays.md F: inline rename with a 10-character counter; commits on the pedal immediately. */
function RenameField({ preset, onDone }: { preset: PresetState; onDone(): void }) {
  const [value, setValue] = useState(preset.name.trimEnd());
  const [busy, setBusy] = useState(false);
  const bad = BAD_CHAR.exec(value)?.[0];
  const trimmed = value.trimEnd();
  const error = bad ? `The GP-5 can't show “${bad}”. Use letters A to Z, digits, spaces and keyboard symbols.` : trimmed === "" ? "A slot needs a name." : null;
  const atLimit = value.length >= NAME_MAX;
  const slot = preset.slot;
  const before = preset.name;

  const commit = async () => {
    if (error || busy) return;
    if (trimmed === before.trimEnd()) return onDone();
    setBusy(true);
    try {
      await useDevice.getState().rename(slot, trimmed);
      notifySuccess(`Slot ${pad(slot)} renamed to ${trimmed}`, undefined, {
        label: "Undo",
        run: () => useDevice.getState().rename(slot, before.trimEnd()),
      });
      onDone();
    } catch (e) {
      notifyError(`Couldn't rename slot ${pad(slot)}`, e);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[32px] leading-[1.05] font-semibold text-silkscreen-4">{pad(slot)}</span>
        <input
          autoFocus
          aria-label={`Name of slot ${pad(slot)}`}
          aria-invalid={!!error}
          value={value}
          maxLength={NAME_MAX}
          disabled={busy}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") onDone();
          }}
          onBlur={(e) => {
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) onDone();
          }}
          className={cn(
            "h-10 w-[240px] rounded-sm bg-well px-3 text-[26px] font-bold text-silkscreen shadow-[inset_0_0_0_1px_var(--glass-edge)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--silkscreen)]",
            error && "shadow-[inset_0_0_0_1.5px_var(--led-fault)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--led-fault)]",
          )}
        />
        <span className={cn("text-xs tabular-nums", atLimit ? "text-led-warn" : "text-silkscreen-3")}>
          {value.length}/{NAME_MAX}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Rename on pedal" disabled={!!error || busy} onClick={() => void commit()}>
          <CheckIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={onDone}>
          <XIcon aria-hidden />
        </Button>
      </div>
      <span role={error ? "alert" : undefined} className={cn("text-xs", error ? "text-led-fault" : "text-led-warn")}>
        {error ?? (atLimit ? "The GP-5 stores 10 characters. Further typing is ignored." : "")}
      </span>
    </div>
  );
}
