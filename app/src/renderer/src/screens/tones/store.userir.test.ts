import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToneRecord } from "@shared/host/tones";
// vi.mock below is hoisted above these imports, so the store sees the fake host and device.
import { irSlotLabel, runSend, startSendDraft, updateDraft, useTones, writeUserIr } from "./store";
import { irOccupant, irSummary } from "./UserIrParts";

/** 24-bit / 44.1 kHz mono WAV: the converter's direct path, so the data block is exact. */
function wav24(samples: number[], rate = 44100): Uint8Array {
  const data = samples.length * 3;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 3, true);
  v.setUint16(32, 3, true);
  v.setUint16(34, 24, true);
  put(36, "data");
  v.setUint32(40, data, true);
  samples.forEach((s, i) => {
    const x = s & 0xffffff;
    b[44 + i * 3] = x & 0xff;
    b[45 + i * 3] = (x >> 8) & 0xff;
    b[46 + i * 3] = (x >> 16) & 0xff;
  });
  return b;
}

const fake = vi.hoisted(() => ({
  wav: new Uint8Array(0) as Uint8Array,
  links: [] as { toneId: number; link: unknown }[],
  uploads: [] as { slot: number; name: string; data: Uint8Array }[],
  uploadError: null as Error | null,
}));

const record = (toneId: number): ToneRecord => ({
  tone_id: toneId,
  title: "Mesa 4x12",
  gear: "cab",
  format: "ir",
  creator: { username: "someone", avatar_url: null },
  image_url: null,
  license: "t3k",
  url: "https://www.tone3000.com/tones/1",
  models: [],
  gp5: { verdict: "ir" },
  savedAt: "2026-10-10T00:00:00.000Z",
});

vi.mock("@/host", () => ({
  host: {
    tones: {
      prepareIr: async (req: { toneId: number }) => ({ wav: fake.wav, record: record(req.toneId) }),
      link: async (toneId: number, link: { slot: number; slotName: string }) => {
        fake.links.push({ toneId, link });
        return { ...record(toneId), gp5: { verdict: "ir", irSlot: link.slot, slotName: link.slotName } };
      },
      local: async () => [],
    },
  },
}));

vi.mock("@/state/device", () => {
  const state = {
    status: "connected",
    snapTones: null,
    userIRs: Array.from({ length: 20 }, (_, i) => ({ slot: i, name: i < 3 ? `CAB ${i}` : `User IR ${i + 1}`, kind: i < 3 ? "user" : "empty" })),
    async uploadUserIr(slot: number, name: string, data: Uint8Array, opts?: { onProgress?: (f: number) => void }) {
      if (fake.uploadError) throw fake.uploadError;
      opts?.onProgress?.(1);
      fake.uploads.push({ slot, name, data });
      return name;
    },
  };
  return { useDevice: { getState: () => state } };
});

vi.mock("@/app/notify", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/snaptone/convert", () => ({ convertToSnapTone: vi.fn() }));

const TONE = 42;

beforeEach(() => {
  fake.wav = wav24([0x7fffff]);
  fake.links = [];
  fake.uploads = [];
  fake.uploadError = null;
  useTones.setState({ send: {}, records: {} });
  startSendDraft(TONE, 7, "MESA", "ir");
});

describe("IR send to a User IR slot", () => {
  it("proposes the first empty slot and labels slots 1-based", () => {
    expect(useTones.getState().send[TONE].proposedSlot).toBe(3);
    expect(irSlotLabel(3)).toBe("User IR 4");
  });

  it("downloads and converts, then waits for the user to write", async () => {
    await runSend(TONE);
    const s = useTones.getState().send[TONE];
    expect(s).toMatchObject({ phase: "ready", step: 3 });
    expect(s.ir?.data.length).toBe(2048);
    expect(Array.from(s.ir!.data.slice(0, 4))).toEqual([0xff, 0xff, 0x7f, 0x00]);
    expect(fake.uploads).toEqual([]);
  });

  it("writes the chosen slot over USB and links it to the tone", async () => {
    await runSend(TONE);
    updateDraft(TONE, { proposedSlot: 5 });
    await writeUserIr(TONE);
    expect(fake.uploads.map((u) => [u.slot, u.name, u.data.length])).toEqual([[5, "MESA", 2048]]);
    expect(fake.links).toEqual([{ toneId: TONE, link: { kind: "ir", slot: 5, slotName: "MESA" } }]);
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "linked", step: 5, linkedSlot: 5 });
    expect(useTones.getState().records[TONE].gp5.irSlot).toBe(5);
  });

  it("reports a file that isn't a WAV at the check step", async () => {
    fake.wav = new TextEncoder().encode("ID3 not a wav file at all");
    await runSend(TONE);
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "error", step: 2 });
  });

  it("keeps the converted IR for a retry when the write fails", async () => {
    await runSend(TONE);
    fake.uploadError = new Error("The GP-5 stopped acknowledging");
    await writeUserIr(TONE);
    expect(useTones.getState().send[TONE]).toMatchObject({ phase: "error", step: 4, error: "The GP-5 stopped acknowledging" });
    expect(useTones.getState().send[TONE].ir).not.toBeNull();
    expect(fake.links).toEqual([]);
  });
});

describe("User IR UI helpers", () => {
  it("names the occupant of a filled slot only", () => {
    const table = [
      { slot: 0, name: "CAB 0", kind: "user" as const },
      { slot: 1, name: "User IR 2", kind: "empty" as const },
    ];
    expect(irOccupant(table, 0)).toBe("CAB 0");
    expect(irOccupant(table, 1)).toBeNull();
    expect(irOccupant(null, 0)).toBeNull();
  });

  it("says what part of the IR the pedal keeps", () => {
    expect(irSummary({ data: new Uint8Array(2048), sourceRate: 44100, sourceFrames: 2048, truncated: true })).toBe(
      "Uses the first 11.6 ms (512 samples at 44.1 kHz) of this 46.4 ms IR; the GP-5 keeps no more.",
    );
    expect(irSummary({ data: new Uint8Array(2048), sourceRate: 48000, sourceFrames: 480, truncated: false })).toBe(
      "Uses all 10.0 ms of it; the GP-5 keeps up to 11.6 ms (512 samples at 44.1 kHz). Resampled from 48 kHz.",
    );
  });
});
