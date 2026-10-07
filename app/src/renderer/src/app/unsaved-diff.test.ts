import { describe, expect, it } from "vitest";
import type { BlockState, ModelInfo, PresetState } from "@/state/device-types";
import { BLOCK_CODES } from "@/state/device-types";
import { diffPresets } from "./unsaved-diff";

const plus: ModelInfo = {
  fxid: 1,
  block: "DST",
  name: "Plustortion",
  title: "Plustortion",
  type: "Distortion",
  params: [
    { name: "Gain", index: 0, min: 0, max: 100, step: 1, default: 50 },
    { name: "Volume", index: 1, min: 0, max: 100, step: 1, default: 50 },
    { name: "Mode", index: 2, min: 0, max: 1, step: 1, default: 0, options: ["Clean", "Hot"] },
  ],
};
const other: ModelInfo = { ...plus, fxid: 2, name: "Other", title: "Other Drive" };

function preset(edit: (blocks: BlockState[]) => void = () => {}): PresetState {
  const blocks: BlockState[] = BLOCK_CODES.map((code, index) => ({ index, code, enabled: true, fxid: 1, model: plus, params: [10, 20, 0, 0, 0, 0, 0, 0] }));
  edit(blocks);
  return { slot: 63, name: "Shatte-GT1", blocks, order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], volume: 50, bpm: 120, footswitches: { fs1: [0], fs2: [1] }, prst: new Uint8Array() };
}

describe("diffPresets", () => {
  it("is empty for identical presets", () => {
    expect(diffPresets(preset(), preset())).toEqual([]);
  });

  it("lists param changes with names and enum labels", () => {
    const now = preset((b) => {
      b[2].params[1] = 60;
      b[2].params[2] = 1;
    });
    expect(diffPresets(preset(), now)).toEqual([
      { block: { code: "DST", model: "Plustortion" }, parameter: "Volume", saved: "20", now: "60" },
      { block: { code: "DST", model: "Plustortion" }, parameter: "Mode", saved: "Clean", now: "Hot" },
    ]);
  });

  it("shows a model swap as one row instead of its param changes", () => {
    const now = preset((b) => {
      b[3] = { ...b[3], fxid: 2, model: other, params: [1, 2, 3, 4, 5, 6, 7, 8] };
    });
    expect(diffPresets(preset(), now)).toEqual([{ block: { code: "AMP", model: "Other Drive" }, parameter: "Model", saved: "Plustortion", now: "Other Drive" }]);
  });

  it("reports on/off, chain order, volume and footswitch changes", () => {
    const now = { ...preset((b) => void (b[6].enabled = false)), order: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9], volume: 40, footswitches: { fs1: [0, 6], fs2: [1] } };
    expect(diffPresets(preset(), now).map((r) => [r.block?.code ?? null, r.parameter, r.saved, r.now])).toEqual([
      ["MOD", "On/off", "On", "Off"],
      [null, "Chain order", "", "Changed"],
      [null, "Volume", "50", "40"],
      [null, "Footswitches", "", "Changed"],
    ]);
  });
});
