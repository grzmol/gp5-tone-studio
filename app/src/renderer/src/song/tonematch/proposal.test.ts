import { describe, expect, it } from "vitest";
import { findModel } from "@/gp5/lib/catalog.mjs";
import { ampGain, chooseAmp, proposePreset } from "./proposal";
import { analysisFixture } from "./test-signals";

const fxid = (name: string, block: string) => findModel(name, block)?.fxid;
const neutral = { bassDb: 0, lowMidDb: 0, midDb: 0, trebleDb: 0, presenceDb: 0, confidence: 0.6 };

describe("proposePreset", () => {
  it("builds a scooped high-gain preset with the measured delay and reverb", () => {
    const p = proposePreset(analysisFixture());
    const by = Object.fromEntries(p.blocks.map((b) => [b.code, b]));
    expect(p.blocks.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(by.AMP.fxid).toBe(fxid("Mess DualM", "AMP"));
    expect(by.CAB.fxid).toBe(fxid("Mess 4x12", "CAB"));
    expect(by.AMP.settings.find((s) => s.name === "Gain")?.value).toBe(ampGain("high", 0.75));
    expect(by.AMP.settings.find((s) => s.name === "Middle")?.value).toBe(44); // 50 + (−3 / 2)·4
    expect(by.DLY).toMatchObject({ enabled: true, fxid: fxid("Pure", "DLY") });
    expect(by.DLY.settings).toEqual(expect.arrayContaining([{ name: "Time", value: 375, unit: "ms" }, { name: "F.Back", value: 40 }, { name: "Mix", value: 33 }]));
    expect(by.RVB).toMatchObject({ enabled: true, fxid: fxid("Plate", "RVB") });
    expect(by.NR).toMatchObject({ enabled: true, fxid: null });
    for (const code of ["PRE", "MOD", "NS", "DST"]) expect(by[code]).toMatchObject({ enabled: false, fxid: null });
    expect(p.summary).toContain("High gain");
    expect(p.confidence).toBeGreaterThan(0.5);
  });

  it("leaves uncertain or missing time effects off", () => {
    const p = proposePreset(
      analysisFixture({
        delay: { detected: true, timeMs: 250, feedback: 0.9, level: 0.9, dark: false, confidence: 0.2 },
        reverb: { detected: false, rt60: 0, levelDb: -60, tails: 0, dryOffsets: 12, confidence: 0.8 },
      }),
    );
    expect(p.blocks[7]).toMatchObject({ code: "DLY", enabled: false, fxid: null });
    expect(p.blocks[8]).toMatchObject({ code: "RVB", enabled: false, fxid: null });
    expect(p.summary).toContain("no time effects");
  });

  it("uses a slapback for a short single repeat and a boost for extreme gain", () => {
    const p = proposePreset(
      analysisFixture({
        gain: { gainClass: "high", score: 0.9, confidence: 0.8, flatness: 0.05, hfRatioDb: -16, crestDb: 0.8 },
        delay: { detected: true, timeMs: 110, feedback: 0.05, level: 0.6, dark: false, confidence: 0.8 },
      }),
    );
    expect(p.blocks[7].fxid).toBe(fxid("Slapback", "DLY"));
    expect(p.blocks[2]).toMatchObject({ code: "DST", enabled: true, fxid: fxid("Green OD", "DST") });
  });

  it("keeps every param inside the catalog's range", () => {
    const p = proposePreset(analysisFixture({ tone: { bassDb: 30, lowMidDb: -30, midDb: 30, trebleDb: -30, presenceDb: 30, confidence: 0.6 } }));
    for (const b of p.blocks.filter((x) => x.fxid !== null)) {
      for (const param of findModel(b.title!, b.code)?.params ?? []) {
        expect(b.params![param.index]).toBeGreaterThanOrEqual(param.min);
        expect(b.params![param.index]).toBeLessThanOrEqual(param.max);
      }
    }
  });
});

describe("chooseAmp", () => {
  it("picks by gain class and tone character", () => {
    expect(chooseAmp("clean", 0.1, { ...neutral, trebleDb: 3, presenceDb: 2 }).amp).toBe("Dark Twin");
    expect(chooseAmp("clean", 0.1, neutral).amp).toBe("J-120 CL");
    expect(chooseAmp("crunch", 0.55, neutral).amp).toBe("UK 800");
    expect(chooseAmp("crunch", 0.42, neutral).amp).toBe("UK 45");
    expect(chooseAmp("high", 0.7, { ...neutral, midDb: 2 }).amp).toBe("EV 51");
    expect(chooseAmp("high", 0.7, neutral).amp).toBe("Solo100 LD");
  });

  it("maps the score into each class's gain range", () => {
    expect(ampGain("clean", 0)).toBe(15);
    expect(ampGain("crunch", 0.65)).toBe(65);
    expect(ampGain("high", 1)).toBe(85);
  });
});
