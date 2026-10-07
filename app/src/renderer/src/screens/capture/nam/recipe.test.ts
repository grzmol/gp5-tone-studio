import { describe, expect, it } from "vitest";
import tinyA2 from "./fixtures/tiny-a2.nam?raw";
import { inspectNam, parseNam } from "./model";
import { applyRecipe, levelGainDb, originalRecipe, summarize } from "./recipe";
import { chainResponseDb, FLAT_SHAPING, isFlat, postFilters, preFilters } from "./shaping";

const file = parseNam(tinyA2);

describe("recipes", () => {
  it("the original recipe reproduces the original file", () => {
    expect(applyRecipe(file, originalRecipe(file))).toEqual(file);
  });

  it("level = loudness match + trim", () => {
    expect(levelGainDb({ trimDb: 0, loudnessTarget: null }, -26.5)).toBe(0);
    expect(levelGainDb({ trimDb: 0, loudnessTarget: -18 }, -26.5)).toBe(8.5);
    expect(levelGainDb({ trimDb: -2, loudnessTarget: -18 }, -26.5)).toBe(6.5);
    expect(levelGainDb({ trimDb: 1.5, loudnessTarget: -18 }, null)).toBe(1.5); // no loudness in the file: match can't apply
  });

  it("applies metadata, level and size; shaping never touches the file", () => {
    const recipe = { ...originalRecipe(file), loudnessTarget: -18, size: "full" as const, shaping: { ...FLAT_SHAPING, bassDb: 6 } };
    recipe.metadata = { ...recipe.metadata, name: "Edited" };
    const out = applyRecipe(file, recipe);
    expect(out.metadata).toMatchObject({ name: "Edited", loudness: -18 });
    const info = inspectNam(out);
    expect(info.arch).toMatchObject({ kind: "A2", submodels: [{ size: "full", loudness: -18 }] });
    expect(applyRecipe(file, { ...originalRecipe(file), shaping: { ...FLAT_SHAPING, bassDb: 6 } })).toEqual(file);
  });

  it("summarizes what changed", () => {
    const base = originalRecipe(file);
    expect(summarize(base, base)).toBe("No changes");
    expect(summarize(base, { ...base, metadata: { ...base.metadata, name: "Plexi", gear_make: "Marshall", gear_model: "1959" } })).toBe(
      "Renamed to “Plexi”; set gear make and gear model",
    );
    expect(summarize(base, { ...base, loudnessTarget: -18, trimDb: -1.5 })).toBe("Matched loudness to −18 dB; output trim −1.5 dB");
    expect(summarize(base, { ...base, size: "lite" })).toBe("Lite only");
    expect(summarize(base, { ...base, shaping: { ...base.shaping, midDb: -2, highCutHz: 9500 } })).toBe("Mid −2 dB, high cut 9.5 kHz");
  });
});

describe("shaping response", () => {
  const at = (s: typeof FLAT_SHAPING, f: number) => chainResponseDb([...preFilters(s), ...postFilters(s)], f);

  it("is flat at the neutral settings", () => {
    expect(isFlat(FLAT_SHAPING)).toBe(true);
    for (const f of [20, 100, 1000, 10000, 20000]) expect(at(FLAT_SHAPING, f)).toBeCloseTo(0, 9);
  });

  it("low and high cut are Butterworth (−3 dB at the corner)", () => {
    expect(at({ ...FLAT_SHAPING, lowCutHz: 100 }, 100)).toBeCloseTo(-3.01, 1);
    expect(at({ ...FLAT_SHAPING, lowCutHz: 100 }, 1000)).toBeCloseTo(0, 1);
    expect(at({ ...FLAT_SHAPING, highCutHz: 5000 }, 5000)).toBeCloseTo(-3.01, 1);
    expect(at({ ...FLAT_SHAPING, highCutHz: 5000 }, 200)).toBeCloseTo(0, 2);
  });

  it("bass, mid, treble and tight reach their gain where they act", () => {
    expect(at({ ...FLAT_SHAPING, midDb: 6 }, 700)).toBeCloseTo(6, 6);
    expect(at({ ...FLAT_SHAPING, bassDb: -9 }, 20)).toBeCloseTo(-9, 0);
    expect(at({ ...FLAT_SHAPING, trebleDb: 4 }, 20000)).toBeCloseTo(4, 0);
    expect(at({ ...FLAT_SHAPING, tightPct: 100 }, 150)).toBeCloseTo(-6, 6);
    expect(at({ ...FLAT_SHAPING, tightPct: 50 }, 150)).toBeCloseTo(-3, 6);
  });
});
