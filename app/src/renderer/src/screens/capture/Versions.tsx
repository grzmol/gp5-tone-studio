import { useState } from "react";
import { Eye, History, Lock, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { notifyError } from "@/app/notify";
import { cn } from "@/lib/utils";
import { summarize } from "./nam/recipe";
import { isDirty, recipeOf, useCapture } from "./store";
import { PANEL } from "./parts";

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function VersionList({ onPicked }: { onPicked?: () => void }) {
  const loaded = useCapture((s) => s.loaded)!;
  const { base, viewing, recipe, view, restore } = useCapture();
  const dirty = useCapture(isDirty);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const nextN = (loaded.versions.at(-1)?.n ?? 0) + 1;
  const fromTone = loaded.source.kind === "tone";

  const open = (n: number | null) => {
    view(n);
    onPicked?.();
  };
  const onRestore = (n: number) => restore(n).catch((e) => notifyError(`Couldn't restore version ${n}`, e));
  const workingIs = (n: number) => !dirty && base === n;

  const item = (n: number, title: string, time: string, what: string, extra?: React.ReactNode) => {
    const isWorking = workingIs(n);
    const current = viewing === n || (viewing === null && isWorking);
    return (
      <li key={n}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              aria-current={current}
              onClick={() => open(isWorking ? null : n)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-sm px-2.5 pt-2 pb-[9px] text-left text-[12px] hover:bg-accent",
                current && "bg-lamp-glow shadow-[inset_0_0_0_1px_var(--seam-strong)]",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className={cn("font-semibold", n === 0 ? "text-silkscreen-2" : "text-silkscreen")}>{title}</span>
                {n === 0 && <Lock className="size-3 text-silkscreen-4" aria-label="Locked" />}
                <span className="ml-auto text-[11px] text-silkscreen-4">{time}</span>
              </span>
              <span className="leading-snug text-pretty text-silkscreen-2">{what}</span>
              {extra}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuGroup>
              <ContextMenuItem onSelect={() => open(isWorking ? null : n)}>
                <Eye />
                Open
              </ContextMenuItem>
              <ContextMenuItem disabled={isWorking} onSelect={() => void onRestore(n)}>
                <RotateCcw />
                Restore as version {dirty ? nextN + 1 : nextN}
              </ContextMenuItem>
            </ContextMenuGroup>
            {n > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuItem variant="destructive" onSelect={() => setConfirmDelete(n)}>
                    <Trash2 />
                    Delete…
                  </ContextMenuItem>
                </ContextMenuGroup>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </li>
    );
  };

  const versions = [...loaded.versions].reverse();
  return (
    <>
      <ol className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-auto p-0">
        {dirty && recipe && (
          <li>
            <button
              type="button"
              aria-current={viewing === null}
              onClick={() => open(null)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-sm px-2.5 pt-2 pb-[9px] text-left text-[12px] hover:bg-accent",
                viewing === null && "bg-lamp-glow shadow-[inset_0_0_0_1px_var(--seam-strong)]",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-silkscreen">Draft</span>
                <span className="ml-auto text-[11px] text-silkscreen-4">Not saved</span>
              </span>
              <span className="leading-snug text-pretty text-silkscreen-2">{summarize(recipeOf(loaded, base), recipe)}</span>
              <span className="text-[11px] text-silkscreen-3">Saving makes it version {nextN}</span>
            </button>
          </li>
        )}
        {versions.map((v) =>
          item(
            v.n,
            `Version ${v.n}`,
            when(v.createdAt),
            v.summary,
            v.restoredFrom ? <span className="text-[11px] text-silkscreen-3">Restored from version {v.restoredFrom}</span> : undefined,
          ),
        )}
        {item(0, "Original", "", fromTone ? "From TONE3000, never changed" : "As opened, never changed")}
      </ol>
      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete version {confirmDelete}?</AlertDialogTitle>
            <AlertDialogDescription>Its recipe and exported file are removed. The other versions and the original stay as they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const n = confirmDelete;
                if (n !== null) useCapture.getState().deleteVersion(n).catch((e) => notifyError(`Couldn't delete version ${n}`, e));
              }}
            >
              Delete version {confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const FOOT = "Each version is a small recipe on top of the original. Nothing is lost when you go back.";

/** Wide windows: the versions column. */
export function VersionsPanel() {
  return (
    <aside aria-label="Versions" className={cn(PANEL, "col-start-2 row-start-2 hidden flex-col gap-2.5 px-2.5 pt-3.5 pb-3 min-[1421px]:flex")}>
      <h2 className="flex items-center gap-1.5 px-1.5 text-[12px] font-semibold text-silkscreen-2">
        <History className="size-3.5 text-silkscreen-3" aria-hidden />
        Versions
      </h2>
      <VersionList />
      <p className="mt-auto border-t px-1.5 pt-2 text-[11px] text-pretty text-silkscreen-3">{FOOT}</p>
    </aside>
  );
}

/** ≤ 1420 px: a "Versions" button in the edit panel head opens the list as a Sheet. */
export function VersionsButton() {
  const [open, setOpen] = useState(false);
  const count = useCapture((s) => (s.loaded?.versions.length ?? 0) + 1);
  return (
    <>
      <Button variant="ghost" size="sm" className="ml-auto min-[1421px]:hidden" aria-expanded={open} onClick={() => setOpen(true)}>
        <History className="size-3.5" aria-hidden />
        Versions
        <span className="text-silkscreen-3">{count}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[300px] gap-3 px-3 py-4 sm:max-w-[300px]">
          <SheetHeader className="p-0 px-1.5">
            <SheetTitle className="flex items-center gap-1.5 text-[13px]">
              <History className="size-3.5 text-silkscreen-3" aria-hidden />
              Versions
            </SheetTitle>
            <SheetDescription className="text-[11px]">{FOOT}</SheetDescription>
          </SheetHeader>
          <VersionList onPicked={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Shown over the edit tabs while an older version is open read-only. */
export function ViewingBar() {
  const { viewing, view, restore, loaded } = useCapture();
  const dirty = useCapture(isDirty);
  if (viewing === null || !loaded) return null;
  const nextN = (loaded.versions.at(-1)?.n ?? 0) + (dirty ? 2 : 1);
  return (
    <div className="flex items-center gap-3 border-b bg-lamp-glow px-4 py-2 text-[12px] text-silkscreen-2" role="status">
      <Eye className="size-3.5 flex-none text-silkscreen-3" aria-hidden />
      <span className="min-w-0 flex-1">Viewing {viewing === 0 ? "the original" : `version ${viewing}`}, read-only.</span>
      <Button variant="ghost" size="sm" onClick={() => view(null)}>
        Back to current
      </Button>
      <Button variant="outline" size="sm" onClick={() => restore(viewing).catch((e) => notifyError("Couldn't restore", e))}>
        <RotateCcw className="size-3.5" aria-hidden />
        Restore as version {nextN}
      </Button>
    </div>
  );
}
