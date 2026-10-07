import { useState } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleX, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { host } from "@/host";
import { cn } from "@/lib/utils";

/*
 * Toasts per overlays.md G (Sonner, bottom right above the status bar, max 3, newest on top).
 * Success toasts auto-dismiss after 6 s; errors stay until dismissed and offer Retry when a retry is possible.
 * Every screen reports pedal results through these helpers so the copy stays the same everywhere.
 */

interface ToastAction {
  label: string;
  /** Errors thrown here keep the toast open; resolving dismisses it */
  run: () => void | Promise<void>;
  /** Show "Retrying" with a spinner while `run` is in flight */
  retry?: boolean;
}

interface ToastSpec {
  tone: "ok" | "fault";
  title: string;
  body?: string;
  action?: ToastAction;
}

function ToastCard({ id, spec }: { id: string | number; spec: ToastSpec }) {
  const [running, setRunning] = useState(false);
  const { tone, title, body, action } = spec;
  const Icon = tone === "ok" ? CircleCheck : CircleX;
  const onAction = async () => {
    if (!action) return;
    setRunning(true);
    try {
      await action.run();
      toast.dismiss(id);
    } catch {
      // the action reports its own failure (usually with a fresh toast)
      toast.dismiss(id);
    }
  };
  return (
    <div
      role={tone === "ok" ? "status" : "alert"}
      aria-busy={running || undefined}
      className="glass-float relative flex w-[404px] max-w-[calc(100vw-48px)] items-start gap-2.5 rounded-lg py-3.5 pr-10 pl-3.5 text-[13px] text-silkscreen"
    >
      <Icon className={cn("mt-px size-[18px] shrink-0", tone === "ok" ? "text-led-on" : "text-led-fault")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="font-semibold">{title}</b>
        {body && <span className="text-xs text-pretty text-silkscreen-2">{body}</span>}
      </div>
      {action && (
        <Button variant="outline" size="sm" className="self-center" disabled={running} onClick={onAction}>
          {running && action.retry ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : action.retry ? <RefreshCw aria-hidden /> : null}
          {running && action.retry ? "Retrying" : action.label}
        </Button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => toast.dismiss(id)}
        className="absolute top-2 right-2 grid size-6 place-items-center rounded-[10px] text-silkscreen-3 before:absolute before:-inset-1 before:content-[''] hover:bg-accent hover:text-silkscreen"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function showToast(spec: ToastSpec): string | number {
  return toast.custom((id) => <ToastCard id={id} spec={spec} />, { duration: spec.tone === "ok" ? 6000 : Infinity });
}

/** Device/toolkit error → one plain sentence (overlays.md G mapping). */
export function describeError(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  switch (e?.code) {
    case "timeout":
      return "No reply from the GP-5 after 3 tries. Check the USB cable.";
    case "verify":
      return "The read-back differs from what was sent.";
    case "closed":
      return "The GP-5 disconnected before it finished.";
    case "length":
    case "unsafe":
      return "Tone Studio stopped this write because the data looked wrong. Nothing was sent.";
    default:
      return e?.message || String(error);
  }
}

export function notifyError(title: string, error: unknown, retry?: () => void | Promise<void>): void {
  showToast({ tone: "fault", title, body: describeError(error), action: retry ? { label: "Retry", run: retry, retry: true } : undefined });
}

export function notifySuccess(title: string, body?: string, action?: ToastAction): void {
  showToast({ tone: "ok", title, body, action });
}

/** A3: a verified write. `go` selects the written slot (omit when it is already active). */
export function notifyWriteDone({ name, slot, backedUp, go }: { name: string; slot: number; backedUp: boolean; go?: () => void | Promise<void> }): void {
  const nn = String(slot).padStart(2, "0");
  showToast({
    tone: "ok",
    title: `${name} is now in slot ${nn}`,
    body: `Verified by reading it back.${backedUp ? ` The old slot ${nn} is in your backups.` : ""}`,
    action: go ? { label: `Go to slot ${nn}`, run: go } : undefined,
  });
}

/** G: a failed write. A write the GP-5 doesn't fully acknowledge is discarded, so the slot is unchanged. */
export function notifyWriteFailed({ slot, error, retry }: { slot: number; error: unknown; retry?: () => void | Promise<void> }): void {
  const nn = String(slot).padStart(2, "0");
  const code = (error as { code?: string } | null)?.code;
  if (code === "verify") {
    showToast({
      tone: "fault",
      title: `Slot ${nn} didn't match after writing`,
      body: `The read-back differs from what was sent. Retry, or restore slot ${nn} from the backup.`,
      action: retry ? { label: "Retry", run: retry, retry: true } : undefined,
    });
    return;
  }
  const body =
    code === "timeout"
      ? `The GP-5 stopped answering and discarded the write. Slot ${nn} was not changed.`
      : code === "closed"
        ? `The GP-5 disconnected during the write and discarded it. Slot ${nn} was not changed.`
        : describeError(error);
  showToast({ tone: "fault", title: `Couldn't write slot ${nn}`, body, action: retry ? { label: "Retry", run: retry, retry: true } : undefined });
}

/** G: backup finished. `path` is the backup folder on disk (desktop app). */
export function notifyBackupDone({ folder, path, count = 100 }: { folder: string; path?: string | null; count?: number }): void {
  showToast({
    tone: "ok",
    title: "Backup finished",
    body: `${count === 100 ? "All 100 slots are" : `${count} slots are`} in the ${folder} backup folder.`,
    action: path && host.kind === "electron" ? { label: "Show folder", run: () => host.app.showItemInFolder(path) } : undefined,
  });
}
