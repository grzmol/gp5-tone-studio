import { cn } from "@/lib/utils";
import { useTones } from "@/screens/tones/store";
import { useCapture } from "./store";
import type { NamInfo } from "./nam/model";

export function Led({ tone, className }: { tone: "on" | "warn" | "fault" | "off"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-[7px] flex-none rounded-full",
        tone === "on" && "bg-led-on",
        tone === "warn" && "bg-led-warn",
        tone === "fault" && "bg-led-fault",
        tone === "off" && "bg-led-off",
        className,
      )}
    />
  );
}

/** The TONE3000 record of the open capture (null for files opened from disk). */
export function useToneRecord() {
  const ref = useCapture((s) => (s.loaded?.source.kind === "tone" ? s.loaded.source.ref : null));
  return useTones((s) => (ref ? (s.records[Number(ref)] ?? null) : null));
}

/** Title shown for the capture: tone title, else the file's name metadata, else the file name. */
export function useCaptureTitle(): string {
  const record = useToneRecord();
  const loaded = useCapture((s) => s.loaded);
  if (record) return record.title;
  const name = loaded?.file.metadata?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return loaded?.source.fileName.replace(/\.nam$/i, "") ?? "Capture";
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** "A2" + "Full + Lite" / "Full only" … , "A1" + size. */
export function archLabel(info: NamInfo): { arch: string; detail: string } {
  if (info.arch.kind === "A2") {
    const sizes = info.arch.submodels.map((s) => s.size);
    const detail = sizes.includes("full") && sizes.includes("lite") ? "Full + Lite" : sizes.includes("full") ? "Full only" : "Lite only";
    return { arch: "A2", detail };
  }
  if (info.arch.kind === "A1") return { arch: "A1", detail: info.arch.size[0].toUpperCase() + info.arch.size.slice(1) };
  return { arch: "NAM", detail: info.arch.architecture };
}

export const PANEL = "glass rounded-xl min-w-0 min-h-0";
