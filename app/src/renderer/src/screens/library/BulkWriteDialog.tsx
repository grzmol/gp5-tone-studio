import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLineIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/components/write/write-helpers";
import { notifySuccess } from "@/app/notify";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { REPLACED_ID } from "@shared/host/files";
import { slotsToRead, type Step } from "./plans";
import { isEmptyName, useLibrary } from "./store";

export interface BulkPlan {
  title: string;
  description: string;
  /** Button label, e.g. "Swap slots 57 and 59" */
  action: string;
  steps: Step[];
  /** Toast title on success */
  doneTitle: string;
}

const MAX_ROWS = 6;

/** Current preset of a slot: the saved body of the active slot, otherwise a read (switches presets on the pedal). */
async function readSlot(slot: number): Promise<Uint8Array> {
  const d = useDevice.getState();
  const prst = d.slot === slot && d.saved ? d.saved.prst : await d.readPreset(slot);
  useLibrary.getState().setBody(slot, prst, "pedal");
  return prst;
}

/** An empty preset (name GP-5) to clear slots with: a known empty slot's body, else read one from the pedal. */
async function blankPreset(): Promise<Uint8Array> {
  const { names } = useDevice.getState();
  const { bodies } = useLibrary.getState();
  const known = names.find((n) => isEmptyName(n.name) && bodies[n.slot]);
  if (known) return bodies[known.slot].prst;
  const empty = names.find((n) => isEmptyName(n.name));
  if (!empty) throw new Error("There's no empty slot on the GP-5 to take an empty preset from.");
  return readSlot(empty.slot);
}

/** AlertDialog for writes that touch several slots (copy, move, swap, clear): read, optional backup, write, verify. */
export function BulkWriteDialog({ plan, onOpenChange }: { plan: BulkPlan | null; onOpenChange(open: boolean): void }) {
  const names = useDevice((s) => s.names);
  const connected = useDevice((s) => s.status === "connected");
  const [backupFirst, setBackupFirst] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();
  // Survive a retry: bodies already read and steps already written are not repeated.
  const read = useRef(new Map<number | "blank", Uint8Array>());
  const written = useRef(0);
  const backedUp = useRef(false);

  useEffect(() => {
    if (!plan) return;
    read.current = new Map();
    written.current = 0;
    backedUp.current = false;
    setError(null);
    setRunning(false);
    setProgress(0);
    void host.app.getSettings().then((s) => setBackupFirst(s.backupBeforeWrite), () => {});
  }, [plan]);

  if (!plan) return null;
  const nameOf = (slot: number) => names[slot]?.name ?? "GP-5";
  const replaced = plan.steps.filter((s) => !isEmptyName(nameOf(s.slot))).map((s) => s.slot);
  const doBackup = backupFirst && replaced.length > 0;

  const run = async () => {
    setRunning(true);
    setError(null);
    const steps = plan.steps;
    const failedAt = { slot: undefined as number | undefined };
    try {
      if (useDevice.getState().unsavedChanges > 0) throw Object.assign(new Error("unsaved"), { code: "unsaved" });
      const original = useDevice.getState().slot;
      const sources = slotsToRead(steps);
      const toRead = doBackup && !backedUp.current ? [...new Set([...sources, ...replaced])].sort((a, b) => a - b) : sources;
      const total = toRead.length + steps.length;
      let n = 0;
      for (const slot of toRead) {
        n++;
        if (read.current.has(slot)) continue;
        setStatus(`Reading slot ${slot}`);
        setProgress(n / total);
        read.current.set(slot, await readSlot(slot));
      }
      if (steps.some((s) => s.from === "blank") && !read.current.has("blank")) read.current.set("blank", await blankPreset());
      if (doBackup && !backedUp.current) {
        setStatus("Saving the replaced slots");
        await host.files.addPresets(
          REPLACED_ID,
          replaced.map((slot) => ({ name: nameOf(slot), prst: read.current.get(slot)!, slot, source: `Slot ${slot} on GP-5` })),
        );
        backedUp.current = true;
      }
      for (let i = written.current; i < steps.length; i++) {
        const step = steps[i];
        failedAt.slot = step.slot;
        setStatus(`Writing slot ${step.slot} (${i + 1} of ${steps.length})`);
        setProgress((toRead.length + i) / total);
        const prst = read.current.get(step.from)!;
        await useDevice.getState().writePreset(step.slot, prst);
        useLibrary.getState().setBody(step.slot, prst, "pedal");
        written.current = i + 1;
      }
      setProgress(1);
      // Writing verifies by selecting each slot; go back to the preset that was playing.
      if (original !== null && useDevice.getState().slot !== original) await useDevice.getState().selectSlot(original).catch(() => {});
      notifySuccess(plan.doneTitle, `Verified by reading each slot back.${backedUp.current ? " The replaced presets are in Replaced presets." : ""}`);
      onOpenChange(false);
    } catch (e) {
      setError(describeError(e, failedAt.slot));
    } finally {
      setRunning(false);
    }
  };

  const rows = plan.steps.slice(0, MAX_ROWS);
  return (
    <AlertDialog open onOpenChange={(o) => !running && onOpenChange(o)}>
      <AlertDialogContent className="max-w-[480px] gap-4" onEscapeKeyDown={(e) => running && e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance">{plan.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            {running ? "Keep the GP-5 connected until every slot is checked." : plan.description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {running ? (
          <div className="flex flex-col gap-2" role="status">
            <span className="text-sm text-silkscreen-2">{status}</span>
            <Progress value={progress * 100} aria-label="Progress" />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-well px-3.5 py-3 text-sm">
              {rows.map((s) => (
                <div key={s.slot} className="contents">
                  <dt className="text-silkscreen-3 tabular-nums">Slot {String(s.slot).padStart(2, "0")}</dt>
                  <dd className="min-w-0 truncate text-silkscreen">
                    <span className="font-semibold">{s.from === "blank" ? "Empty preset" : nameOf(s.from)}</span>
                    <span className="text-silkscreen-3">
                      {isEmptyName(nameOf(s.slot)) ? ", was empty" : `, replaces ${nameOf(s.slot)}`}
                    </span>
                  </dd>
                </div>
              ))}
              {plan.steps.length > MAX_ROWS && <dd className="col-span-2 text-silkscreen-3">and {plan.steps.length - MAX_ROWS} more</dd>}
            </dl>
            <div className="flex items-start gap-2.5 text-sm">
              <Checkbox
                id={checkboxId}
                className="mt-0.5"
                checked={doBackup}
                disabled={!replaced.length || backedUp.current}
                onCheckedChange={(v) => {
                  setBackupFirst(v === true);
                  void host.app.setSettings({ backupBeforeWrite: v === true }).catch(() => {});
                }}
              />
              <Label htmlFor={checkboxId} className="flex flex-col items-start gap-0.5 font-normal text-silkscreen">
                <span>
                  {replaced.length ? `Back up the ${replaced.length === 1 ? "replaced slot" : `${replaced.length} replaced slots`} first` : "Back up first (not needed, the slots are empty)"}
                </span>
                {replaced.length > 0 && <span className="text-xs text-silkscreen-3">Saves them to Replaced presets on this computer</span>}
              </Label>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-pretty text-led-fault">
            {error}
          </p>
        )}

        <AlertDialogFooter className="items-center">
          {running ? (
            <Button disabled>
              <Spinner data-icon="inline-start" />
              Writing
            </Button>
          ) : (
            <>
              <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
              <Button variant="destructive" disabled={!connected || !plan.steps.length} onClick={() => void run()}>
                <ArrowDownToLineIcon data-icon="inline-start" />
                {error ? "Retry" : plan.action}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
