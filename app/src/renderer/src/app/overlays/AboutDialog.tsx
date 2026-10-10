import { useEffect, useState } from "react";
import { Cable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import { useUi } from "@/state/ui";

const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** Help › About VLTN Tone Studio. One of the rare places for the brand violet (DESIGN.md › Colors). */
export function AboutDialog() {
  const open = useUi((s) => s.aboutOpen);
  const setOpen = useUi((s) => s.setAboutOpen);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (open && version === null) void host.app.version().then(setVersion, () => setVersion(""));
  }, [open, version]);

  const where = host.kind === "electron" ? `Desktop app for ${PLATFORM[host.platform] ?? host.platform}` : "Web version";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="w-[420px] max-w-[calc(100vw-48px)] gap-5 sm:max-w-[420px]">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-sm bg-brand text-white" aria-hidden>
            <Cable className="size-6" strokeWidth={2.25} />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-lg font-semibold tracking-[-0.012em]">VLTN Tone Studio</DialogTitle>
            <span className="text-xs text-silkscreen-3 tabular-nums">
              {version ? (version === "web" ? where : `Version ${version} · ${where}`) : where}
            </span>
          </div>
        </div>
        <DialogDescription className="text-[13px] text-pretty text-silkscreen-2">
          Editor and librarian for the Valeton GP-5: shape presets live on the pedal, sort its 100 slots, back them up, and bring NAM captures and IRs from TONE3000.
        </DialogDescription>
        <p className="text-xs text-pretty text-silkscreen-3">Valeton and GP-5 are trademarks of their owners. This app is not made or endorsed by Valeton.</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
