import { useEffect } from "react";
import { AudioWaveform, Speaker, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestImage, useTones } from "./store";

/** Placeholder glyph by gear type, so the empty tile still says what it holds. */
export function GearGlyph({ gear, format, className }: { gear: string; format: string; className?: string }) {
  const Icon = format === "ir" || gear === "cab" ? Speaker : gear === "pedal" ? Zap : AudioWaveform;
  return <Icon className={className} aria-hidden />;
}

/** Cached TONE3000 tone image (tone.images[0]); a flat well tile with a gear glyph while loading or missing. */
export function ToneImage({
  url,
  gear,
  format,
  alt,
  square,
  caption = true,
  className,
  children,
}: {
  url: string | null;
  gear: string;
  format: string;
  alt: string;
  square?: boolean;
  caption?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const data = useTones((s) => (url ? s.images[url] : null));
  useEffect(() => {
    if (url) requestImage(url);
  }, [url]);
  return (
    <span
      className={cn(
        "relative grid flex-none place-items-center overflow-hidden bg-well text-silkscreen-4 shadow-[inset_0_0_0_1px_var(--seam)]",
        square ? "aspect-square rounded-lg" : "aspect-[16/10]",
        className,
      )}
    >
      {data ? (
        <img src={data} alt={alt} className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : (
        <>
          <GearGlyph gear={gear} format={format} className={square ? "size-8" : "size-7"} />
          {caption && <span className="absolute inset-x-0 bottom-2 text-center text-[11px] text-silkscreen-4">Tone image</span>}
        </>
      )}
      {children}
    </span>
  );
}
