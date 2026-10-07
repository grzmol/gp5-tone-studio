import { describe, expect, it } from "vitest";
import { rebuildPrst } from "@/gp5/lib/prst.mjs";
import { describeSlots, restoreEntries } from "./restore";

const fixture = (name: string): Uint8Array => rebuildPrst(name.replace(/^\d+-|\.prst$/g, ""), new Uint8Array(466), "gp5");

describe("restoreEntries", () => {
  it("keeps GP-5 presets by slot (from the record or the NN- prefix), sorted", () => {
    const puppy = fixture("65-Puppy.prst");
    const { entries, skipped } = restoreEntries([
      { fileName: "65-Puppy.prst", bytes: puppy },
      { fileName: "whatever.prst", slot: 3, bytes: puppy },
    ]);
    expect(entries.map((e) => e.slot)).toEqual([3, 65]);
    expect(entries[1].name).toBe("Puppy");
    expect(skipped).toEqual([]);
  });

  it("explains what it skips", () => {
    const puppy = fixture("65-Puppy.prst");
    const { entries, skipped } = restoreEntries([
      { fileName: "Puppy.prst", bytes: puppy },
      { fileName: "07-Broken.prst", bytes: new Uint8Array(12) },
      { fileName: "08-Gone.prst", bytes: null, error: "too big" },
      { fileName: "65-Puppy.prst", bytes: puppy },
      { fileName: "65-Again.prst", bytes: puppy },
    ]);
    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([
      "Puppy.prst: no slot number in the file name",
      "07-Broken.prst: not a GP-5 preset",
      "08-Gone.prst: too big",
      "65-Again.prst: slot 65 appears twice",
    ]);
  });
});

describe("describeSlots", () => {
  it("collapses runs", () => {
    expect(describeSlots(Array.from({ length: 100 }, (_, i) => i))).toBe("Slots 00–99");
    expect(describeSlots([7, 0, 1, 2, 3, 4])).toBe("Slots 00–04 and 07");
    expect(describeSlots([12])).toBe("Slot 12");
  });
});
