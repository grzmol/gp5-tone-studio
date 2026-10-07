import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getMidiLog, useDevice } from "@/state/device";
import { formatLogTime } from "@/state/midi-log";

const ROW = 22;
const HEIGHT = 190;
const OVERSCAN = 6;

/** Live MIDI monitor lines (up to 2,000), windowed so a backup's thousands of frames stay cheap to render. */
export function MidiLog() {
  useDevice((s) => s.midiLogVersion);
  const lines = getMidiLog();
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((top + HEIGHT) / ROW) + OVERSCAN);

  return (
    <div
      ref={ref}
      role="log"
      aria-label="MIDI messages"
      aria-live="off"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        setTop(el.scrollTop);
        stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW;
      }}
      className="relative mt-1 overflow-auto rounded-lg bg-well py-1.5 text-xs select-text"
      style={{ height: HEIGHT }}
    >
      {lines.length === 0 ? (
        <p className="px-3 py-1 text-silkscreen-3">Waiting for MIDI traffic. Turn a dial or switch presets to see messages.</p>
      ) : (
        <div style={{ height: lines.length * ROW, position: "relative" }}>
          {lines.slice(first, last).map((l, i) => (
            <div
              key={l.id}
              className={cn("absolute inset-x-0 grid grid-cols-[84px_34px_minmax(0,1fr)_auto] items-center gap-2.5 px-3", l.ack || l.dir !== "out" ? "text-silkscreen-3" : "text-silkscreen-2")}
              style={{ top: (first + i) * ROW, height: ROW }}
            >
              <span className="text-silkscreen-4 tabular-nums">{formatLogTime(l.at)}</span>
              <span className={cn("font-semibold", l.dir === "bad" || l.dir === "warn" ? "text-led-warn" : "text-silkscreen-3")}>
                {l.dir === "out" ? "Out" : l.dir === "in" ? "In" : l.dir === "bad" ? "Bad" : "Warn"}
              </span>
              <span className={cn("truncate", l.dir === "in" && !l.ack && "text-silkscreen-2")}>{l.text}</span>
              <span className="text-silkscreen-3">{l.raw}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
