import { useRef, useState } from "react";
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
import { useDevice } from "@/state/device";
import { useUi } from "@/state/ui";
import { describeError } from "../notify";
import { switchNow } from "../preset-switch";
import { diffPresets, type ChangeRow } from "../unsaved-diff";

const MAX_ROWS = 5;
const pad = (n: number) => String(n).padStart(2, "0");

/** overlays.md B: "Save your changes to …?" when switching presets with unsaved edits. */
export function UnsavedSwitchDialog() {
  const target = useUi((s) => s.switchTarget);
  const setTarget = useUi((s) => s.setSwitchTarget);
  const preset = useDevice((s) => s.preset);
  const saved = useDevice((s) => s.saved);
  const names = useDevice((s) => s.names);
  const [running, setRunning] = useState<null | "save" | "discard">(null);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const open = target !== null && !!preset && !!saved;
  // Keep the last content while the dialog animates out.
  const shown = useRef<{ target: number; name: string; slot: number; targetName: string; rows: ChangeRow[] } | null>(null);
  if (open) shown.current = { target: target!, name: preset!.name, slot: preset!.slot, targetName: names.find((n) => n.slot === target)?.name ?? "", rows: diffPresets(saved!, preset!) };
  const view = shown.current;
  const close = () => {
    if (running) return;
    setError(null);
    setTarget(null);
  };

  const finish = async (kind: "save" | "discard") => {
    if (target === null || !preset) return;
    setRunning(kind);
    setError(null);
    try {
      if (kind === "save") await useDevice.getState().saveToSlot(preset.slot);
      // selectSlot drops the pedal's edit buffer, so Discard is just the switch.
      await switchNow(target);
      setTarget(null);
    } catch (e) {
      setError(kind === "save" ? `Couldn't save slot ${pad(preset.slot)}. ${describeError(e)}` : describeError(e));
    } finally {
      setRunning(null);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent
        className="w-[560px] max-w-[calc(100vw-48px)] gap-4 sm:max-w-[560px]"
        onOpenAutoFocus={(e) => {
          // Enter = Save (overlays.md B); Esc still cancels.
          e.preventDefault();
          saveRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
      >
        {view && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg font-semibold text-balance">Save your changes to {view.name}?</AlertDialogTitle>
              <AlertDialogDescription className="text-[13px] text-pretty text-silkscreen-2">
                You're switching to {pad(view.target)} {view.targetName}. These changes only live in the pedal's buffer and are lost if you switch now.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {view.rows.length > 0 && (
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-seam text-left text-silkscreen-3">
                    <th className="py-1.5 pr-3 font-medium">Block</th>
                    <th className="py-1.5 pr-3 font-medium">Parameter</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Saved</th>
                    <th className="py-1.5 text-right font-medium">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.slice(0, MAX_ROWS).map((r, i) => (
                    <tr key={i} className="border-b border-seam last:border-0">
                      <td className="py-2 pr-3">
                        {r.block ? (
                          <span className="flex items-center gap-1.5">
                            <span className="size-2 shrink-0 rounded-pill" style={{ background: `var(--block-${r.block.code.toLowerCase()})` }} aria-hidden />
                            <b className="font-bold text-silkscreen-2">{r.block.code}</b>
                            <span className="truncate text-silkscreen-3">{r.block.model}</span>
                          </span>
                        ) : (
                          <span className="text-silkscreen-3">Preset</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-silkscreen">{r.parameter}</td>
                      <td className="py-2 pr-3 text-right text-silkscreen-3">{r.saved}</td>
                      <td className="py-2 text-right font-semibold text-silkscreen">{r.now}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {view.rows.length > MAX_ROWS && <p className="-mt-2 text-xs text-silkscreen-3">and {view.rows.length - MAX_ROWS} more</p>}
            {error && (
              <p role="alert" className="text-xs text-led-fault">
                {error}
              </p>
            )}
            <AlertDialogFooter className="items-center sm:justify-start">
              <Button variant="ghost" className="-ml-2.5 px-2.5 text-led-fault hover:text-led-fault" disabled={!!running} onClick={() => void finish("discard")}>
                {running === "discard" && <Spinner />}
                Discard
              </Button>
              <span className="flex-1" />
              <AlertDialogCancel disabled={!!running}>Cancel</AlertDialogCancel>
              <Button ref={saveRef} disabled={!!running} onClick={() => void finish("save")}>
                {running === "save" && <Spinner />}
                {running === "save" ? `Saving slot ${pad(view.slot)}` : `Save to slot ${pad(view.slot)}`}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
