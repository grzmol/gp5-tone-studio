// Shared SVG parts of the gear drawings: gradients, machined knob with LED value ring, slide switch, light pipe,
// steel footswitch, perforated grille. Coordinates are viewBox units of the drawing that uses them.
import type { ReactNode, SVGProps } from "react";
import { FONT, clamp01, shade as shadeStop } from "./art";

interface TextProps {
  x: number;
  y: number;
  fill: string;
  size: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  spacing?: number;
  children: ReactNode;
}

export function T({ x, y, fill, size, weight = 600, anchor = "middle", opacity, spacing, children }: TextProps) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={fill} fontFamily={FONT} fillOpacity={opacity} letterSpacing={spacing}>
      {children}
    </text>
  );
}

export function Defs({ id, body, children }: { id: string; body: string; children?: ReactNode }) {
  return (
    <defs>
      <linearGradient id={`body${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={shadeStop(body, 0.07)} />
        <stop offset=".55" stopColor={body} />
        <stop offset="1" stopColor={shadeStop(body, -0.14)} />
      </linearGradient>
      <radialGradient id={`cap${id}`} cx=".42" cy=".35" r=".75">
        <stop offset="0" stopColor="#fbfbfc" />
        <stop offset=".7" stopColor="#c9cbd0" />
        <stop offset="1" stopColor="#9ea0a6" />
      </radialGradient>
      <radialGradient id={`capd${id}`} cx=".42" cy=".35" r=".75">
        <stop offset="0" stopColor="#3a3a3e" />
        <stop offset="1" stopColor="#151517" />
      </radialGradient>
      <linearGradient id={`steel${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#eceef1" />
        <stop offset="1" stopColor="#8f9198" />
      </linearGradient>
      {children}
    </defs>
  );
}

export interface KnobArtProps {
  id: string;
  cx: number;
  cy: number;
  r: number;
  value: number;
  min: number;
  max: number;
  dark?: boolean;
  ring?: string;
  track?: string;
  focus?: boolean;
  bipolar?: boolean;
}

/** Machined knob: aluminium or anodized black cap, LED value ring around it (270° sweep). */
export function KnobArt({ id, cx, cy, r, value, min, max, dark = false, ring = "#fff", track = "rgba(255,255,255,.16)", focus = false, bipolar = false }: KnobArtProps) {
  const t = clamp01(value, min, max);
  const a0 = -225;
  const sweep = 270;
  const R = r + 3.6;
  const P = (deg: number, rr: number) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy + rr * Math.sin((deg * Math.PI) / 180)];
  const arc = (f: number, to: number) => {
    const [x0, y0] = P(f, R);
    const [x1, y1] = P(to, R);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${Math.abs(to - f) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const end = a0 + sweep * t;
  const mid = a0 + sweep / 2;
  const val = bipolar ? (Math.abs(t - 0.5) < 0.005 ? "" : t > 0.5 ? arc(mid, end) : arc(end, mid)) : t > 0.004 ? arc(a0, end) : "";
  const [dx, dy] = P(end, r * 0.62);
  return (
    <g>
      <path d={arc(a0, a0 + sweep)} fill="none" stroke={track} strokeWidth={1.6} strokeLinecap="round" />
      {val && <path d={val} fill="none" stroke={ring} strokeWidth={1.8} strokeLinecap="round" />}
      <circle cx={cx} cy={cy + r * 0.14} r={r} fill="#000" fillOpacity={0.38} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${dark ? "capd" : "cap"}${id})`} />
      <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke="#fff" strokeOpacity={dark ? 0.12 : 0.6} strokeWidth={0.6} />
      <circle cx={dx.toFixed(2)} cy={dy.toFixed(2)} r={Math.max(1, r * 0.13)} fill={dark ? "#fff" : "#1c1c1e"} />
      {focus && <circle cx={cx} cy={cy} r={R + 3.2} fill="none" stroke="#fff" strokeWidth={1} strokeOpacity={0.9} />}
    </g>
  );
}

/** Mini slide switch with its label under it. */
export function SlideSwitch({ cx, cy, on, ink, label, accent }: { cx: number; cy: number; on: boolean; ink: string; label: string; accent: string }) {
  return (
    <g>
      <rect x={cx - 7} y={cy - 3.6} width={14} height={7.2} rx={3.6} fill={on ? accent : "rgba(0,0,0,.35)"} stroke="rgba(255,255,255,.18)" strokeWidth={0.5} />
      <circle cx={on ? cx + 3.6 : cx - 3.6} cy={cy} r={2.8} fill="#fff" />
      <T x={cx} y={cy + 10} fill={ink} size={4.4} opacity={0.72} spacing={0.25}>
        {label.toUpperCase()}
      </T>
    </g>
  );
}

/** Light pipe status bar: glows in the device colour when engaged. */
export function LightBar({ cx, cy, on, color, w = 22 }: { cx: number; cy: number; on: boolean; color: string; w?: number }) {
  return (
    <g>
      <rect x={cx - w / 2 - 1} y={cy - 2.6} width={w + 2} height={5.2} rx={2.6} fill="rgba(0,0,0,.45)" />
      {on && <rect x={cx - w / 2 - 2} y={cy - 3.4} width={w + 4} height={6.8} rx={3.4} fill={color} opacity={0.28} />}
      <rect x={cx - w / 2} y={cy - 1.6} width={w} height={3.2} rx={1.6} fill={on ? color : "#2a2a2e"} />
    </g>
  );
}

export function FootswitchArt({ id, cx, cy, r = 11 }: { id: string; cx: number; cy: number; r?: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy + r * 0.55} rx={r * 1.05} ry={r * 0.42} fill="#000" fillOpacity={0.35} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#steel${id})`} />
      <circle cx={cx} cy={cy} r={r * 0.72} fill="none" stroke="#000" strokeOpacity={0.14} />
      <circle cx={cx} cy={cy} r={r - 0.4} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={0.6} />
    </g>
  );
}

export function Grille({ id, x, y, w, h, r }: { id: string; x: number; y: number; w: number; h: number; r: number }) {
  return (
    <g>
      <pattern id={`perf${id}`} width="4.2" height="4.2" patternUnits="userSpaceOnUse">
        <rect width="4.2" height="4.2" fill="#121214" />
        <circle cx="2.1" cy="2.1" r="1.15" fill="#050506" />
      </pattern>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={`url(#perf${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke="#fff" strokeOpacity={0.08} />
    </g>
  );
}

/** Enclosure shared by pedal, EQ and capture drawings (100×150 viewBox). */
export function Enclosure({ id, light = false, ...rest }: { id: string; light?: boolean } & SVGProps<SVGGElement>) {
  return (
    <g {...rest}>
      <rect x="4" y="3" width="92" height="144" rx="15" fill={`url(#body${id})`} />
      <rect x="4.4" y="3.4" width="91.2" height="143.2" rx="14.6" fill="none" stroke="#fff" strokeOpacity={light ? 0.75 : 0.16} strokeWidth={0.8} />
    </g>
  );
}
