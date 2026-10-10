// Audition on the simulated pedal: the proposal reaches the pedal through the Rig's live edits, and putting it
// back restores the blocks.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rebuildPrst } from "@/gp5/lib/prst.mjs";
import { useHistory } from "@/screens/rig/history";
import { getMock, getSession, toPresetState, useDevice } from "@/state/device";
import type { BlockState } from "@/state/device-types";
import { auditionProposal, restoreBlocks } from "./apply";
import { proposePreset } from "./proposal";
import { analysisFixture } from "./test-signals";

// The simulator loads the bundled backup by URL; serve those URLs from disk (paths are relative to the app root).
vi.stubGlobal("fetch", async (url: string) => new Response(readFileSync(resolve(`.${decodeURIComponent(url)}`))));

/** Model, on/off and the catalog params of a block (what the pedal plays). */
const played = (b: BlockState) => ({
  fxid: b.fxid,
  enabled: b.enabled,
  params: Object.fromEntries((b.model?.params ?? []).map((p) => [p.name, b.params[p.index]])),
});

/** The blocks in the simulator's live buffer, read over MIDI (queued behind the live edits still in flight). */
async function pedalBlocks(): Promise<BlockState[]> {
  const body: Uint8Array = await getSession()!.readCurrentBody();
  const p = useDevice.getState().preset!;
  return toPresetState(p.slot, rebuildPrst(p.name, body, "gp5")).blocks;
}

describe("auditionProposal on the simulated pedal", () => {
  beforeAll(async () => {
    await useDevice.getState().connect("mock");
  });
  afterAll(async () => {
    await useDevice.getState().disconnect();
  });

  it("plays every proposed block live, records it in the Rig history and writes nothing", async () => {
    const proposal = proposePreset(analysisFixture());
    const before = useDevice.getState().preset!.blocks.map(played);
    const savedBefore = useDevice.getState().saved;
    const slot = useDevice.getState().slot!;
    const flashBefore = getMock()!.slots[slot].body.slice();

    const snapshots = await auditionProposal(proposal);
    expect(snapshots).toHaveLength(10);
    const live = await pedalBlocks();
    for (const b of proposal.blocks) {
      const now = played(live[b.index]);
      expect(now.enabled, b.code).toBe(b.enabled);
      if (b.fxid === null) {
        expect(now.fxid, b.code).toBe(before[b.index].fxid);
        continue;
      }
      expect(now.fxid, b.code).toBe(b.fxid);
      for (const s of b.settings) expect(now.params[s.name], `${b.code} ${s.name}`).toBeCloseTo(s.value, 3);
    }
    expect(live[7].model?.name).toBe("Pure");
    expect(played(live[7]).params.Time).toBe(375);
    // The Rig shows it as unsaved changes; the slot itself is untouched.
    expect(useDevice.getState().preset!.blocks.map(played)).toEqual(live.map(played));
    expect(useDevice.getState().saved).toEqual(savedBefore);
    expect(useDevice.getState().unsavedChanges).toBeGreaterThan(0);
    expect(getMock()!.slots[slot].body).toEqual(flashBefore);
    expect(useHistory.getState().past.some((e) => e.kind === "block" && e.label === "Tone Match AMP")).toBe(true);

    await restoreBlocks(snapshots);
    expect((await pedalBlocks()).map(played)).toEqual(before);
    expect(useDevice.getState().unsavedChanges).toBe(0);
  }, 60_000);

  it("refuses to audition without a connected pedal", async () => {
    await useDevice.getState().disconnect();
    await expect(auditionProposal(proposePreset(analysisFixture()))).rejects.toThrow(/Connect the GP-5/);
  });
});
