// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertWav, NamCheckError, prepareNam } from "./nam";
import { changedSlots, firstEmptySlot, modelsVerdict, proposeSlotName, sanitizeSlotName, toneVerdict } from "./tone3000";

const DIL = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const weights = [0.1, -0.2, 0.3, 0.02];

const v05 = {
  version: "0.5.4",
  architecture: "WaveNet",
  config: {
    layers: [
      { input_size: 1, condition_size: 1, head_size: 8, channels: 16, kernel_size: 3, dilations: DIL, activation: "Tanh", gated: false, head_bias: false },
      { input_size: 16, condition_size: 1, head_size: 1, channels: 8, kernel_size: 3, dilations: DIL, activation: "Tanh", gated: false, head_bias: true },
    ],
    head: null,
    head_scale: 0.02,
  },
  weights,
  sample_rate: 48000,
};

const layer07 = (input: number, channels: number, head: number, bias: boolean) => ({
  input_size: input,
  condition_size: 1,
  channels,
  bottleneck: channels,
  kernel_sizes: Array(10).fill(3),
  dilations: DIL,
  activation: Array(10).fill({ type: "Tanh" }),
  gating_mode: Array(10).fill("none"),
  secondary_activation: Array(10).fill(null),
  head: { out_channels: head, kernel_size: 1, bias },
  head1x1: { active: false },
  conv_pre_film: { active: false },
});
const v07 = {
  version: "0.7.0",
  architecture: "WaveNet",
  config: { layers: [layer07(1, 16, 8, false), layer07(16, 8, 1, true)], head: null, head_scale: 0.02 },
  weights,
  sample_rate: 48000,
  metadata: { name: "Gain 4", loudness: -20 },
};

describe("prepareNam", () => {
  it("passes a 0.5.x A1 standard file through unchanged", () => {
    const text = JSON.stringify(v05);
    const out = prepareNam(text);
    expect(out.json).toBe(text);
    expect(out.check).toEqual({ version: "0.5.4", reshaped: false });
  });

  it("reshapes a 0.7.0 standard WaveNet into the 0.5.x layout with weights verbatim", () => {
    const out = prepareNam(JSON.stringify(v07));
    expect(out.check).toEqual({ version: "0.7.0", reshaped: true });
    const m = JSON.parse(out.json);
    expect(m.version).toBe("0.5.4");
    expect(m.config).toEqual(v05.config);
    expect(m.weights).toEqual(weights);
    expect(m.metadata).toEqual(v07.metadata);
    expect(m.sample_rate).toBe(48000);
  });

  it("refuses A2 (SlimmableContainer), lite models, active features and other sample rates", () => {
    expect(() => prepareNam(JSON.stringify({ ...v07, architecture: "SlimmableContainer" }))).toThrow(NamCheckError);
    const lite = structuredClone(v05);
    lite.config.layers[0].channels = 12;
    expect(() => prepareNam(JSON.stringify(lite))).toThrow(/not A1 standard/);
    const film = structuredClone(v07);
    film.config.layers[0].conv_pre_film = { active: true };
    expect(() => prepareNam(JSON.stringify(film))).toThrow(/FiLM/);
    const gated = structuredClone(v07);
    gated.config.layers[1].gating_mode[0] = "gated";
    expect(() => prepareNam(JSON.stringify(gated))).toThrow(/gated/);
    expect(() => prepareNam(JSON.stringify({ ...v05, sample_rate: 44100 }))).toThrow(/48 kHz/);
    expect(() => prepareNam("not json")).toThrow(/isn't a NAM A1 standard model/);
  });
});

describe("assertWav", () => {
  it("accepts RIFF/WAVE and rejects anything else", () => {
    const wav = new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ");
    expect(() => assertWav(wav)).not.toThrow();
    expect(() => assertWav(new TextEncoder().encode("ID3xxxxxxxxxxx"))).toThrow();
  });
});

describe("GP-5 verdicts", () => {
  const base = { format: "nam" as const, a1_models_count: 0, a2_models_count: 0, custom_models_count: 0, sizes: [] as ("standard" | "lite")[] };
  it("classifies list tones from counts and sizes", () => {
    expect(toneVerdict({ ...base, format: "ir" }).kind).toBe("ir");
    expect(toneVerdict({ ...base, a1_models_count: 2, sizes: ["standard"] }).kind).toBe("ready");
    expect(toneVerdict({ ...base, a1_models_count: 1, sizes: ["lite"] })).toEqual({ kind: "not-loadable", reason: "small" });
    expect(toneVerdict({ ...base, a2_models_count: 3, sizes: ["standard"] })).toEqual({ kind: "not-loadable", reason: "a2" });
  });
  it("uses exact models in the sheet, and the local record for the format update", () => {
    expect(modelsVerdict("nam", [{ architecture_version: "2", size: "standard" }, { architecture_version: "1", size: "lite" }]).kind).toBe("not-loadable");
    const rec = { gp5: { verdict: "reshape" } } as Parameters<typeof modelsVerdict>[2];
    expect(modelsVerdict("nam", [{ architecture_version: "1", size: "standard" }], rec).kind).toBe("reshape");
  });
});

describe("slot helpers", () => {
  it("proposes and sanitizes 10-character pedal names", () => {
    expect(sanitizeSlotName("Plexi 1968 Lead!!")).toBe("Plexi 1968");
    const name = proposeSlotName("EVH 5150III 50W, red channel", "Gain 4");
    expect(name.length).toBeLessThanOrEqual(10);
    expect(name).toMatch(/^5150III/);
    expect(name.endsWith("4")).toBe(true);
  });
  it("finds the first empty user slot and the slots Suite changed", () => {
    const slots = Array.from({ length: 80 }, (_, i) => ({ slot: i, name: i < 50 ? `Factory ${i}` : i < 58 ? `S${i}` : "Empty" }));
    expect(firstEmptySlot("snaptone", slots)).toBe(58);
    const before = slots.map((s) => s.name);
    const after = slots.map((s) => (s.slot === 58 ? { ...s, name: "5150-RED4" } : s));
    expect(changedSlots(before, after, [50, 79])).toEqual([58]);
    expect(firstEmptySlot("ir", [{ slot: 0, name: "A7X" }, { slot: 1, name: "User IR 2" }])).toBe(1);
  });
});
