/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { a2WeightCount } from "@shared/nam";
import { parseA2, renderA2 } from "./a2";

const file = (p: string) => readFileSync(join(__dirname, p));
const A2 = () => file("fixtures/nam_core_a2.nam").toString("utf8");
const TINY = () => file("../screens/capture/nam/fixtures/tiny-a2.nam").toString("utf8");

/** Park–Miller noise at ±0.25 (exact in float32), the input the reference outputs were rendered from. */
function noise(n: number): Float32Array {
  const x = new Float32Array(n);
  let s = 1;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    x[i] = (s / 2147483647 - 0.5) * 0.5;
  }
  return x;
}

const f32 = (p: string) => new Float32Array(new Uint8Array(file(p)).buffer);

describe("parseA2", () => {
  it("takes the container's last submodel, the one Valeton Suite renders", () => {
    const m = parseA2(A2());
    const full = JSON.parse(A2()).config.submodels[1].model;
    expect(m.channels).toBe(8);
    expect(m.layers.map((l) => [l.kernel, l.dilation])).toEqual(full.config.layers[0].kernel_sizes.map((k: number, i: number) => [k, full.config.layers[0].dilations[i]]));
    expect(m.prewarm).toBe(6346);
    expect(m.sampleRate).toBe(48000);
    expect(m.headScale).toBe(Math.fround(full.weights[full.weights.length - 1]));
    expect(full.weights.length).toBe(a2WeightCount(8));
  });

  it("reorders conv and head weights into the kernel's tap-major layout", () => {
    const m = parseA2(A2());
    const w: number[] = JSON.parse(A2()).config.submodels[1].model.weights;
    // file order: rechannel (8), then layer 0 conv [out][in][kernel 6]
    expect(m.rechannel[3]).toBe(Math.fround(w[3]));
    const o = 2, i = 5, k = 4;
    expect(m.layers[0].conv[(k * 8 + o) * 8 + i]).toBe(Math.fround(w[8 + (o * 8 + i) * 6 + k]));
    // head [in][tap] sits before head bias and head_scale
    const head = w.length - 2 - 8 * 16;
    expect(m.head[3 * 8 + 7]).toBe(Math.fround(w[head + 7 * 16 + 3]));
    expect(m.headBias).toBe(Math.fround(w[w.length - 2]));
  });

  it("refuses what the A2 kernel doesn't render", () => {
    const bad = JSON.parse(A2());
    bad.config.submodels[1].model.config.layers[0].channels = 16;
    expect(() => parseA2(JSON.stringify(bad))).toThrow(/16 channels/);
  });
});

describe("renderA2", () => {
  // References: NeuralAmpModelerCore at commit baf1bf8 (the A2 fast path Valeton Suite 2.1.0 ships), Reset(48000, 1024)
  // then 1024-frame blocks, on the same noise. 3003 frames end in a partial block with a scalar tail.
  it.each([
    ["A2 standard (8 channels)", A2, "fixtures/nam_core_a2.lcg3003.f32"],
    ["A2 nano (3 channels)", TINY, "fixtures/tiny_a2.lcg3003.f32"],
  ])("is bit-exact with NAM core's A2 fast path: %s", async (_, text, reference) => {
    const y = await renderA2(file("a2kernel.wasm"), parseA2(text()), noise(3003));
    expect(Array.from(y)).toEqual(Array.from(f32(reference)));
  });
});
