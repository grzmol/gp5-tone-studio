import { describe, expect, it } from "vitest";
import { convertPrst, readName } from "@/gp5/lib/prst.mjs";
import capture from "@/gp5/fixtures/gp50_suite_write_slot0.json";
import { checkPrst } from "./import";

// A real GP-50 file ("US Lead", reconstructed from a Valeton Suite capture) and its GP-5 conversion.
const gp50 = Uint8Array.from(atob(capture.prst_b64), (c) => c.charCodeAt(0));
const gp5 = convertPrst(gp50, "gp5", { force: true });

describe("checkPrst", () => {
  it("accepts a GP-5 preset and reads its name", () => {
    expect(checkPrst(gp5)).toEqual({ ok: true, name: readName(gp5), device: "gp5" });
  });

  it("accepts a GP-50 preset (converted when it is written)", () => {
    expect(checkPrst(gp50)).toMatchObject({ ok: true, device: "gp50" });
  });

  it("rejects files of unknown length and damaged presets with a reason", () => {
    expect(checkPrst(new Uint8Array(100))).toEqual({ ok: false, reason: "Not a GP-5 or GP-50 preset." });
    const damaged = gp5.slice();
    damaged[0x14] ^= 0xff;
    expect(checkPrst(damaged)).toEqual({ ok: false, reason: "The file is damaged (its checksum doesn't match)." });
  });
});
