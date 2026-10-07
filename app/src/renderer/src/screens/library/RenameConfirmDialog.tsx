import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/components/write/write-helpers";
import { notifySuccess } from "@/app/notify";
import { applyEdits } from "@/gp5/lib/prst.mjs";
import { useDevice } from "@/state/device";
import { useLibrary } from "./store";

/** Rename on the pedal: name only, the sound is unchanged. Keeps the known body's chain in step. */
async function renameOnPedal(slot: number, name: string) {
  await useDevice.getState().rename(slot, name);
  const body = useLibrary.getState().bodies[slot];
  if (body) useLibrary.setState({ bodies: { ...useLibrary.getState().bodies, [slot]: { ...body, prst: applyEdits(body.prst, { name }) } } });
}

export function RenameConfirmDialog({ request, onClose }: { request: { slot: number; name: string } | null; onClose(): void }) {
  const names = useDevice((s) => s.names);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!request) return null;
  const { slot, name } = request;
  const old = names[slot]?.name ?? "GP-5";

  const confirm = async () => {
    setRunning(true);
    setError(null);
    try {
      await renameOnPedal(slot, name);
      notifySuccess(`Slot ${slot} renamed to ${name}`, undefined, { label: "Undo", run: () => renameOnPedal(slot, old) });
      onClose();
    } catch (e) {
      setError(describeError(e, slot));
    } finally {
      setRunning(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        if (!o && !running) {
          setError(null);
          onClose();
        }
      }}
    >
      <AlertDialogContent className="max-w-[440px]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Rename slot {slot} to {name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The GP-5 stores the new name for {old}. Only the name changes; the sound stays the same.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-pretty text-led-fault">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost" disabled={running}>
            Cancel
          </AlertDialogCancel>
          <Button disabled={running} onClick={() => void confirm()}>
            {running && <Spinner data-icon="inline-start" />}
            {running ? "Renaming" : "Rename on pedal"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
