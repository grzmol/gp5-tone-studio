import type { ReactNode } from "react";
import type { BlockCode } from "@/state/device-types";
import { BLOCK_HEX, finishFor, fit, hash, lum, type Finish } from "./art";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Defs, Enclosure, FootswitchArt, KnobArt, LightBar, SlideSwitch, T } from "./parts";
import { paramTitle, type GearBaseProps, type GearKnob } from "./types";

export type PedalLayout = "row" | "hero" | "tri" | "grid" | "dense";

export interface PedalProps extends GearBaseProps {
  block: BlockCode;
  finish?: Finish;
  /** Hue override */
  color?: string;
  layout?: PedalLayout;
}

const isBipolar = (k: GearKnob) => k.min < 0 && k.max > 0;

/** Stompbox: matte/noir/frost enclosure, machined knobs with LED value rings, light pipe, steel footswitch. */
export function Pedal(props: PedalProps) {
  const { block, name, on = true, knobs: all = [], interactive, disabled, showValues, focus, onKnobChange, onToggleOn, finish, color, layout: want, className, style } = props;
  return (
    <GearFrame
      view={[100, 150]}
      label={`${name} ${block} pedal, ${on ? "on" : "bypassed"}`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const controls: Control[] = [];
        const knobs = all.filter((k) => !k.toggle).slice(0, 9);
        const toggles = all.filter((k) => k.toggle).slice(0, 2);
        const h = hash(name);
        const f = finishFor(name, BLOCK_HEX[block], h, finish, color);
        const light = lum(f.body) > 0.6;
        const ink = light ? "#1c1c1e" : "#ffffff";
        const ring = f.kind === "noir" ? f.accent : light ? "#1c1c1e" : "#ffffff";
        const track = light ? "rgba(0,0,0,.16)" : "rgba(255,255,255,.18)";
        const darkCaps = f.kind === "frost" ? true : f.kind === "noir" ? false : (h >>> 6) % 2 === 0;
        const layout: PedalLayout =
          knobs.length > 4
            ? "dense"
            : (want ?? (knobs.length <= 1 ? "hero" : knobs.length === 3 ? (["tri", "row"] as const)[(h >>> 4) % 2] : knobs.length === 4 ? "grid" : (["row", "hero"] as const)[(h >>> 4) % 2]));
        const focusId = active ?? focus;
        const parts: ReactNode[] = [];

        const K = (k: GearKnob, x: number, y: number, r: number) => {
          const foc = k.id === focusId;
          const shown = formatValue(k.value, k);
          controls.push({
            kind: "slider",
            id: k.id,
            label: `${name} ${paramTitle(k.label)}`,
            value: k.value,
            spec: k,
            onChange: onKnobChange && ((v) => onKnobChange(k.id, v)),
            x: x - r - 5,
            y: y - r - 5,
            w: 2 * r + 10,
            h: 2 * r + 10,
          });
          const ly = y + r + 9.5;
          parts.push(
            <g key={`k${k.id}`}>
              <KnobArt id={id} cx={x} cy={y} r={r} value={k.value} min={k.min} max={k.max} dark={darkCaps} ring={ring} track={track} focus={foc} bipolar={isBipolar(k)} />
              <T x={x} y={ly} fill={ink} size={4.6} opacity={0.72} spacing={0.3}>
                {k.label.toUpperCase()}
              </T>
              {showValues && (
                <T x={x} y={ly + 6.4} fill={ink} size={5.4} weight={650}>
                  {shown}
                </T>
              )}
              {foc && (
                <g>
                  <rect x={x - 9.5} y={y - r - 16} width={19} height={9} rx={4.5} fill="#fff" />
                  <T x={x} y={y - r - 9.4} fill="#111" size={fit(shown, 17, 5.6)} weight={700}>
                    {shown}
                  </T>
                </g>
              )}
            </g>,
          );
        };

        const hasT = toggles.length > 0;
        let ty = 86;
        if (layout === "hero" && knobs.length) {
          const rest = knobs.slice(1);
          K(knobs[0], 50, hasT && rest.length ? 50 : 54, hasT && rest.length ? 13 : 15.5);
          rest.forEach((k, i) => K(k, rest.length === 1 ? 50 : 24 + i * (52 / Math.max(1, rest.length - 1)), hasT ? 82 : 92, 7.5));
          ty = rest.length ? 104 : 86;
        } else if (layout === "tri") {
          const pos = hasT ? [[27, 42], [73, 42], [50, 68]] : [[27, 46], [73, 46], [50, 74]];
          knobs.slice(0, 3).forEach((k, i) => K(k, pos[i][0], pos[i][1], hasT ? 9 : 10));
          ty = 102;
        } else if (layout === "grid") {
          const pos = hasT ? [[30, 42], [70, 42], [30, 72], [70, 72]] : [[30, 46], [70, 46], [30, 80], [70, 80]];
          knobs.slice(0, 4).forEach((k, i) => K(k, pos[i][0], pos[i][1], hasT ? 8.5 : 9.5));
          ty = 102;
        } else if (layout === "dense") {
          // more than four knobs (not in gear.js): three columns of small knobs
          const rows = Math.ceil(knobs.length / 3);
          const dy = rows > 2 ? 22 : 28;
          knobs.forEach((k, i) => {
            const row = Math.floor(i / 3);
            const inRow = Math.min(3, knobs.length - row * 3);
            const x = inRow === 1 ? 50 : 22 + (56 * (i % 3)) / (inRow - 1);
            K(k, x, 38 + row * dy, rows > 2 ? 6 : 7);
          });
          ty = 38 + rows * dy + (rows > 2 ? 0 : -2);
        } else {
          const n = Math.max(1, knobs.length);
          const r = n >= 3 ? 9 : 11;
          knobs.forEach((k, i) => K(k, n === 1 ? 50 : 20 + (60 * i) / (n - 1), 50, r));
          ty = 88;
        }
        const tall = hasT && ty > 96;
        const lbY = tall ? 121 : 116;
        const fsY = tall ? 136 : 132;
        const fsR = lbY > 116 ? 8.5 : 9.5;
        toggles.forEach((t, i) => {
          const cx = toggles.length === 1 ? 50 : 36 + i * 28;
          const tOn = t.value >= 0.5;
          controls.push({
            kind: "switch",
            id: t.id,
            label: `${name} ${paramTitle(t.label)}`,
            on: tOn,
            onToggle: onKnobChange && ((v) => onKnobChange(t.id, v ? 1 : 0)),
            x: cx - 11,
            y: ty - 8,
            w: 22,
            h: 16,
          });
          parts.push(<SlideSwitch key={`t${t.id}`} cx={cx} cy={ty} on={tOn} ink={ink} label={t.label} accent={f.kind === "matte" ? (light ? "#1c1c1e" : "rgba(255,255,255,.9)") : f.accent} />);
        });
        controls.push({ kind: "fs", id: "fs", label: `${name} ${block}`, on, onToggle: onToggleOn, x: 50 - fsR - 3, y: fsY - fsR - 3, w: 2 * fsR + 6, h: 2 * fsR + 6 });

        const art = (
          <>
            <Defs id={id} body={f.body} />
            <Enclosure id={id} light={light} />
            <path d="M18 3.6h64" stroke="#fff" strokeOpacity={light ? 0.9 : 0.32} strokeWidth={0.8} strokeLinecap="round" />
            {f.kind === "noir" && (
              <>
                <clipPath id={`clip${id}`}>
                  <rect x="4" y="3" width="92" height="144" rx="15" />
                </clipPath>
                <rect x="4" y="3" width="92" height="5" fill={f.accent} clipPath={`url(#clip${id})`} />
              </>
            )}
            {f.kind === "frost" && <rect x="12" y="25" width="76" height="1.2" rx=".6" fill={f.accent} />}
            <T x={12} y={19} fill={ink} size={fit(name, 58, 9.2)} weight={650} anchor="start" spacing={-0.15}>
              {name}
            </T>
            <T x={88} y={18.6} fill={ink} size={5.2} anchor="end" opacity={0.5} spacing={0.4}>
              {block}
            </T>
            {parts}
            <LightBar cx={50} cy={lbY} on={on} color={f.kind === "matte" ? (light ? "#1c1c1e" : "#ffffff") : f.accent} />
            <FootswitchArt id={id} cx={50} cy={fsY} r={fsR} />
          </>
        );
        return { art, controls };
      }}
    />
  );
}
