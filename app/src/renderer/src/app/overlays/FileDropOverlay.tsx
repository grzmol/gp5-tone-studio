import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { host } from "@/host";
import { useNav } from "@/state/nav";
import { openFiles } from "@/state/ui";
import { notifyError } from "../notify";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

/**
 * Window-wide drop target (electron.md › Files): .prst → Library, .nam → capture editor, .wav → Tones.
 * Screens with their own drop zones (Library panes) handle the drop first and call preventDefault;
 * only unclaimed drops reach this listener. The overlay is a visual hint and never blocks those zones.
 */
export function FileDropOverlay() {
  const [active, setActive] = useState(false);
  const screen = useNav((s) => s.screen);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault(); // allow dropping anywhere
      e.dataTransfer!.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setActive(false);
      if (!hasFiles(e)) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer!.files).map((file) => ({ name: file.name, path: host.app.pathForFile(file), file }));
      const { ignored } = openFiles(files);
      if (ignored.length)
        notifyError(
          ignored.length === 1 ? `Can't open ${ignored[0].name}` : `Can't open ${ignored.length} files`,
          new Error("Tone Studio opens .prst presets, .nam captures and .wav impulse responses."),
        );
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // The Library shows its own drop targets for presets.
  if (!active || screen === "library") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-2 z-40 grid place-items-center rounded-xl bg-black/30 shadow-[inset_0_0_0_2px_var(--silkscreen)]">
      <div className="glass-float flex items-center gap-3 rounded-lg px-5 py-4 text-[13px]">
        <FileDown className="size-5 text-silkscreen-2" />
        <div className="flex flex-col gap-0.5">
          <b className="font-semibold">Drop to open</b>
          <span className="text-xs text-silkscreen-2">Presets (.prst) go to the Library, NAM captures to the capture editor, IRs (.wav) to Tones</span>
        </div>
      </div>
    </div>
  );
}
