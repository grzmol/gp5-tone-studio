import { LayersIcon, PowerIcon } from "lucide-react";
import stageUrl from "@/assets/backdrops/stage.svg";
import { AmpHead, AmpPanel, Cab, Dial, knobsForBlock, modelTitle } from "@/components/gear";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { editEnabled, editParam } from "./edits";
import { BoardHead, ModelButton } from "./Pedalboard";
import { useRig } from "./rig-store";

const sentence = (t?: string) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : "");

/** Amp head and cabinet side by side on the stage backdrop (rig.html#amp). */
export function AmpCabView({ preset, readOnly }: { preset: PresetState; readOnly: boolean }) {
  const amp = preset.blocks[3];
  const cab = preset.blocks[4];
  const selected = useRig((s) => s.selected);
  const userIRs = useDevice((s) => s.userIRs);
  const isIR = cab.model?.type === "User IR";
  const usedIRs = userIRs?.filter((s) => s.name.trim() !== "").length;
  const cabVol = knobsForBlock(cab).find((k) => /^vol/i.test(k.label));
  const nsOn = preset.blocks[9].enabled;
  return (
    <section
      aria-label="Amp and cab"
      className="relative mx-7 my-3.5 flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden rounded-xl bg-[#0a090c] bg-cover bg-center bg-no-repeat px-6 pt-[18px] pb-5 shadow-[inset_0_0_0_1px_var(--glass-edge),inset_0_1px_0_rgb(255_255_255/0.07)] [@media(max-height:820px)]:my-2.5 [@media(max-height:820px)]:gap-2.5 [@media(max-height:820px)]:py-3"
      style={{ backgroundImage: `url(${stageUrl})` }}
    >
      <BoardHead
        title="Amp & cab"
        hint={nsOn ? "NS is on, so the SnapTone replaces the amp and cab. Their settings stay in the preset." : "The amp's controls stay in the strip below. Pick a cab or one of your 20 User IR slots."}
      />
      <div className={cn("relative grid min-h-0 flex-1 grid-cols-2", readOnly && "opacity-70", nsOn && "saturate-[.4]")}>
        <div className="flex min-h-0 flex-col items-center gap-3.5 px-6 py-1 [@media(max-height:820px)]:gap-2.5" onPointerDownCapture={() => useRig.getState().select(3)}>
          <div className="flex w-full max-w-[420px] items-center gap-3.5">
            <span className="text-sm font-semibold text-silkscreen-2">Amp</span>
            <ModelButton block={amp} selected={selected === 3} disabled={readOnly} className="flex-1" />
          </div>
          <AmpHead
            name={modelTitle(amp)}
            type={amp.model?.type}
            on={amp.enabled}
            knobs={knobsForBlock(amp)}
            interactive
            disabled={readOnly}
            onKnobChange={(id, v) => editParam(3, Number(id), v)}
            className={cn("mt-[26px] w-[400px] drop-shadow-[0_20px_28px_rgb(0_0_0/0.65)] [@media(max-height:820px)]:mt-2.5 [@media(max-height:820px)]:w-[clamp(280px,calc((100vh-560px)*1.6),400px)]", !amp.enabled && "saturate-[.2] brightness-50")}
          />
          <div className="mt-auto flex w-full max-w-[440px] items-center gap-3 rounded-pill bg-[rgb(10_10_12/0.66)] px-2.5 py-1.5 text-xs">
            {amp.model?.type && <Badge variant="outline">{sentence(amp.model.type)}</Badge>}
            <span className="min-w-0 truncate text-silkscreen-3">{amp.model?.origin ? `Modeled on ${amp.model.origin}` : modelTitle(amp)}</span>
            <span className="grow" />
            <Switch checked={amp.enabled} disabled={readOnly} onCheckedChange={(on) => editEnabled(3, on)} aria-label="Amp on" />
          </div>
        </div>
        <div className="flex min-h-0 flex-col items-center gap-3.5 px-6 py-1 [@media(max-height:820px)]:gap-2.5" onPointerDownCapture={() => useRig.getState().select(4)}>
          <div className="flex w-full max-w-[420px] items-center gap-3.5">
            <span className="text-sm font-semibold text-silkscreen-2">Cab</span>
            <ModelButton block={cab} selected={selected === 4} disabled={readOnly} className="flex-1" />
          </div>
          <Cab name={modelTitle(cab)} className={cn("w-[330px] drop-shadow-[0_20px_28px_rgb(0_0_0/0.65)] [@media(max-height:820px)]:w-[clamp(220px,calc((100vh-560px)*1.2),330px)]", !cab.enabled && "saturate-[.2] brightness-50")} />
          <div className="mt-auto flex w-full max-w-[440px] items-center gap-3 rounded-pill bg-[rgb(10_10_12/0.66)] px-2.5 py-1.5 text-xs">
            <ToggleGroup
              type="single"
              value={isIR ? "ir" : "factory"}
              disabled={readOnly}
              aria-label="Cab source"
              onValueChange={(v) => {
                if (!v || (v === "ir") === isIR) return;
                useRig.getState().select(4);
                useRig.getState().openPicker({ block: 4, tab: v === "ir" ? "User IR" : "factory" });
              }}
            >
              <ToggleGroupItem value="factory">Factory cabs</ToggleGroupItem>
              <ToggleGroupItem value="ir">{usedIRs ? `User IRs (${usedIRs})` : "User IRs"}</ToggleGroupItem>
            </ToggleGroup>
            <span className="grow" />
            {cabVol && (
              <Dial
                layout="row"
                size={40}
                label="Volume"
                ariaLabel={`${modelTitle(cab)} Volume`}
                value={cabVol.value}
                spec={cabVol}
                color="var(--block-cab)"
                disabled={readOnly}
                onChange={(v) => editParam(4, Number(cabVol.id), v)}
              />
            )}
            <Switch checked={cab.enabled} disabled={readOnly} onCheckedChange={(on) => editEnabled(4, on)} aria-label="Cab on" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The current amp's control surface, always in reach at the bottom of the Rig. Dimmed while NS replaces it. */
export function AmpStrip({ preset, readOnly }: { preset: PresetState; readOnly: boolean }) {
  const amp = preset.blocks[3];
  const nsOn = preset.blocks[9].enabled;
  const name = modelTitle(amp);
  return (
    <section aria-label={nsOn ? "Amp controls, replaced by SnapTone" : "Amp controls"} className={cn("relative mx-7 mt-2.5 mb-3.5", readOnly && "opacity-70")}>
      <span className="absolute -top-[18px] left-2 z-[1] text-xs font-medium text-silkscreen-3">Amp, {name}</span>
      <div className="absolute -top-[22px] right-1.5 z-[1] flex gap-1.5">
        {nsOn ? (
          <Button variant="secondary" size="sm" disabled={readOnly} onClick={() => editEnabled(9, false)}>
            <PowerIcon className="size-3.5" aria-hidden />
            Turn NS off
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly}
            onClick={() => {
              useRig.getState().select(3);
              useRig.getState().openPicker({ block: 3 });
            }}
          >
            <LayersIcon className="size-3.5" aria-hidden />
            Change amp
          </Button>
        )}
      </div>
      {nsOn && (
        <span className="absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-pill bg-well px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap text-block-ns shadow-[inset_0_0_0_1px_var(--block-ns)]">
          The SnapTone replaces the amp and cab while NS is on
        </span>
      )}
      <AmpPanel
        name={name}
        type={amp.model?.type}
        on={amp.enabled}
        knobs={knobsForBlock(amp)}
        interactive
        disabled={readOnly}
        onKnobChange={(id, v) => editParam(3, Number(id), v)}
        onToggleOn={(on) => editEnabled(3, on)}
        className={cn("w-full drop-shadow-[0_14px_30px_rgb(0_0_0/0.55)]", nsOn && "saturate-0 brightness-[.4]")}
      />
    </section>
  );
}
