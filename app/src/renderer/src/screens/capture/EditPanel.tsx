import { useEffect, useId, useState, type ReactNode } from "react";
import { CircleCheck, RotateCcw } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { CaptureMetadata, CaptureRecipe, Shaping } from "@shared/host/capture";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Capture, Dial } from "@/components/gear";
import { cn } from "@/lib/utils";
import { formatKhz, type NamInfo } from "./nam/model";
import { fmtDb, levelGainDb, LOUDNESS_TARGETS, TRIM_RANGE } from "./nam/recipe";
import { chainResponseDb, FLAT_SHAPING, isFlat, postFilters, preFilters, SHAPING_RANGES, type FilterSpec } from "./nam/shaping";
import { useCapture, useShownRecipe, type EditTab } from "./store";
import { fmtInt, PANEL, useCaptureTitle, useToneRecord } from "./parts";
import { ViewingBar } from "./Versions";
import { useTones } from "@/screens/tones/store";

const NS = "var(--block-ns)";

/** NAM metadata vocabulary (neural-amp-modeler `GearType` / `ToneType`); other values in a file are kept as they are. */
const GEAR_TYPES: [string, string][] = [
  ["amp", "Amp"],
  ["pedal", "Pedal"],
  ["pedal_amp", "Pedal + amp"],
  ["amp_cab", "Amp + cab"],
  ["amp_pedal_cab", "Pedal + amp + cab"],
  ["preamp", "Preamp"],
  ["studio", "Studio"],
];
const TONE_TYPES: [string, string][] = [
  ["clean", "Clean"],
  ["overdrive", "Overdrive"],
  ["crunch", "Crunch"],
  ["hi_gain", "High gain"],
  ["fuzz", "Fuzz"],
];
const NONE = "__none";

function LosslessNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-silkscreen-3">
      <CircleCheck className="size-3.5 flex-none text-led-on" aria-hidden />
      {children}
    </p>
  );
}

export function EditPanel({ versionsButton }: { versionsButton: ReactNode }) {
  const loaded = useCapture((s) => s.loaded)!;
  const { tab, set } = useCapture();
  const recipe = useShownRecipe();
  const readOnly = useCapture((s) => s.viewing !== null);
  if (!recipe) return null;
  const isA2 = loaded.info.arch.kind === "A2";
  return (
    <section aria-label="Edit" className={cn(PANEL, "col-start-1 row-start-2 flex flex-col")}>
      <Tabs value={tab} onValueChange={(v) => set({ tab: v as EditTab })} className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <TabsList aria-label="Edit">
            <TabsTrigger value="info" aria-keyshortcuts="Control+1">
              Info
            </TabsTrigger>
            <TabsTrigger value="level" aria-keyshortcuts="Control+2">
              Level
            </TabsTrigger>
            {isA2 && (
              <TabsTrigger value="size" aria-keyshortcuts="Control+3">
                Size
              </TabsTrigger>
            )}
            <TabsTrigger value="shape" aria-keyshortcuts="Control+4">
              Shape before GP-5
            </TabsTrigger>
          </TabsList>
          {versionsButton}
        </div>
        <ViewingBar />
        <TabsContent value="info" className={TAB}>
          <InfoTab recipe={recipe} info={loaded.info} readOnly={readOnly} version={loaded.info.version} architecture={loaded.file.architecture} />
        </TabsContent>
        <TabsContent value="level" className={TAB}>
          <LevelTab recipe={recipe} info={loaded.info} readOnly={readOnly} />
        </TabsContent>
        {isA2 && (
          <TabsContent value="size" className={TAB}>
            <SizeTab recipe={recipe} info={loaded.info} readOnly={readOnly} />
          </TabsContent>
        )}
        <TabsContent value="shape" className={TAB}>
          <ShapeTab recipe={recipe} info={loaded.info} readOnly={readOnly} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

const TAB = "flex min-h-0 flex-col gap-3.5 overflow-auto px-[18px] py-4";

// ---------------------------------------------------------------------------------------------- Info

function InfoTab({ recipe, info, readOnly, version, architecture }: { recipe: CaptureRecipe; info: NamInfo; readOnly: boolean; version: string; architecture: string }) {
  const edit = useCapture((s) => s.edit);
  const setMeta = (patch: Partial<CaptureMetadata>, group: string) => edit((r) => ({ ...r, metadata: { ...r.metadata, ...patch } }), group);
  const m = recipe.metadata;
  const text = (key: "name" | "modeled_by" | "gear_make" | "gear_model", label: string) => (
    <Field label={label}>
      {(id) => <Input id={id} value={m[key]} disabled={readOnly} placeholder="Not set" onChange={(e) => setMeta({ [key]: e.target.value }, `meta:${key}`)} />}
    </Field>
  );
  return (
    <>
      <LosslessNote>Lossless. These change the file's details, not its sound.</LosslessNote>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {text("name", "Name")}
        {text("modeled_by", "Modeled by")}
        {text("gear_make", "Gear make")}
        {text("gear_model", "Gear model")}
        <Field label="Gear type">
          {(id) => <VocabSelect id={id} value={m.gear_type} options={GEAR_TYPES} disabled={readOnly} onChange={(v) => setMeta({ gear_type: v }, "meta:gear_type")} />}
        </Field>
        <Field label="Tone type">
          {(id) => <VocabSelect id={id} value={m.tone_type} options={TONE_TYPES} disabled={readOnly} onChange={(v) => setMeta({ tone_type: v }, "meta:tone_type")} />}
        </Field>
        <Field label="Calibration input" hint="hosts match drive to this">
          {(id) => <DbuField id={id} value={m.input_level_dbu} disabled={readOnly} onChange={(v) => setMeta({ input_level_dbu: v }, "meta:in")} />}
        </Field>
        <Field label="Calibration output">
          {(id) => <DbuField id={id} value={m.output_level_dbu} disabled={readOnly} onChange={(v) => setMeta({ output_level_dbu: v }, "meta:out")} />}
        </Field>
      </div>
      <dl className="m-0 grid grid-cols-4 gap-x-4 gap-y-2.5 rounded-lg bg-well px-3.5 py-3">
        <Fact term="Format" value={`NAM ${version}, ${info.arch.kind === "A2" ? "A2" : architecture}`} />
        <Fact term="Sample rate" value={info.sampleRate !== null ? formatKhz(info.sampleRate) : "Not stated"} />
        <Fact term="Receptive field" value={info.receptiveField !== null && info.sampleRate ? `${Math.round((info.receptiveField / info.sampleRate) * 1000)} ms` : "Unknown"} />
        <Fact term="Loudness" value={info.loudness !== null ? fmtDb(info.loudness) : "Not stated"} />
      </dl>
    </>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-silkscreen-3">{term}</dt>
      <dd className="m-0 mt-0.5 truncate text-[12px] text-silkscreen">{value}</dd>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-[11px] font-medium tracking-[0.04em] text-silkscreen-3 uppercase">
          {label}
        </Label>
        {hint && <span className="text-[11px] text-silkscreen-4">{hint}</span>}
      </div>
      {children(id)}
    </div>
  );
}

function VocabSelect({ id, value, options, disabled, onChange }: { id: string; value: string; options: [string, string][]; disabled: boolean; onChange: (v: string) => void }) {
  const known = options.some(([v]) => v === value);
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={NONE}>Not set</SelectItem>
          {value && !known && <SelectItem value={value}>{value}</SelectItem>}
          {options.map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** Number input in dBu; empty = not set. Keeps what is typed until it parses. */
function DbuField({ id, value, disabled, onChange }: { id: string; value: number | null; disabled: boolean; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((t) => (Number(t.replace(",", ".")) === value || (t.trim() === "" && value === null) ? t : value === null ? "" : String(value)));
  }, [value]);
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder="Not set"
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === "") onChange(null);
          else {
            const n = Number(t.replace(",", "."));
            if (Number.isFinite(n) && Math.abs(n) <= 60) onChange(n);
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>dBu</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

// ---------------------------------------------------------------------------------------------- Level

function LevelTab({ recipe, info, readOnly }: { recipe: CaptureRecipe; info: NamInfo; readOnly: boolean }) {
  const edit = useCapture((s) => s.edit);
  const gain = levelGainDb(recipe, info.loudness);
  const selectId = useId();
  if (!info.levelEditable) {
    return <p className="text-[12px] text-silkscreen-2">This model's output level can't be changed losslessly (its layout doesn't keep the output scale as the last weight).</p>;
  }
  const isA2 = info.arch.kind === "A2";
  return (
    <>
      <LosslessNote>{isA2 ? "Lossless. Only the output level changes, in both sizes." : "Lossless. Only the output level changes."}</LosslessNote>
      <div className="flex flex-wrap items-center gap-6">
        <Dial
          label="Output trim"
          value={recipe.trimDb}
          spec={{ ...TRIM_RANGE, unit: "dB" }}
          size={72}
          color={NS}
          disabled={readOnly}
          onChange={(v) => edit((r) => ({ ...r, trimDb: v }), "trim")}
        />
        <div className="flex w-[240px] flex-col gap-1.5">
          <Label htmlFor={selectId} className="text-[11px] font-medium tracking-[0.04em] text-silkscreen-3 uppercase">
            Match loudness
          </Label>
          <Select
            value={recipe.loudnessTarget === null ? "off" : String(recipe.loudnessTarget)}
            onValueChange={(v) => edit((r) => ({ ...r, loudnessTarget: v === "off" ? null : Number(v) }))}
            disabled={readOnly || info.loudness === null}
          >
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {LOUDNESS_TARGETS.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {t === -18 ? "−18 dB, like most TONE3000 tones" : fmtDb(t)}
                  </SelectItem>
                ))}
                <SelectItem value="off">Off</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {info.loudness === null && <span className="text-[11px] text-silkscreen-3">This file doesn't state its loudness, so it can't be matched.</span>}
        </div>
        {info.loudness !== null && (
          <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-[12px] text-silkscreen-3">
            <dt>Original</dt>
            <dd className="m-0 text-right font-semibold text-silkscreen tabular-nums">{fmtDb(info.loudness)}</dd>
            <dt>After trim</dt>
            <dd className="m-0 text-right font-semibold text-silkscreen tabular-nums">{fmtDb(info.loudness + gain)}</dd>
          </dl>
        )}
      </div>
      <p className="text-[12px] text-silkscreen-3">
        Output change {fmtDb(gain)}: the file's output scale is multiplied by {(10 ** (gain / 20)).toFixed(3)}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Size

function SizeTab({ recipe, info, readOnly }: { recipe: CaptureRecipe; info: NamInfo; readOnly: boolean }) {
  const edit = useCapture((s) => s.edit);
  if (info.arch.kind !== "A2") return null;
  const full = info.arch.submodels.find((s) => s.size === "full");
  const lite = info.arch.submodels.find((s) => s.size === "lite");
  if (!full || !lite) {
    return <p className="text-[12px] text-silkscreen-2">This file holds one size only ({full ? "Full" : "Lite"}, {fmtInt((full ?? lite)!.params)} params), so there's nothing to choose.</p>;
  }
  const cards = [
    { value: "both", title: "Both sizes", params: full.params + lite.params, text: "Plug-ins pick Full or Lite. Same as the original file." },
    { value: "full", title: "Full only", params: full.params, text: "Most accurate. For desktop plug-ins." },
    { value: "lite", title: "Lite only", params: lite.params, text: "For small hardware that runs A2." },
  ];
  return (
    <>
      <LosslessNote>Lossless. Choose which sizes the exported A2 keeps.</LosslessNote>
      <RadioGroupPrimitive.Root
        aria-label="Sizes to export"
        value={recipe.size}
        disabled={readOnly}
        onValueChange={(v) => edit((r) => ({ ...r, size: v as CaptureRecipe["size"] }))}
        className="grid grid-cols-3 gap-2.5"
      >
        {cards.map((c) => (
          <RadioGroupPrimitive.Item
            key={c.value}
            value={c.value}
            className="flex flex-col items-start gap-1 rounded-lg px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_var(--seam-strong)] hover:bg-accent disabled:opacity-60 data-[state=checked]:bg-faceplate-raised data-[state=checked]:shadow-[inset_0_0_0_2px_var(--silkscreen)]"
          >
            <b className="font-semibold">{c.title}</b>
            <span className="text-[18px] font-semibold text-silkscreen tabular-nums">
              {fmtInt(c.params)} <small className="text-[11px] font-medium text-silkscreen-3">params</small>
            </span>
            <span className="text-[11px] text-pretty text-silkscreen-3">{c.text}</span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      <p className="text-[12px] text-silkscreen-3">The GP-5 SnapTone is made from the largest size the exported file keeps, like Valeton Suite does.</p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Shape

type DialDef = { key: keyof Shaping; label: string; unit: string; scale?: number };
const PRE: DialDef[] = [
  { key: "driveDb", label: "Input drive", unit: "dB" },
  { key: "lowCutHz", label: "Low cut", unit: "Hz" },
  { key: "tightPct", label: "Tight", unit: "%" },
];
const POST: DialDef[] = [
  { key: "bassDb", label: "Bass", unit: "dB" },
  { key: "midDb", label: "Mid", unit: "dB" },
  { key: "trebleDb", label: "Treble", unit: "dB" },
  { key: "highCutHz", label: "High cut", unit: "kHz", scale: 1000 },
];

function ShapeTab({ recipe, info, readOnly }: { recipe: CaptureRecipe; info: NamInfo; readOnly: boolean }) {
  const edit = useCapture((s) => s.edit);
  const record = useToneRecord();
  const image = useTones((st) => (record?.image_url ? (st.images[record.image_url] ?? undefined) : undefined));
  const title = useCaptureTitle();
  const s = recipe.shaping;
  const isA2 = info.arch.kind === "A2";
  const dial = (d: DialDef) => {
    const r = SHAPING_RANGES[d.key];
    const k = d.scale ?? 1;
    return (
      <Dial
        key={d.key}
        label={d.label}
        value={s[d.key] / k}
        spec={{ min: r.min / k, max: r.max / k, step: r.step / k, unit: d.unit }}
        size={52}
        color={NS}
        disabled={readOnly}
        className="w-[62px] [&>span:first-child]:tracking-normal [&>span:first-child]:whitespace-nowrap [&>span:first-child]:normal-case"
        onChange={(v) => edit((rc) => ({ ...rc, shaping: { ...rc.shaping, [d.key]: Math.round(v * k * 100) / 100 } }), `shape:${d.key}`)}
      />
    );
  };
  return (
    <>
      <div className="flex items-center gap-2.5 text-[12px] text-pretty text-silkscreen-2">
        <Badge variant="warn" className="flex-none">
          Not lossless
        </Badge>
        Heard in {isA2 ? "A and B" : "A"} and kept with the version for making a GP-5 version. Your {isA2 ? "A2 " : ""}file stays as captured.
      </div>
      <div className="relative flex items-center justify-between gap-2 rounded-lg bg-well px-3 pt-3.5 pb-3 before:absolute before:inset-x-4 before:top-1/2 before:h-0.5 before:bg-cable">
        <DialGroup title="Before the capture">{PRE.map(dial)}</DialGroup>
        <div className="relative z-[1] flex flex-col items-center gap-1.5">
          <Capture name={title} image={image} caption={isA2 ? "NAM A2" : "NAM A1"} className="w-[70px]" />
          <span className="flex items-center gap-1.5 text-[11px] text-silkscreen-2">
            <span className="size-2 rounded-full bg-block-ns" aria-hidden />
            {isA2 ? "A2-Full" : "A1"}
          </span>
        </div>
        <DialGroup title="After the capture">{POST.map(dial)}</DialGroup>
      </div>
      <ResponseCurve shaping={s} />
      <div className="mt-auto flex items-center gap-3 text-[12px]">
        <Button variant="ghost" size="sm" disabled={readOnly || isFlat(s)} onClick={() => edit((r) => ({ ...r, shaping: { ...FLAT_SHAPING } }))}>
          <RotateCcw className="size-3.5" aria-hidden />
          Reset shaping
        </Button>
        <span className="text-pretty text-silkscreen-3">Shaping never changes the exported {isA2 ? "A2 " : ""}file. It's part of the version's recipe.</span>
      </div>
    </>
  );
}

function DialGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative z-[1] flex flex-col gap-2 rounded-lg bg-surface-solid px-1.5 pt-2.5 pb-2">
      <span className="pl-1.5 text-[12px] text-silkscreen-3">{title}</span>
      <div className="flex">{children}</div>
    </div>
  );
}

const W = 1000;
const H = 200;
const xOf = (f: number) => (Math.log10(f / 20) / 3) * W;

function ResponseCurve({ shaping }: { shaping: Shaping }) {
  const mid = H / 2;
  const dbPx = (H / 2 - 6) / 12;
  const path = (filters: FilterSpec[]) => {
    let d = "";
    for (let i = 0; i <= 160; i++) {
      const f = 20 * 10 ** ((3 * i) / 160);
      const y = Math.min(H + 4, Math.max(-4, mid - chainResponseDb(filters, f) * dbPx));
      d += `${i ? "L" : "M"}${xOf(f).toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  };
  return (
    <div className="flex min-h-[110px] flex-1 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium tracking-[0.04em] text-silkscreen-3 uppercase">Response of these settings</span>
        <span className="text-[11px] text-silkscreen-3">Dashed before the capture · solid after</span>
      </div>
      <div className="relative min-h-20 flex-1 overflow-hidden rounded-lg bg-well">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" role="img" aria-label="Computed frequency response of the shaping settings">
          {[100, 1000, 10000].map((f) => (
            <line key={f} x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} className="stroke-seam" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={mid} y2={mid} className="stroke-seam-strong" vectorEffect="non-scaling-stroke" />
          <path d={path(preFilters(shaping))} fill="none" className="stroke-silkscreen-3" strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <path d={path(postFilters(shaping))} fill="none" stroke={NS} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {(
          [
            ["100 Hz", 100],
            ["1 kHz", 1000],
            ["10k", 10000],
          ] as const
        ).map(([label, f]) => (
          <span key={label} className="pointer-events-none absolute bottom-1.5 text-[11px] leading-none text-silkscreen-4" style={{ left: `calc(${(xOf(f) / W) * 100}% + 5px)` }}>
            {label}
          </span>
        ))}
        <span className="pointer-events-none absolute top-1.5 left-1.5 text-[11px] leading-none text-silkscreen-4">+12 dB</span>
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 text-[11px] leading-none text-silkscreen-4">−12 dB</span>
      </div>
    </div>
  );
}
