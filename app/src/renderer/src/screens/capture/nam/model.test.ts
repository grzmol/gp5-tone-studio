import { describe, expect, it } from "vitest";
import tinyA2 from "./fixtures/tiny-a2.nam?raw";
import { inspectNam, NamParseError, NamTransformError, parseNam, serializeNam, withMetadata, withOutputGain, withSize, editableMetadata, type NamFile } from "./model";

type Sub = { max_value: number; model: { config: { head_scale: number; layers: Record<string, unknown>[] }; weights: number[]; metadata: { loudness: number } } };
const subs = (f: NamFile) => f.config.submodels as Sub[];

/** A minimal A1 standard WaveNet in the 0.5.x layout (weights shortened; inspect doesn't count them). */
function a1(): NamFile {
  const layer = (channels: number, headSize: number) => ({
    input_size: 1,
    condition_size: 1,
    head_size: headSize,
    channels,
    kernel_size: 3,
    dilations: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
    activation: "Tanh",
    gated: false,
    head_bias: false,
  });
  return {
    version: "0.5.4",
    architecture: "WaveNet",
    config: { layers: [layer(16, 8), layer(8, 1)], head: null, head_scale: 0.02 },
    weights: [0.1, -0.2, 0.3, 0.02],
    sample_rate: 48000,
    metadata: { loudness: -20, name: "A1 test" },
  };
}

describe("parseNam / serializeNam", () => {
  it("round-trips the A2 fixture without changing a value", () => {
    const parsed = parseNam(tinyA2);
    expect(serializeNam(parsed)).toBe(tinyA2);
    expect(parseNam(serializeNam(parsed))).toEqual(parsed);
  });

  it("keeps unknown fields and full float precision", () => {
    const text = JSON.stringify({ ...a1(), weights: [0.013947331346571445, 1e-30], extra: { kept: [1, 2] } });
    expect(serializeNam(parseNam(text))).toBe(text);
  });

  it("rejects files that aren't NAM captures", () => {
    expect(() => parseNam("not json")).toThrow(NamParseError);
    expect(() => parseNam(JSON.stringify({ version: "0.5.4", architecture: "WaveNet", config: {} }))).toThrow(/no architecture, config or weights/);
    expect(() => parseNam(JSON.stringify({ version: "0.7.0", architecture: "SlimmableContainer", config: { submodels: [] }, weights: [] }))).toThrow(/no submodels/);
    expect(() => parseNam(JSON.stringify({ version: "0.7.0", architecture: "SlimmableContainer", config: { submodels: [{ max_value: 1 }] }, weights: [] }))).toThrow(
      /submodel/,
    );
  });
});

describe("inspectNam", () => {
  it("reads sizes, params, receptive field and calibration of an A2 file", () => {
    const info = inspectNam(parseNam(tinyA2));
    expect(info.arch.kind).toBe("A2");
    if (info.arch.kind !== "A2") return;
    expect(info.arch.submodels.map((s) => [s.size, s.maxValue, s.params, s.channels, s.loudness])).toEqual([
      ["lite", 0.5, 1871, 3, -27.25],
      ["full", 1, 1871, 3, -26.5],
    ]);
    expect(info.params).toBe(3742);
    // kernels 6 (dilations 1…239 three times) and 15 (dilations 1, 13), plus the 16-tap head
    const cycle = 1 + 3 + 7 + 17 + 41 + 101 + 239;
    expect(info.receptiveField).toBe(1 + 5 * cycle * 3 + 14 * (1 + 13) + 15);
    expect(info).toMatchObject({ sampleRate: 48000, loudness: -26.5, inputLevelDbu: 12.2, outputLevelDbu: null, levelEditable: true, unsupported: null, features: [] });
  });

  it("recognises A1 standard in the 0.5.x layout", () => {
    const info = inspectNam(a1());
    expect(info.arch).toEqual({ kind: "A1", size: "standard", params: 4, receptiveField: 1 + 2 * 2 * 1023, layout: "0.5" });
    expect(info.levelEditable).toBe(true);
  });

  it("explains why a capture can't be converted", () => {
    expect(inspectNam({ ...a1(), sample_rate: 44100 }).unsupported).toBe("This capture is 44.1 kHz. The GP-5 needs 48 kHz captures.");
    expect(inspectNam({ ...a1(), architecture: "LSTM" }).unsupported).toBe("This file uses a custom NAM layout we can't read.");
    const film = parseNam(tinyA2);
    subs(film)[1].model.config.layers[0].conv_pre_film = { active: true, shift: true, groups: 1 };
    const info = inspectNam(film);
    expect(info.features).toEqual(["FiLM conditioning"]);
    expect(info.unsupported).toMatch(/FiLM conditioning/);
  });

  it("marks the level as not editable when head_scale isn't the last weight", () => {
    const f = a1();
    f.weights[f.weights.length - 1] = 0.5;
    expect(inspectNam(f).levelEditable).toBe(false);
    expect(() => withOutputGain(f, 3)).toThrow(NamTransformError);
  });
});

describe("withOutputGain", () => {
  it("scales head_scale and the last weight of every submodel, and moves loudness", () => {
    const original = parseNam(tinyA2);
    const out = withOutputGain(original, -6);
    const g = 10 ** (-6 / 20);
    subs(out).forEach((s, i) => {
      const o = subs(original)[i];
      expect(s.model.config.head_scale).toBeCloseTo(o.model.config.head_scale * g, 15);
      expect(s.model.weights.at(-1)).toBeCloseTo(o.model.weights.at(-1)! * g, 15);
      expect(s.model.weights.slice(0, -1)).toEqual(o.model.weights.slice(0, -1));
      expect(s.model.metadata.loudness).toBeCloseTo(o.model.metadata.loudness - 6, 12);
    });
    expect(out.metadata?.loudness).toBeCloseTo(-32.5, 12);
    expect(subs(original)[0].model.config.head_scale).toBe(0.02); // input untouched
  });

  it("is reversible and a no-op at 0 dB", () => {
    const original = parseNam(tinyA2);
    expect(withOutputGain(original, 0)).toEqual(original);
    const back = withOutputGain(withOutputGain(original, 7.5), -7.5);
    expect(subs(back)[1].model.config.head_scale).toBeCloseTo(0.025, 14);
    expect(back.metadata?.loudness).toBeCloseTo(-26.5, 12);
  });

  it("works on A1 WaveNet files", () => {
    const out = withOutputGain(a1(), 20);
    expect(out.config.head_scale).toBeCloseTo(0.2, 14);
    expect(out.weights).toEqual([0.1, -0.2, 0.3, expect.closeTo(0.2, 14)]);
    expect(out.metadata?.loudness).toBe(0);
  });
});

describe("withSize", () => {
  it("keeps one submodel as a SlimmableContainer that answers every size", () => {
    const original = parseNam(tinyA2);
    for (const [size, index] of [["lite", 0], ["full", 1]] as const) {
      const out = withSize(original, size);
      expect(out.architecture).toBe("SlimmableContainer");
      expect(subs(out)).toHaveLength(1);
      expect(subs(out)[0].max_value).toBe(1);
      expect(subs(out)[0].model).toEqual(subs(original)[index].model);
      expect(inspectNam(out).arch).toMatchObject({ kind: "A2", submodels: [{ size: "full", params: 1871 }] });
    }
    expect(withSize(original, "both")).toEqual(original);
  });

  it("leaves A1 files alone", () => {
    expect(withSize(a1(), "lite")).toEqual(a1());
  });
});

describe("withMetadata", () => {
  it("sets edited fields, removes cleared ones and keeps the rest", () => {
    const original = parseNam(tinyA2);
    const edits = { ...editableMetadata(original), name: "  Plexi lead ", gear_make: "", output_level_dbu: 4.5, input_level_dbu: null };
    const out = withMetadata(original, edits);
    expect(out.metadata).toMatchObject({ name: "Plexi lead", modeled_by: "GP-5 Tone Studio tests", output_level_dbu: 4.5, loudness: -26.5, date: original.metadata?.date });
    expect(out.metadata).not.toHaveProperty("gear_make");
    expect(out.metadata).not.toHaveProperty("input_level_dbu");
    expect(editableMetadata(out)).toEqual({ ...edits, name: "Plexi lead" });
    expect(out.config).toEqual(original.config);
  });
});
