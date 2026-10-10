import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Led } from "@/screens/capture/parts";

export const PANEL = "glass rounded-xl min-w-0 min-h-0";

/** "High / Medium / Low confidence" with a status light (≥ 0.7 high, ≥ 0.45 medium). */
export function Confidence({ value, className }: { value: number; className?: string }) {
  const label = value >= 0.7 ? "High" : value >= 0.45 ? "Medium" : "Low";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-silkscreen-3", className)} title={`Confidence ${Math.round(value * 100)} %`}>
      <Led tone={value >= 0.7 ? "on" : value >= 0.45 ? "warn" : "off"} />
      {label} confidence
    </span>
  );
}

/** A titled section of the Tone match tab. */
export function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn(PANEL, "flex flex-col gap-3 px-5 py-4", className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export const fmtDb = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
