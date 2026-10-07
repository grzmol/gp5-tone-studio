// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  backupDirName,
  collectionDirName,
  isSafePresetFileName,
  parseBackupDirName,
  parseCollectionId,
  parseSlotFileName,
  presetFileName,
  sanitizeFileName,
  slotFileName,
  uniqueFileName,
} from "./files-naming";

describe("sanitizeFileName", () => {
  it("keeps spaces, dashes and case like the pedal's own backups", () => {
    expect(sanitizeFileName("Neo Soul")).toBe("Neo Soul");
    expect(sanitizeFileName("Shatte-GT1")).toBe("Shatte-GT1");
  });
  it("replaces characters Windows forbids and trims trailing dots and spaces", () => {
    expect(sanitizeFileName('A/B\\C:D*E?F"G<H>I|J')).toBe("A_B_C_D_E_F_G_H_I_J");
    expect(sanitizeFileName("Lead...  ")).toBe("Lead");
    expect(sanitizeFileName("..hidden")).toBe("hidden");
  });
  it("prefixes reserved device names and falls back when nothing is left", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("lpt1.prst")).toBe("_lpt1.prst");
    expect(sanitizeFileName("   ")).toBe("Preset");
    expect(sanitizeFileName("...", "GP-5")).toBe("GP-5");
  });
});

describe("slot files", () => {
  it("names backup files NN-Name.prst", () => {
    expect(slotFileName(0, "GreatPedal")).toBe("00-GreatPedal.prst");
    expect(slotFileName(97, "FF/CC")).toBe("97-FF_CC.prst");
    expect(slotFileName(64, "")).toBe("64-GP-5.prst");
  });
  it("parses them back", () => {
    expect(parseSlotFileName("07-Blues Man.prst")).toEqual({ slot: 7, name: "Blues Man" });
    expect(parseSlotFileName("Puppy.prst")).toBeNull();
    expect(parseSlotFileName("7-Blues.prst")).toBeNull();
  });
  it("uses the slot prefix only when the preset came from a slot", () => {
    expect(presetFileName("Puppy", 65)).toBe("65-Puppy.prst");
    expect(presetFileName("US Lead", null)).toBe("US Lead.prst");
  });
});

describe("backup folders", () => {
  const day = new Date(2026, 9, 7, 14, 32);
  it("uses the local date and numbers repeats of the same day", () => {
    expect(backupDirName(day, [])).toBe("gp5-2026-10-07");
    expect(backupDirName(day, ["gp5-2026-10-07"])).toBe("gp5-2026-10-07-2");
    expect(backupDirName(day, ["gp5-2026-10-07", "GP5-2026-10-07-2"])).toBe("gp5-2026-10-07-3");
    expect(backupDirName(day, ["gp5-2026-10-06"])).toBe("gp5-2026-10-07");
  });
  it("reads the date back and ignores foreign folders", () => {
    expect(parseBackupDirName("gp5-2026-10-07-2")?.getDate()).toBe(7);
    expect(parseBackupDirName("gp5-2026-02-31")).toBeNull();
    expect(parseBackupDirName("photos")).toBeNull();
  });
});

describe("unique names", () => {
  it("adds (n) before the extension, case-insensitively", () => {
    expect(uniqueFileName("Puppy.prst", [])).toBe("Puppy.prst");
    expect(uniqueFileName("Puppy.prst", ["puppy.prst"])).toBe("Puppy (2).prst");
    expect(uniqueFileName("Puppy.prst", ["Puppy.prst", "Puppy (2).prst"])).toBe("Puppy (3).prst");
  });
  it("never gives a user collection a reserved folder", () => {
    expect(collectionDirName("Imported", [])).toBe("Imported (2)");
    expect(collectionDirName("Rehearsal set", ["Rehearsal set"])).toBe("Rehearsal set (2)");
    expect(collectionDirName("a/b", [])).toBe("a_b");
  });
});

describe("collection ids", () => {
  it("accepts one folder under backups or library", () => {
    expect(parseCollectionId("backups/gp5-2026-10-07")).toEqual({ root: "backups", dir: "gp5-2026-10-07" });
    expect(parseCollectionId("library/Rehearsal set")).toEqual({ root: "library", dir: "Rehearsal set" });
  });
  it("rejects traversal and other roots", () => {
    expect(parseCollectionId("backups/..")).toBeNull();
    expect(parseCollectionId("library/a/b")).toBeNull();
    expect(parseCollectionId("library/..\\x")).toBeNull();
    expect(parseCollectionId("/etc")).toBeNull();
    expect(parseCollectionId("settings/x")).toBeNull();
  });
  it("accepts only plain .prst file names inside a collection", () => {
    expect(isSafePresetFileName("65-Puppy.prst")).toBe(true);
    expect(isSafePresetFileName("../x.prst")).toBe(false);
    expect(isSafePresetFileName("a.txt")).toBe(false);
  });
});
