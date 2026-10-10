import { useId } from "react";
import { cn } from "@/lib/utils";

export interface CurveSeries {
  label: string;
  /** [Hz, dB] points; non-finite dB values break the line */
  points: [number, number][];
  className: string;
  dashed?: boolean;
}

const W = 560;
const H = 160;
const PAD = { left: 34, right: 8, top: 8, bottom: 18 };
const F_LO = 50;
const F_HI = 16000;
const TICKS_HZ = [100, 300, 1000, 3000, 10000];

const xOf = (f: number) => PAD.left + ((Math.log2(f) - Math.log2(F_LO)) / (Math.log2(F_HI) - Math.log2(F_LO))) * (W - PAD.left - PAD.right);
const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

function pathOf(points: [number, number][], yOf: (db: number) => number): string {
  let d = "";
  let pen = false;
  for (const [f, db] of points) {
    if (f < F_LO || f > F_HI || !Number.isFinite(db)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${xOf(f).toFixed(1)},${yOf(db).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Frequency curves on a log axis (50 Hz–16 kHz) with a dB scale fitted to the data in `range` steps. */
export function CurvePlot({ series, range = 6, title, className }: { series: CurveSeries[]; range?: number; title: string; className?: string }) {
  const titleId = useId();
  const values = series.flatMap((s) => s.points.filter(([f, db]) => f >= F_LO && f <= F_HI && Number.isFinite(db)).map(([, db]) => db));
  const top = Math.ceil(Math.max(range, ...values) / range) * range;
  const bottom = Math.floor(Math.min(-range, ...values) / range) * range;
  const yOf = (db: number) => PAD.top + ((top - db) / (top - bottom)) * (H - PAD.top - PAD.bottom);
  const steps = Array.from({ length: Math.round((top - bottom) / range) + 1 }, (_, i) => top - i * range);
  return (
    <figure className={cn("flex flex-col gap-1.5", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} className="w-full text-silkscreen-3">
        <title id={titleId}>{title}</title>
        {steps.map((db) => (
          <g key={db}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(db)} y2={yOf(db)} className={db === 0 ? "stroke-seam-strong" : "stroke-seam"} strokeWidth={1} />
            <text x={PAD.left - 4} y={yOf(db) + 3} textAnchor="end" className="fill-current text-[9px] tabular-nums">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        {TICKS_HZ.map((f) => (
          <text key={f} x={xOf(f)} y={H - 4} textAnchor="middle" className="fill-current text-[9px]">
            {fmtHz(f)}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.label} d={pathOf(s.points, yOf)} fill="none" strokeWidth={1.75} strokeDasharray={s.dashed ? "4 3" : undefined} className={s.className} />
        ))}
      </svg>
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-silkscreen-3">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden className={s.className}>
                <line x1="0" x2="14" y1="2" y2="2" strokeWidth={2} strokeDasharray={s.dashed ? "3 2" : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
