// Library actions (shared by the panes through context) and the dialogs they open.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { convertPrst } from "@/gp5/lib/prst.mjs";
import { ConfirmWriteDialog } from "@/components/write/ConfirmWriteDialog";
import { describeSummary, summarize } from "@/components/write/preset-summary";
import { describeError } from "@/components/write/write-helpers";
import { notifyError, notifySuccess, notifyWriteDone } from "@/app/notify";
import { requestPresetSwitch } from "@/app/preset-switch";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import type { OpenFile } from "@/state/ui";
import { IMPORTED_ID, type CollectionInfo, type LocalPreset, type PickedFile } from "@shared/host/files";
import { slotFileName } from "@shared/files-naming";
import { BulkWriteDialog, type BulkPlan } from "./BulkWriteDialog";
import { SlotPickerDialog, type SlotPick } from "./SlotPickerDialog";
import { CollectionDialogs, type CollectionDialog } from "./CollectionDialogs";
import { RenameConfirmDialog } from "./RenameConfirmDialog";
import { importPicked } from "./import";
import { clearSteps, copySteps, moveSteps, swapSteps } from "./plans";
import { isEmptyName, useLibrary } from "./store";

const nameOf = (slot: number) => useDevice.getState().names[slot]?.name ?? "GP-5";
const slotList = (slots: number[]) => (slots.length === 2 ? `slots ${slots[0]} and ${slots[1]}` : slots.length === 1 ? `slot ${slots[0]}` : `${slots.length} slots`);

/** Body the app knows for `slot` and still trusts (its name matches the pedal's current name). */
export function knownBody(slot: number): Uint8Array | null {
  const d = useDevice.getState();
  if (d.slot === slot && d.saved) return d.saved.prst;
  const body = useLibrary.getState().bodies[slot];
  if (!body) return null;
  return summarize(body.prst)?.name === nameOf(slot) ? body.prst : null;
}

/** Read the current preset of each slot (switches presets on the pedal); during a backup, use what is known. */
async function readSlots(slots: number[], verb: string): Promise<{ slot: number; name: string; prst: Uint8Array }[]> {
  const d = useDevice.getState();
  const lib = useLibrary.getState();
  const out: { slot: number; name: string; prst: Uint8Array }[] = [];
  const offline = d.status !== "connected" || d.busy !== null;
  try {
    for (const [i, slot] of slots.entries()) {
      let prst = knownBody(slot);
      if (!offline && !(d.slot === slot && prst)) {
        useLibrary.setState({ job: { label: `${verb}: reading slot ${slot}`, progress: i / slots.length } });
        prst = d.slot === slot && d.saved ? d.saved.prst : await useDevice.getState().readPreset(slot);
        lib.setBody(slot, prst, "pedal");
      }
      if (!prst) throw new Error(`Slot ${slot} hasn't been read yet. Connect the GP-5 or wait for the backup to finish.`);
      out.push({ slot, name: nameOf(slot), prst });
    }
  } finally {
    useLibrary.setState({ job: null });
  }
  return out;
}

interface FileWrite {
  slot: number;
  preset: LocalPreset;
  collection: CollectionInfo | undefined;
}

export interface LibraryActions {
  /** Open dialog → Imported files; `thenWrite` continues with "Write to slot…" for the first file. */
  importFiles(opts?: { thenWrite?: boolean }): Promise<void>;
  importOpenFiles(files: OpenFile[], dropSlot?: number): Promise<void>;
  importDropped(files: File[], dropSlot?: number): Promise<void>;
  writeLocal(preset: LocalPreset, slot?: number): void;
  copySlots(slots: number[], target?: number): void;
  moveSlots(slots: number[], target?: number): void;
  swapSlots(a: number, b: number): void;
  clearSlots(slots: number[]): void;
  duplicateSlot(slot: number): void;
  exportSlots(slots: number[]): Promise<void>;
  backupSlots(slots: number[]): Promise<void>;
  addSlotsToCollection(slots: number[], collectionId: string): Promise<void>;
  exportLocal(presets: LocalPreset[]): Promise<void>;
  addLocalToCollection(presets: LocalPreset[], collectionId: string): Promise<void>;
  removeLocal(preset: LocalPreset): Promise<void>;
  readSlot(slot: number): Promise<void>;
  renameSlot(slot: number, name: string): void;
  play(slot: number): void;
  openInRig(slot: number): Promise<void>;
  collectionDialog(d: CollectionDialog): void;
}

const Ctx = createContext<LibraryActions | null>(null);

export function useLibraryActions(): LibraryActions {
  const a = useContext(Ctx);
  if (!a) throw new Error("useLibraryActions outside LibraryActionsProvider");
  return a;
}

function reportImport(added: LocalPreset[], rejected: { fileName: string; reason: string }[]) {
  if (added.length) notifySuccess(added.length === 1 ? `Imported ${added[0].name}` : `Imported ${added.length} presets`, "They're in Imported files. Drag one onto a slot to write it.");
  for (const r of rejected) notifyError(`Couldn't import ${r.fileName}`, new Error(r.reason));
}

export function LibraryActionsProvider({ children }: { children: ReactNode }) {
  const [fileWrite, setFileWrite] = useState<FileWrite | null>(null);
  const [bulk, setBulk] = useState<BulkPlan | null>(null);
  const [pick, setPick] = useState<SlotPick | null>(null);
  const [rename, setRename] = useState<{ slot: number; name: string } | null>(null);
  const [collDialog, setCollDialog] = useState<CollectionDialog | null>(null);

  const actions = useMemo<LibraryActions>(() => {
    /** `writeTo`: a slot (file dropped on a row) or "pick" (write-file-to-slot command) for the first added file. */
    const afterImport = async (picked: PickedFile[], writeTo?: number | "pick") => {
      const { added, rejected } = await importPicked(picked);
      reportImport(added, rejected);
      if (!added.length) return;
      const lib = useLibrary.getState();
      await lib.refreshCollections();
      if (lib.currentId !== IMPORTED_ID) await lib.openCollection(IMPORTED_ID);
      else await lib.reloadPresets();
      useLibrary.getState().selectLocal(added[added.length - 1].id);
      if (writeTo === "pick") a.writeLocal(added[0]);
      else if (writeTo !== undefined && added.length === 1) a.writeLocal(added[0], writeTo);
    };

    const planCopy = (slots: number[], target: number) => {
      const steps = copySteps(slots, target);
      if (!steps?.length) return;
      setBulk({
        title: slots.length === 1 ? `Copy ${nameOf(slots[0])} to slot ${target}?` : `Copy ${slots.length} slots to slots ${target}–${target + slots.length - 1}?`,
        description: "Tone Studio reads the presets from the GP-5, writes them to the new slots and reads each one back to check it.",
        action: steps.length === 1 ? `Write to slot ${target}` : `Write ${steps.length} slots`,
        steps,
        doneTitle: slots.length === 1 ? `${nameOf(slots[0])} is now also in slot ${target}` : `Copied ${slots.length} slots`,
      });
    };

    const planMove = (slots: number[], target: number) => {
      const steps = moveSteps(slots, target);
      if (!steps?.length) return;
      setBulk({
        title: slots.length === 1 ? `Move ${nameOf(slots[0])} to slot ${target}?` : `Move ${slots.length} slots to slot ${target}?`,
        description: `The slots in between shift to make room, so ${steps.length} slots are rewritten. Each one is read back to check it.`,
        action: `Rewrite ${steps.length} slots`,
        steps,
        doneTitle: slots.length === 1 ? `${nameOf(slots[0])} moved to slot ${target}` : `Moved ${slots.length} slots`,
      });
    };

    const a: LibraryActions = {
      async importFiles(opts) {
        try {
          await afterImport(await host.files.pickPrstFiles(), opts?.thenWrite ? "pick" : undefined);
        } catch (e) {
          notifyError("Couldn't import presets", e);
        }
      },
      async importOpenFiles(files, dropSlot) {
        try {
          const withPath = files.filter((f) => f.path);
          const dropped = files.filter((f) => !f.path && f.file).map((f) => f.file!);
          const picked = [...(withPath.length ? await host.files.readPaths(withPath.map((f) => f.path!)) : []), ...(dropped.length ? await host.files.readDropped(dropped) : [])];
          await afterImport(picked, dropSlot);
        } catch (e) {
          notifyError("Couldn't import presets", e);
        }
      },
      async importDropped(files, dropSlot) {
        try {
          await afterImport(await host.files.readDropped(files), dropSlot);
        } catch (e) {
          notifyError("Couldn't import presets", e);
        }
      },
      writeLocal(preset, slot) {
        const collection = useLibrary.getState().collections.find((c) => c.id === preset.collectionId);
        if (slot !== undefined) {
          setFileWrite({ slot, preset, collection });
          return;
        }
        const initial = preset.slot ?? useDevice.getState().names.find((n) => isEmptyName(n.name))?.slot ?? null;
        setPick({
          title: `Write ${preset.name} to…`,
          description: "Choose the slot on the GP-5. You confirm before anything is written.",
          confirmLabel: (s) => `Continue with slot ${s}`,
          initial,
          preview: (s) => [{ slot: s, from: "blank" }],
          sourceName: () => preset.name,
          onPick: (s) => {
            setPick(null);
            setFileWrite({ slot: s, preset, collection });
          },
        });
      },
      copySlots(slots, target) {
        if (target !== undefined) return planCopy(slots, target);
        setPick({
          title: `Copy ${slotList(slots)} to…`,
          description: "Choose where the first one goes; the others follow in order.",
          confirmLabel: (s) => `Continue with slot ${s}`,
          initial: useDevice.getState().names.find((n) => isEmptyName(n.name))?.slot ?? null,
          preview: (s) => copySteps(slots, s),
          onPick: (s) => {
            setPick(null);
            planCopy(slots, s);
          },
        });
      },
      moveSlots(slots, target) {
        if (target !== undefined) return planMove(slots, target);
        setPick({
          title: `Move ${slotList(slots)} to…`,
          description: "Choose the new position. The slots in between shift to make room.",
          confirmLabel: (s) => `Continue with slot ${s}`,
          initial: null,
          preview: (s) => moveSteps(slots, s),
          onPick: (s) => {
            setPick(null);
            planMove(slots, s);
          },
        });
      },
      swapSlots(x, y) {
        setBulk({
          title: `Swap slots ${x} and ${y}?`,
          description: `${nameOf(x)} goes to slot ${y} and ${nameOf(y)} to slot ${x}. Both are read back to check them.`,
          action: `Swap slots ${x} and ${y}`,
          steps: swapSteps(x, y),
          doneTitle: `Swapped slots ${x} and ${y}`,
        });
      },
      clearSlots(slots) {
        const used = slots.filter((s) => !isEmptyName(nameOf(s)));
        if (!used.length) return;
        setBulk({
          title: `Clear ${slotList(used)}?`,
          description: "They become empty presets named GP-5, copied from an empty slot on your pedal.",
          action: `Clear ${slotList(used)}`,
          steps: clearSteps(used),
          doneTitle: `Cleared ${slotList(used)}`,
        });
      },
      duplicateSlot(slot) {
        const names = useDevice.getState().names;
        const empty = names.find((n) => n.slot > slot && isEmptyName(n.name)) ?? names.find((n) => isEmptyName(n.name));
        if (!empty) {
          notifyError("No empty slot", new Error("Every slot on the GP-5 is in use. Clear one first, or use Copy to… to replace a slot."));
          return;
        }
        planCopy([slot], empty.slot);
      },
      async exportSlots(slots) {
        try {
          const items = await readSlots(slots, "Export");
          const to = await host.files.exportPresets(items.map((i) => ({ fileName: slotFileName(i.slot, i.name), prst: i.prst })));
          if (to) notifySuccess(items.length === 1 ? `Exported ${items[0].name}` : `Exported ${items.length} presets`, host.kind === "web" ? "Saved to your downloads." : `Saved to ${to}.`);
        } catch (e) {
          notifyError("Couldn't export", new Error(describeError(e)));
        }
      },
      async backupSlots(slots) {
        try {
          const items = await readSlots(slots, "Back up");
          const info = await host.files.saveBackup(items);
          await useLibrary.getState().refreshCollections();
          notifySuccess(`Backed up ${slotList(slots)}`, `They're in the ${info.id.slice(info.id.indexOf("/") + 1)} backup.`);
        } catch (e) {
          notifyError("Couldn't back up", new Error(describeError(e)));
        }
      },
      async addSlotsToCollection(slots, collectionId) {
        try {
          const items = await readSlots(slots, "Add to collection");
          await host.files.addPresets(
            collectionId,
            items.map((i) => ({ name: i.name, prst: i.prst, slot: i.slot, source: `Slot ${i.slot} on GP-5` })),
          );
          const lib = useLibrary.getState();
          await lib.refreshCollections();
          if (lib.currentId === collectionId) await lib.reloadPresets();
          const title = useLibrary.getState().collections.find((c) => c.id === collectionId)?.title ?? "the collection";
          notifySuccess(`Added ${slotList(slots)} to ${title}`);
        } catch (e) {
          notifyError("Couldn't add to the collection", new Error(describeError(e)));
        }
      },
      async exportLocal(presets) {
        try {
          const to = await host.files.exportPresets(presets.map((p) => ({ fileName: p.fileName, prst: p.prst })));
          if (to) notifySuccess(presets.length === 1 ? `Exported ${presets[0].name}` : `Exported ${presets.length} presets`, host.kind === "web" ? "Saved to your downloads." : `Saved to ${to}.`);
        } catch (e) {
          notifyError("Couldn't export", e);
        }
      },
      async addLocalToCollection(presets, collectionId) {
        try {
          await host.files.addPresets(
            collectionId,
            presets.map((p) => ({ name: p.name, prst: p.prst, slot: p.slot, source: p.source ?? p.fileName, fileName: p.fileName })),
          );
          await useLibrary.getState().refreshCollections();
          const title = useLibrary.getState().collections.find((c) => c.id === collectionId)?.title ?? "the collection";
          notifySuccess(`Added ${presets.length === 1 ? presets[0].name : `${presets.length} presets`} to ${title}`);
        } catch (e) {
          notifyError("Couldn't add to the collection", e);
        }
      },
      async removeLocal(preset) {
        try {
          await host.files.removePreset(preset.collectionId, preset.id);
          const lib = useLibrary.getState();
          await lib.refreshCollections();
          await lib.reloadPresets();
          if (lib.localSelected === preset.id) lib.selectLocal(null);
        } catch (e) {
          notifyError(`Couldn't remove ${preset.name}`, e);
        }
      },
      async readSlot(slot) {
        try {
          await readSlots([slot], "Read");
        } catch (e) {
          notifyError(`Couldn't read slot ${slot}`, new Error(describeError(e, slot)));
        }
      },
      renameSlot(slot, name) {
        setRename({ slot, name });
      },
      play(slot) {
        void requestPresetSwitch(slot);
      },
      async openInRig(slot) {
        if (useDevice.getState().slot !== slot) await requestPresetSwitch(slot);
        useNav.getState().go("rig");
      },
      collectionDialog(d) {
        setCollDialog(d);
      },
    };
    return a;
  }, []);

  return (
    <Ctx.Provider value={actions}>
      {children}
      {fileWrite && <FileWriteDialog write={fileWrite} onClose={() => setFileWrite(null)} />}
      <BulkWriteDialog plan={bulk} onOpenChange={(o) => !o && setBulk(null)} />
      <SlotPickerDialog pick={pick} onOpenChange={(o) => !o && setPick(null)} />
      <RenameConfirmDialog request={rename} onClose={() => setRename(null)} />
      <CollectionDialogs dialog={collDialog} onClose={() => setCollDialog(null)} />
    </Ctx.Provider>
  );
}

/** A local .prst onto a pedal slot (overlays A1/A2), including GP-50 conversion. */
function FileWriteDialog({ write, onClose }: { write: FileWrite; onClose(): void }) {
  const { slot, preset, collection } = write;
  const names = useDevice((s) => s.names);
  const snapTones = useDevice((s) => s.snapTones);
  const activeSlot = useDevice((s) => s.slot);
  const current = names[slot]?.name ?? "GP-5";
  const empty = isEmptyName(current);
  const summary = summarize(preset.prst);
  const gp50 = summary?.device === "gp50";
  const dropped = gp50 ? (summary?.gp50Only ?? []) : [];
  const body = knownBody(slot);
  const bodySummary = body ? summarize(body) : null;
  const restoring = collection?.kind === "backup" || collection?.kind === "replaced";
  const verb = restoring ? "Restore" : empty ? "Write" : "Replace";
  const title = empty
    ? `${restoring ? "Restore" : "Write"} ${preset.name} to slot ${slot}?`
    : activeSlot === slot
      ? `Overwrite ${current} in slot ${slot}?`
      : restoring
        ? `Restore ${preset.name} to slot ${slot}?`
        : `Replace ${current} in slot ${slot}?`;
  const action = dropped.length ? `Write without ${dropped.map((d) => d.split(" ")[0]).join(", ")}` : empty ? `Write to slot ${slot}` : `${verb === "Restore" ? "Restore" : "Replace"} slot ${slot}`;

  return (
    <ConfirmWriteDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      slot={slot}
      replacing={empty ? null : { name: current, detail: activeSlot === slot ? "the saved version" : bodySummary ? describeSummary(bodySummary, snapTones) : undefined }}
      incoming={{ name: preset.name, detail: `${collection?.title ?? "This computer"}, ${preset.fileName}`, prst: preset.prst }}
      action={action}
      notes={
        gp50 ? (
          <p className="rounded-lg bg-well px-3.5 py-2.5 text-sm text-pretty text-silkscreen-2">
            Converted from GP-50.
            {dropped.length > 0 && ` ${dropped.join(", ")} has no GP-5 equivalent, so ${dropped.length === 1 ? "that block is" : "those blocks are"} left empty.`}
          </p>
        ) : undefined
      }
      onConfirm={async ({ backupFirst }) => {
        const d = useDevice.getState();
        if (d.unsavedChanges > 0 && d.slot !== slot) throw Object.assign(new Error("unsaved"), { code: "unsaved" });
        const prst = gp50 ? convertPrst(preset.prst, "gp5", { force: dropped.length > 0 }) : preset.prst;
        await d.writePreset(slot, prst);
        useLibrary.getState().setBody(slot, prst, "pedal");
        notifyWriteDone({ name: preset.name, slot, backedUp: backupFirst });
      }}
    />
  );
}
