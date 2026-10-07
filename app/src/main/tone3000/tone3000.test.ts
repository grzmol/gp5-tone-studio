// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@shared/ipc";
import type { T3kModel, T3kTone } from "@shared/host/tones";
import { base64url, codeChallenge, createPkce } from "./pkce";
import { InvalidGrantError, TokenManager, type TokenSet, type TokenStore } from "./tokens";
import { buildRecord, listRecords, readRecord, writeRecord } from "./records";

describe("PKCE", () => {
  it("derives the S256 challenge of the RFC 7636 Appendix B test vector", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("encodes the RFC 7636 Appendix B verifier octets as base64url without padding", () => {
    const octets = Buffer.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
    expect(base64url(octets)).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  });

  it("creates a 43-char unreserved verifier, its challenge and a distinct state each time", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(codeChallenge(a.verifier));
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });
});

function memoryStore(initial: TokenSet | null): TokenStore & { value: TokenSet | null } {
  return {
    value: initial,
    async load() {
      return this.value;
    },
    async save(t) {
      this.value = t;
    },
    async clear() {
      this.value = null;
    },
  };
}

describe("TokenManager", () => {
  const T0 = 1_000_000;

  it("returns the stored token while it is valid beyond the skew window", async () => {
    const store = memoryStore({ access_token: "a1", refresh_token: "r1", expires_at: T0 + 120_000 });
    const refresh = vi.fn();
    const tm = new TokenManager(store, refresh, () => T0);
    expect(await tm.accessToken()).toBe("a1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes proactively inside the skew window and persists the new set", async () => {
    const store = memoryStore({ access_token: "a1", refresh_token: "r1", expires_at: T0 + 30_000 });
    const refresh = vi.fn(async () => ({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }));
    const tm = new TokenManager(store, refresh, () => T0);
    expect(await tm.accessToken()).toBe("a2");
    expect(refresh).toHaveBeenCalledWith("r1");
    expect(store.value).toEqual({ access_token: "a2", refresh_token: "r2", expires_at: T0 + 3_600_000 });
  });

  it("keeps the old refresh token when the response omits one", async () => {
    const store = memoryStore({ access_token: "a1", refresh_token: "r1", expires_at: T0 - 1 });
    const tm = new TokenManager(store, async () => ({ access_token: "a2", expires_in: 60 }), () => T0);
    await tm.accessToken();
    expect(store.value?.refresh_token).toBe("r1");
  });

  it("shares one refresh between concurrent callers", async () => {
    const store = memoryStore({ access_token: "a1", refresh_token: "r1", expires_at: T0 - 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = vi.fn(async () => {
      await gate;
      return { access_token: "a2", refresh_token: "r2", expires_in: 3600 };
    });
    const tm = new TokenManager(store, refresh, () => T0);
    const both = Promise.all([tm.accessToken(), tm.accessToken(), tm.forceRefresh()]);
    release();
    expect(await both).toEqual(["a2", "a2", "a2"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("signs out and reports unauthorized when the refresh token is rejected (invalid_grant)", async () => {
    const store = memoryStore({ access_token: "a1", refresh_token: "r1", expires_at: T0 - 1 });
    const tm = new TokenManager(store, async () => {
      throw new InvalidGrantError();
    }, () => T0);
    await expect(tm.accessToken()).rejects.toMatchObject({ code: "unauthorized" });
    expect(store.value).toBeNull();
    expect(tm.expired).toBe(true);
    expect(await tm.signedIn()).toBe(false);
  });

  it("keeps the tokens when the refresh fails for network reasons", async () => {
    const store = memoryStore({ access_token: "a1", refresh_token: "r1", expires_at: T0 - 1 });
    const tm = new TokenManager(store, async () => {
      throw new HostError("network", "offline");
    }, () => T0);
    await expect(tm.accessToken()).rejects.toMatchObject({ code: "network" });
    expect(store.value?.refresh_token).toBe("r1");
    expect(tm.expired).toBe(false);
  });

  it("requires a sign-in when there are no tokens, and a new sign-in clears the expired flag", async () => {
    const store = memoryStore(null);
    const tm = new TokenManager(store, vi.fn(), () => T0);
    await expect(tm.accessToken()).rejects.toMatchObject({ code: "unauthorized" });
    tm.expired = true;
    await tm.set({ access_token: "a", refresh_token: "r", expires_in: 3600 });
    expect(tm.expired).toBe(false);
    expect(await tm.accessToken()).toBe("a");
  });
});

const tone: T3kTone = {
  id: 4711,
  title: "EVH 5150III 50W, red channel",
  description: null,
  gear: "amp-cab",
  images: ["https://cdn.tone3000.com/i/4711.webp"],
  format: "nam",
  license: "cc-by",
  sizes: ["standard", "lite"],
  makes: [],
  models_count: 3,
  a1_models_count: 2,
  a2_models_count: 1,
  custom_models_count: 0,
  irs_count: 0,
  downloads_count: 0,
  favorites_count: 0,
  is_public: true,
  created_at: "2026-01-01",
  updated_at: "2026-08-14",
  published_at: "2026-01-02",
  url: "https://www.tone3000.com/tones/4711",
  user: { id: 9, username: "fullstack_tones", display_name: null, avatar_url: "https://cdn.tone3000.com/a/9.png", url: "https://www.tone3000.com/fullstack_tones" },
};
const model = (id: number, size: T3kModel["size"], arch: T3kModel["architecture_version"]): T3kModel => ({
  id,
  name: `Gain ${id}`,
  size,
  tone_id: 4711,
  architecture_version: arch,
  model_url: `https://www.tone3000.com/api/v1/models/${id}/download`,
  updated_at: "2026-08-14",
});
const models = [model(1, "standard", "1"), model(2, "lite", "1"), model(3, "standard", "2")];

describe("tone records (meta.json)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "t3k-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes tone_id, title, gear, creator, image and the downloaded model to tones/<id>/meta.json", async () => {
    const now = new Date("2026-10-07T12:00:00Z");
    await writeRecord(dir, buildRecord(null, tone, models, { model: models[0], file: "1.nam", bytes: 418_000 }, now));
    const raw = JSON.parse(await readFile(join(dir, "4711", "meta.json"), "utf8"));
    expect(raw).toMatchObject({
      tone_id: 4711,
      title: "EVH 5150III 50W, red channel",
      gear: "amp-cab",
      format: "nam",
      creator: { username: "fullstack_tones", avatar_url: "https://cdn.tone3000.com/a/9.png" },
      image_url: "https://cdn.tone3000.com/i/4711.webp",
      license: "cc-by",
      models: [{ id: 1, name: "Gain 1", size: "standard", architecture: "1", file: "1.nam", bytes: 418_000 }],
      gp5: { verdict: "ready" },
      savedAt: "2026-10-07T12:00:00.000Z",
    });
  });

  it("marks a reshaped download and keeps links and other models across later downloads", async () => {
    const now = new Date();
    let rec = buildRecord(null, tone, models, { model: models[0], file: "1.nam", bytes: 10, reshaped: true }, now);
    expect(rec.gp5.verdict).toBe("reshape");
    rec = { ...rec, gp5: { ...rec.gp5, snaptoneSlot: 58, slotName: "5150-RED4", linkedAt: "x" } };
    await writeRecord(dir, rec);
    const next = buildRecord(await readRecord(dir, 4711), tone, models, { model: models[2], file: "3.nam", bytes: 20 }, now);
    expect(next.models.map((m) => m.id)).toEqual([1, 3]);
    expect(next.gp5).toMatchObject({ verdict: "reshape", snaptoneSlot: 58, slotName: "5150-RED4" });
  });

  it("re-downloading the same model replaces its entry instead of duplicating it", () => {
    const first = buildRecord(null, tone, models, { model: models[0], file: "1.nam", bytes: 10 }, new Date());
    const again = buildRecord(first, tone, models, { model: models[0], file: "1.nam", bytes: 12 }, new Date());
    expect(again.models).toHaveLength(1);
    expect(again.models[0].bytes).toBe(12);
  });

  it("lists only folders with a readable meta.json", async () => {
    await writeRecord(dir, buildRecord(null, tone, models, null, new Date()));
    await writeRecord(dir, buildRecord(null, { ...tone, id: 12, format: "ir", gear: "cab" }, [], null, new Date()));
    const recs = await listRecords(dir);
    expect(recs.map((r) => r.tone_id).sort()).toEqual([12, 4711]);
    expect(recs.find((r) => r.tone_id === 12)?.gp5.verdict).toBe("ir");
    expect(await listRecords(join(dir, "missing"))).toEqual([]);
  });
});
