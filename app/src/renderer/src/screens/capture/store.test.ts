import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDraft, CaptureKey, CaptureVersion } from "@shared/host/capture";
import tinyA2 from "./nam/fixtures/tiny-a2.nam?raw";
// vi.mock below is hoisted above these imports, so the store sees the in-memory host.
import { isDirty, useCapture } from "./store";
import { parseNam } from "./nam/model";

// In-memory capture host: one file capture, versions and draft kept like the desktop store does.
const db = vi.hoisted(() => ({ versions: [] as CaptureVersion[], draft: null as CaptureDraft | null, files: new Map<number, string>(), text: "" }));
vi.mock("@/host", () => ({
  host: {
    capture: {
      open: async (ref: string) => ({
        source: { ref, kind: "file", modelId: null, fileName: "tiny-a2.nam", sha256: "sha", text: db.text },
        versions: [...db.versions],
        draft: db.draft,
      }),
      saveVersion: async (_key: CaptureKey, input: { recipe: CaptureVersion["recipe"]; summary: string; restoredFrom?: number; file: string }) => {
        const v: CaptureVersion = {
          n: db.versions.length + 1,
          createdAt: new Date().toISOString(),
          base: "sha",
          recipe: input.recipe,
          summary: input.summary,
          restoredFrom: input.restoredFrom,
        };
        db.versions.push(v);
        db.files.set(v.n, input.file);
        db.draft = null;
        return v;
      },
      deleteVersion: async (_key: CaptureKey, n: number) => {
        db.versions = db.versions.filter((v) => v.n !== n);
      },
      saveDraft: async (_key: CaptureKey, draft: CaptureDraft | null) => {
        db.draft = draft;
      },
    },
  },
}));

const s = () => useCapture.getState();
const setName = (name: string, group?: string) => s().edit((r) => ({ ...r, metadata: { ...r.metadata, name } }), group);
const REF = "file-0123456789abcdef";

beforeEach(async () => {
  db.text = tinyA2;
  db.versions = [];
  db.draft = null;
  db.files.clear();
  s().reset();
  await s().open(REF);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("capture editor store", () => {
  it("opens the original as version 0 with no changes", () => {
    expect(s().status).toBe("ready");
    expect(s().base).toBe(0);
    expect(isDirty(s())).toBe(false);
    expect(s().recipe?.metadata.name).toBe("Tiny test A2");
  });

  it("undo and redo walk the draft; a continuous gesture is one step", () => {
    setName("A", "meta:name");
    setName("AB", "meta:name");
    s().edit((r) => ({ ...r, trimDb: 3 }));
    expect(s().past).toHaveLength(2);
    s().undo();
    expect(s().recipe?.trimDb).toBe(0);
    expect(s().recipe?.metadata.name).toBe("AB");
    s().undo();
    expect(s().recipe?.metadata.name).toBe("Tiny test A2");
    expect(isDirty(s())).toBe(false);
    s().redo();
    s().redo();
    expect(s().recipe?.trimDb).toBe(3);
  });

  it("saving closes the draft as the next version with its lossless file", async () => {
    s().edit((r) => ({ ...r, loudnessTarget: -18 }));
    const v = await s().saveVersion();
    expect(v?.n).toBe(1);
    expect(v?.summary).toBe("Matched loudness to −18 dB");
    expect(s().base).toBe(1);
    expect(isDirty(s())).toBe(false);
    expect(s().past).toEqual([]);
    expect(parseNam(db.files.get(1)!).metadata?.loudness).toBeCloseTo(-18, 9);
    expect(await s().saveVersion()).toBeNull(); // nothing changed
  });

  it("reopening restores the autosaved draft on top of its version", async () => {
    vi.useFakeTimers();
    s().edit((r) => ({ ...r, size: "lite" }));
    await vi.advanceTimersByTimeAsync(1000); // past the draft autosave delay
    expect(db.draft?.recipe.size).toBe("lite");
    vi.useRealTimers();
    await s().open(REF);
    expect(s().recipe?.size).toBe("lite");
    expect(s().base).toBe(0);
    expect(isDirty(s())).toBe(true);
  });

  it("restoring an older version adds a new one and never deletes later versions", async () => {
    setName("First");
    await s().saveVersion();
    setName("Second");
    await s().saveVersion();
    setName("Unsaved");
    await s().restore(1);
    expect(db.versions.map((v) => [v.n, v.recipe.metadata.name, v.restoredFrom])).toEqual([
      [1, "First", undefined],
      [2, "Second", undefined],
      [3, "Unsaved", undefined],
      [4, "First", 1],
    ]);
    expect(s().base).toBe(4);
    expect(s().recipe?.metadata.name).toBe("First");
  });

  it("viewing a version is read-only", () => {
    s().view(0);
    setName("ignored");
    expect(s().recipe?.metadata.name).toBe("Tiny test A2");
    expect(s().past).toEqual([]);
  });

  it("an unreadable file is an error state with the reason", async () => {
    db.text = "{ not json";
    await s().open(REF);
    expect(s().status).toBe("error");
    expect(s().error).toMatch(/isn't valid JSON/);
  });
});
