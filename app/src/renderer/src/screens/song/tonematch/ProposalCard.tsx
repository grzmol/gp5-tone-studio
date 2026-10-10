import { ArrowRight, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { Proposal, ProposedBlock } from "@/song/tonematch/proposal";
import { isSessionLive, useIrMatch } from "@/song/tonematch/ir-store";
import { useToneMatch } from "@/song/tonematch/store";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import { Confidence, Section } from "./parts";

const fmtSetting = (s: { name: string; value: number; unit?: string }) => `${s.name} ${Number.isInteger(s.value) ? s.value : s.value.toFixed(1)}${s.unit ? ` ${s.unit}` : ""}`;

function BlockRow({ block }: { block: ProposedBlock }) {
  const modelChange = block.fxid !== null;
  return (
    <li className={cn("grid grid-cols-[52px_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-seam py-2 first:border-t-0", !block.enabled && "opacity-80")}>
      <span className="flex items-center gap-1.5 pt-px text-[11px] font-semibold tracking-[0.04em] text-silkscreen-2">
        <span className="size-2 flex-none rounded-full" style={{ background: block.enabled ? `var(--block-${block.code.toLowerCase()})` : "var(--led-off)" }} aria-hidden />
        {block.code}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <b className="text-[13px] font-semibold">
          {modelChange && block.enabled ? block.title : block.enabled ? "On (model as it is)" : "Off"}
          {modelChange && block.enabled && block.settings.length > 0 && (
            <span className="ml-2 text-[12px] font-normal text-silkscreen-2 tabular-nums">{block.settings.map(fmtSetting).join(" · ")}</span>
          )}
        </b>
        <span className="text-[12px] text-pretty text-silkscreen-3">{block.why}</span>
      </div>
      {block.confidence === null ? <span /> : <Confidence value={block.confidence} className="pt-px" />}
    </li>
  );
}

function AuditionControls() {
  const audition = useToneMatch((s) => s.audition);
  const connected = useDevice((s) => s.status === "connected" && s.preset !== null);
  const connecting = useDevice((s) => s.status === "connecting");
  // A running IR recording has the CAB block off; changing the preset now would spoil it.
  const recording = useIrMatch((s) => isSessionLive(s.step));
  const busy = audition.kind === "applying" || audition.kind === "restoring" || recording;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!connected || busy} onClick={() => void useToneMatch.getState().auditionProposal()}>
          {audition.kind === "applying" ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
          {audition.kind === "applied" ? "Play it again" : "Play it on the GP-5"}
        </Button>
        {audition.kind === "applied" || audition.kind === "restoring" ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void useToneMatch.getState().putBack()}>
              {audition.kind === "restoring" ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
              Put back what was there
            </Button>
            <Button variant="ghost" onClick={() => useNav.getState().go("rig")}>
              Open the Rig
              <ArrowRight data-icon="inline-end" />
            </Button>
          </>
        ) : null}
        {!connected && (
          <Button variant="ghost" disabled={connecting} onClick={() => void useDevice.getState().connect("mock").catch(() => {})}>
            Use the simulated pedal
          </Button>
        )}
      </div>
      <p className={cn("text-[12px] text-pretty", audition.kind === "error" ? "text-led-fault" : "text-silkscreen-3")} role={audition.kind === "error" ? "alert" : undefined}>
        {audition.kind === "error"
          ? audition.message
          : audition.kind === "applied"
            ? "Playing on the GP-5 as unsaved changes to the active preset. To keep it, save it on the Rig; Undo on the Rig steps back block by block."
            : connected
              ? "Changes the active preset live, like edits on the Rig. Nothing is saved to a slot unless you save it."
              : "Connect the GP-5 to hear the proposal, or try it on the simulated pedal."}
      </p>
    </div>
  );
}

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  return (
    <Section title="Proposed GP-5 preset" aside={<Confidence value={proposal.confidence} />}>
      <p className="text-[13px] text-silkscreen-2">{proposal.summary}</p>
      <ul className="flex flex-col">
        {proposal.blocks.map((b) => (
          <BlockRow key={b.code} block={b} />
        ))}
      </ul>
      <AuditionControls />
    </Section>
  );
}
