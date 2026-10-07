import type { ReactNode } from "react";
import { fit, voiceFor } from "./art";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Defs, Grille, KnobArt, T } from "./parts";
import { paramTitle, type GearBaseProps } from "./types";

export interface AmpProps extends GearBaseProps {
  /** Catalog amp type: Clean | Drive | Hi Gain | Bass | Acoustic (sets the voicing colour) */
  type?: string;
}

/** Amp head: matte body, perforated grille with the logo, control strip with LED-ring knobs. */
export function AmpHead({ name, type, on = true, knobs = [], interactive, disabled, focus, onKnobChange, className, style }: AmpProps) {
  return (
    <GearFrame
      view={[240, 120]}
      label={`${name} amplifier head`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const voice = voiceFor(type);
        const ks = knobs.filter((k) => !k.toggle).slice(0, 7);
        const controls: Control[] = [];
        const x0 = 52;
        const x1 = 206;
        const step = ks.length > 1 ? (x1 - x0) / (ks.length - 1) : 0;
        const focusId = active ?? focus;
        const dials: ReactNode[] = ks.map((k, i) => {
          const x = ks.length === 1 ? (x0 + x1) / 2 : x0 + i * step;
          controls.push({ kind: "slider", id: k.id, label: `${name} ${paramTitle(k.label)}`, value: k.value, spec: k, onChange: onKnobChange && ((v) => onKnobChange(k.id, v)), x: x - 11, y: 73, w: 22, h: 22 });
          return (
            <g key={k.id}>
              <KnobArt id={id} cx={x} cy={84} r={6.4} value={k.value} min={k.min} max={k.max} dark ring={voice} track="rgba(255,255,255,.14)" focus={k.id === focusId} />
              <T x={x} y={103.5} fill="#fff" size={4.4} opacity={0.6}>
                {k.label.toUpperCase()}
              </T>
            </g>
          );
        });
        const art = (
          <>
            <Defs id={id} body="#1a1a1d" />
            <rect x="80" y="2" width="80" height="8" rx="4" fill="#232327" />
            <rect x="2" y="7" width="236" height="111" rx="14" fill={`url(#body${id})`} />
            <rect x="2.5" y="7.5" width="235" height="110" rx="13.5" fill="none" stroke="#fff" strokeOpacity={0.14} />
            <Grille id={id} x={12} y={17} w={216} h={44} r={8} />
            <T x={22} y={49} fill="#fff" size={fit(name, 120, 15)} weight={650} anchor="start" spacing={-0.3}>
              {name}
            </T>
            <rect x="12" y="68" width="216" height="40" rx="8" fill="#0b0b0d" stroke="#fff" strokeOpacity={0.08} />
            <rect x="20" y="86" width="12" height="4" rx="2" fill={on ? voice : "#2a2a2e"} />
            {dials}
          </>
        );
        return { art, controls };
      }}
    />
  );
}

/** Speaker cabinet: perforated grille, cones from the model name (1x8, 2x12, 4x12), "IR" for User IR slots. */
export function Cab({ name, className, style }: Pick<GearBaseProps, "name" | "className" | "style">) {
  return (
    <GearFrame
      view={[240, 170]}
      label={`${name} speaker cabinet`}
      className={className}
      style={style}
      render={(id) => {
        const m = /(\d)x(\d+)/i.exec(name);
        const isIR = /User IR|IR\b/i.test(name);
        const n = m ? Number(m[1]) : isIR ? 0 : 2;
        const W = 240;
        const H = 170;
        const spots =
          n === 1
            ? [[120, 80, 46]]
            : n === 2
              ? [[74, 80, 40], [166, 80, 40]]
              : n >= 4
                ? [[74, 54, 30], [166, 54, 30], [74, 110, 30], [166, 110, 30]]
                : [];
        const art = (
          <>
            <Defs id={id} body="#19191c">
              <radialGradient id={`cone${id}`} cx=".5" cy=".5" r=".5">
                <stop offset=".12" stopColor="#000" stopOpacity={0.92} />
                <stop offset=".22" stopColor="#000" stopOpacity={0.55} />
                <stop offset=".85" stopColor="#000" stopOpacity={0.4} />
                <stop offset="1" stopColor="#000" stopOpacity={0} />
              </radialGradient>
            </Defs>
            <rect x="2" y="2" width="236" height="166" rx="14" fill={`url(#body${id})`} />
            <rect x="2.5" y="2.5" width="235" height="165" rx="13.5" fill="none" stroke="#fff" strokeOpacity={0.14} />
            <Grille id={id} x={12} y={12} w={216} h={146} r={9} />
            {spots.map(([x, y, r]) => (
              <g key={`${x}-${y}`}>
                <circle cx={x} cy={y} r={r} fill={`url(#cone${id})`} />
                <circle cx={x} cy={y} r={(r * 0.9).toFixed(1)} fill="none" stroke="#fff" strokeOpacity={0.09} strokeWidth={1.4} />
                <circle cx={x} cy={y} r={(r * 0.26).toFixed(1)} fill="none" stroke="#fff" strokeOpacity={0.08} />
              </g>
            ))}
            {isIR && (
              <T x={120} y={92} fill="#fff" size={22} weight={700} opacity={0.55}>
                IR
              </T>
            )}
            <rect x={W / 2 - 40} y={H - 30} width="80" height="13" rx="6.5" fill="#1d1d21" stroke="#fff" strokeOpacity={0.14} strokeWidth={0.6} />
            <T x={W / 2} y={H - 21} fill="#fff" size={fit(name, 74, 7)}>
              {name}
            </T>
          </>
        );
        return { art, controls: [] };
      }}
    />
  );
}

/** Full-width amp control surface (bottom of Rig): input jack, LED-ring knobs with values above, toggles, power. */
export function AmpPanel({ name, type, on = true, knobs = [], interactive, disabled, focus, onKnobChange, onToggleOn, className, style }: AmpProps) {
  return (
    <GearFrame
      view={[1200, 124]}
      label={`${name} amplifier controls`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const voice = voiceFor(type);
        const ks = knobs.filter((k) => !k.toggle).slice(0, 8);
        const tg = knobs.filter((k) => k.toggle).slice(0, 2);
        const W = 1200;
        const H = 124;
        const controls: Control[] = [];
        const parts: ReactNode[] = [];
        const focusId = active ?? focus;
        let x = 120;
        for (const t of tg) {
          const tOn = t.value >= 0.5;
          const cx = x;
          controls.push({ kind: "switch", id: t.id, label: `${name} ${paramTitle(t.label)}`, on: tOn, onToggle: onKnobChange && ((v) => onKnobChange(t.id, v ? 1 : 0)), x: cx - 20, y: 46, w: 40, h: 28 });
          parts.push(
            <g key={t.id}>
              <rect x={cx - 15} y="52" width="30" height="16" rx="8" fill={tOn ? voice : "rgba(255,255,255,.12)"} />
              <circle cx={tOn ? cx + 7 : cx - 7} cy="60" r="6.4" fill="#fff" />
              <T x={cx} y={88} fill="#fff" size={9} opacity={0.6} spacing={0.8}>
                {t.label.toUpperCase()}
              </T>
            </g>,
          );
          x += 70;
        }
        const kx0 = x + 34;
        const kx1 = W - 400;
        const step = ks.length > 1 ? (kx1 - kx0) / (ks.length - 1) : 0;
        ks.forEach((k, i) => {
          const cx = ks.length === 1 ? (kx0 + kx1) / 2 : kx0 + i * step;
          const foc = k.id === focusId;
          controls.push({ kind: "slider", id: k.id, label: `${name} ${paramTitle(k.label)}`, value: k.value, spec: k, onChange: onKnobChange && ((v) => onKnobChange(k.id, v)), x: cx - 30, y: 28, w: 60, h: 60 });
          parts.push(
            <g key={k.id}>
              <KnobArt id={id} cx={cx} cy={58} r={22} value={k.value} min={k.min} max={k.max} dark ring={voice} track="rgba(255,255,255,.12)" focus={foc} />
              <T x={cx} y={104} fill="#fff" size={10.5} opacity={0.62} spacing={1}>
                {paramTitle(k.label).toUpperCase()}
              </T>
              <T x={cx} y={20} fill="#fff" size={11} weight={650} opacity={foc ? 1 : 0.85}>
                {formatValue(k.value, k)}
              </T>
            </g>,
          );
        });
        controls.push({ kind: "fs", id: "power", label: `${name} power`, on, onToggle: onToggleOn, x: W - 92, y: 42, w: 56, h: 36 });
        const typeLabel = (type || "Hi Gain").toUpperCase() + " AMP";
        const art = (
          <>
            <Defs id={id} body="#18181b" />
            <rect x="0" y="0" width={W} height={H} rx="20" fill={`url(#body${id})`} />
            <rect x=".5" y=".5" width={W - 1} height={H - 1} rx="19.5" fill="none" stroke="#fff" strokeOpacity={0.12} />
            <path d={`M40 1h${W - 80}`} stroke="#fff" strokeOpacity={0.28} strokeLinecap="round" />
            <circle cx="58" cy="62" r="17" fill="#0b0b0d" stroke="#fff" strokeOpacity={0.14} />
            <circle cx="58" cy="62" r="10" fill={`url(#steel${id})`} />
            <circle cx="58" cy="62" r="4.6" fill="#050506" />
            <T x={58} y={100} fill="#fff" size={9} opacity={0.5} spacing={1}>
              INPUT
            </T>
            {parts}
            <rect x={W - 360} y="34" width="1" height="56" fill="#fff" fillOpacity={0.1} />
            <T x={W - 330} y={60} fill="#fff" size={fit(name, 230, 30)} weight={680} anchor="start" spacing={-0.8}>
              {name}
            </T>
            <T x={W - 330} y={84} fill={voice} size={9.5} weight={650} anchor="start" spacing={1.4}>
              {typeLabel}
            </T>
            <rect x={W - 86} y="48" width="44" height="24" rx="12" fill={on ? "#34c759" : "rgba(255,255,255,.14)"} />
            <circle cx={on ? W - 54 : W - 74} cy="60" r="9.6" fill="#fff" />
            <T x={W - 64} y={92} fill="#fff" size={9} opacity={0.55} spacing={1}>
              {on ? "ON" : "STANDBY"}
            </T>
          </>
        );
        return { art, controls };
      }}
    />
  );
}
