import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { KnobHit } from "./controls";
import { formatValue, type ValueSpec } from "./knob-math";

export interface DialProps {
  /** Visible label ("In", "Gain") */
  label: string;
  /** Accessible name; defaults to the label */
  ariaLabel?: string;
  value: number;
  spec: ValueSpec;
  onChange?: (value: number) => void;
  disabled?: boolean;
  /** Knob diameter in px */
  size?: number;
  /** Ring colour (CSS colour, e.g. var(--block-ns)) */
  color?: string;
  /** "row": label and value beside the knob (overview IN/OUT); "column": label above, value below */
  layout?: "row" | "column";
  className?: string;
}

/** Compact machined dial (mockups' .knob): track + value ring, dark cap, white pointer. Same input model as gear knobs. */
export function Dial({ label, ariaLabel, value, spec, onChange, disabled, size = 46, color = "var(--silkscreen-2)", layout = "column", className }: DialProps) {
  const [active, setActive] = useState(false);
  const r = size / 2 - 5;
  const c = size / 2;
  const t = Math.max(0, Math.min(1, (value - spec.min) / (spec.max - spec.min || 1)));
  const bipolar = spec.min < 0 && spec.max > 0;
  const a0 = -225;
  const sweep = 270;
  const pt = (deg: number, rad: number) => [c + rad * Math.cos((deg * Math.PI) / 180), c + rad * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from, r);
    const [x1, y1] = pt(to, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const end = a0 + sweep * t;
  const mid = a0 + sweep / 2;
  const value_arc = bipolar ? (Math.abs(t - 0.5) > 0.004 ? (t >= 0.5 ? arc(mid, end) : arc(end, mid)) : "") : t > 0.001 ? arc(a0, end) : "";
  const inner = Math.max(4, r - 9);
  const [px, py] = pt(end, inner - 1);
  const [qx, qy] = pt(end, Math.max(1, inner - 7));
  const style: CSSProperties = { width: size, height: size };
  return (
    <div className={cn("relative flex items-center", layout === "row" ? "flex-row gap-2" : "flex-col gap-1.5", className)}>
      {layout === "column" && <span className={cn("text-xs font-medium tracking-wide uppercase", active ? "text-silkscreen" : "text-silkscreen-3")}>{label}</span>}
      <span className="relative" style={style}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="block">
          <path d={arc(a0, a0 + sweep)} fill="none" stroke="#2a2a2d" strokeWidth={3} strokeLinecap="round" />
          {value_arc && <path d={value_arc} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />}
          <circle cx={c} cy={c} r={inner} fill="#1c1c1e" stroke={active ? "var(--silkscreen-2)" : "#333336"} strokeWidth={1} />
          <line x1={qx.toFixed(2)} y1={qy.toFixed(2)} x2={px.toFixed(2)} y2={py.toFixed(2)} stroke="var(--silkscreen)" strokeWidth={2} strokeLinecap="round" />
        </svg>
        <KnobHit
          label={ariaLabel ?? label}
          value={value}
          spec={spec}
          onChange={onChange}
          disabled={disabled}
          onActive={setActive}
          className="absolute inset-[-4px] rounded-full bg-transparent p-0"
        />
      </span>
      {layout === "row" && <span className={cn("text-xs font-medium tracking-wide uppercase", active ? "text-silkscreen" : "text-silkscreen-3")}>{label}</span>}
      <span className={cn("font-semibold text-silkscreen tabular-nums", layout === "row" ? "text-sm" : "text-sm")}>
        {formatValue(value, spec)}
        {spec.unit && <small className="ml-0.5 text-xs font-medium text-silkscreen-3">{spec.unit}</small>}
      </span>
    </div>
  );
}
