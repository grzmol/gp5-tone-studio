import type { ReactNode } from "react";
import { BLOCK_HEX, fit } from "./art";
import { GearFrame, type Control } from "./controls";
import { formatValue } from "./knob-math";
import { Defs, Enclosure, FootswitchArt, KnobArt, LightBar, T } from "./parts";
import { paramTitle, type GearBaseProps } from "./types";

/** Graphic EQ pedal: noir body, vertical faders −50…50 per band, small volume knob when the model has one. */
export function EqPedal({ name, on = true, knobs = [], interactive, disabled, showValues, focus, onKnobChange, onToggleOn, className, style }: GearBaseProps) {
  const accent = BLOCK_HEX.EQ;
  return (
    <GearFrame
      view={[100, 150]}
      label={`${name} graphic EQ pedal, ${on ? "on" : "bypassed"}`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id, active) => {
        const controls: Control[] = [];
        const bands = knobs.filter((b) => !/^vol/i.test(b.label)).slice(0, 6);
        const vol = knobs.find((b) => /^vol/i.test(b.label));
        const n = bands.length || 5;
        const x0 = 22;
        const x1 = vol ? 66 : 78;
        const gap = (x1 - x0) / (n - 1 || 1);
        const focusId = active ?? focus;
        const faders: ReactNode[] = bands.map((b, i) => {
          const x = x0 + i * gap;
          const y = 63 - (Math.max(-50, Math.min(50, b.value)) / 50) * 26;
          const foc = b.id === focusId;
          controls.push({
            kind: "slider",
            id: b.id,
            label: `${name} ${b.label}`,
            value: b.value,
            spec: b,
            onChange: onKnobChange && ((v) => onKnobChange(b.id, v)),
            x: x - 5,
            y: 33,
            w: 10,
            h: 60,
          });
          return (
            <g key={b.id}>
              <rect x={x - 0.8} y="35" width="1.6" height="56" rx=".8" fill="#fff" fillOpacity={0.14} />
              <rect x={x - 0.8} y={Math.min(y, 63)} width="1.6" height={Math.abs(63 - y)} fill={accent} />
              <rect x={x - 5} y={y - 2.4} width="10" height="4.8" rx="2.4" fill="#f4f5f7" stroke={foc ? "#fff" : "none"} strokeWidth={foc ? 1.2 : 0} />
              {foc && (
                <g>
                  <rect x={x - 7} y={y - 12} width={14} height={7.5} rx={3.75} fill="#fff" />
                  <T x={x} y={y - 6.6} fill="#111" size={5} weight={700}>
                    {formatValue(b.value, b)}
                  </T>
                </g>
              )}
              <T x={x} y={106} fill="#fff" size={fit(b.label, 11, 4.4)} opacity={0.6}>
                {b.label.replace(/Hz$/, "")}
              </T>
              {showValues && (
                <T x={x} y={112} fill="#fff" size={4.4} weight={650}>
                  {formatValue(b.value, b)}
                </T>
              )}
            </g>
          );
        });
        if (vol)
          controls.push({
            kind: "slider",
            id: vol.id,
            label: `${name} ${paramTitle(vol.label)}`,
            value: vol.value,
            spec: vol,
            onChange: onKnobChange && ((v) => onKnobChange(vol.id, v)),
            x: 73,
            y: 54,
            w: 18,
            h: 18,
          });
        controls.push({ kind: "fs", id: "fs", label: `${name} EQ`, on, onToggle: onToggleOn, x: 37.5, y: 119.5, w: 25, h: 25 });
        const art = (
          <>
            <Defs id={id} body="#1a1a1d" />
            <Enclosure id={id} />
            <clipPath id={`clip${id}`}>
              <rect x="4" y="3" width="92" height="144" rx="15" />
            </clipPath>
            <rect x="4" y="3" width="92" height="5" fill={accent} clipPath={`url(#clip${id})`} />
            <T x={12} y={19} fill="#fff" size={fit(name, 58, 9.2)} weight={650} anchor="start">
              {name}
            </T>
            <T x={88} y={18.6} fill="#fff" size={5.2} anchor="end" opacity={0.5}>
              EQ
            </T>
            <rect x="12" y="28" width="76" height="70" rx="8" fill="rgba(0,0,0,.4)" />
            <line x1="16" x2={vol ? 74 : 84} y1="63" y2="63" stroke="#fff" strokeOpacity={0.12} strokeDasharray="1.5 2" />
            {faders}
            {vol && (
              <g>
                <KnobArt id={id} cx={82} cy={63} r={5} value={vol.value} min={vol.min} max={vol.max} dark ring={accent} track="rgba(255,255,255,.14)" focus={vol.id === focusId} />
                <T x={82} y={77} fill="#fff" size={4} opacity={0.6}>
                  VOL
                </T>
              </g>
            )}
            <LightBar cx={50} cy={showValues ? 119 : 116} on={on} color={accent} />
            <FootswitchArt id={id} cx={50} cy={132} r={9.5} />
          </>
        );
        return { art, controls };
      }}
    />
  );
}

export interface CaptureProps extends GearBaseProps {
  /** TONE3000 tone image URL; without it the drawing shows a generic waveform */
  image?: string;
  /** Sub-label under the screen, e.g. "SnapTone" or "TONE3000" */
  caption?: string;
}

/** SnapTone capture unit (NS block): screen with the tone image or a waveform, light pipe, footswitch. */
export function Capture({ name, on = true, image, caption = "SnapTone", interactive, disabled, onToggleOn, className, style }: CaptureProps) {
  const color = BLOCK_HEX.NS;
  return (
    <GearFrame
      view={[100, 150]}
      label={`${name} capture, ${on ? "on" : "off"}`}
      interactive={interactive}
      disabled={disabled}
      className={className}
      style={style}
      render={(id) => {
        const wave = "M18 56h9l5-15 7 30 7-36 7 40 6-26 5 7h18";
        const art = (
          <>
            <Defs id={id} body="#151518" />
            <clipPath id={`ci${id}`}>
              <rect x="12" y="24" width="76" height="62" rx="8" />
            </clipPath>
            <Enclosure id={id} />
            <T x={12} y={17} fill="#fff" size={fit(name, 60, 8.6)} weight={650} anchor="start">
              {name}
            </T>
            <T x={88} y={16.6} fill="#fff" size={5.2} anchor="end" opacity={0.5}>
              NS
            </T>
            <rect x="11" y="23" width="78" height="64" rx="9" fill="#050506" stroke="#fff" strokeOpacity={0.1} strokeWidth={0.6} />
            {image ? (
              <image href={image} x="12" y="24" width="76" height="62" preserveAspectRatio="xMidYMid slice" clipPath={`url(#ci${id})`} />
            ) : (
              <>
                <path d={wave} fill="none" stroke={color} strokeWidth={4.2} strokeLinejoin="round" strokeLinecap="round" opacity={on ? 0.22 : 0.08} />
                <path d={wave} fill="none" stroke={on ? color : "#4a4a50"} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            <T x={50} y={100} fill={on ? color : "#8a8a90"} size={5.4} weight={700} spacing={0.9}>
              {caption.toUpperCase()}
            </T>
            <LightBar cx={50} cy={116} on={on} color={color} />
            <FootswitchArt id={id} cx={50} cy={132} r={9.5} />
          </>
        );
        return { art, controls: [{ kind: "fs", id: "fs", label: `${name} NS`, on, onToggle: onToggleOn, x: 37.5, y: 119.5, w: 25, h: 25 }] };
      }}
    />
  );
}
