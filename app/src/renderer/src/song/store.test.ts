import { describe, expect, it, vi } from "vitest";
import type { Separation, SeparationProgress } from "./stems/engine";
import type { PcmAudio } from "./types";
// vi.mock is hoisted above this import: the real engine needs a worker and the model; the store gets fakes.
import { createSongStore } from "./store";

vi.mock("./stems/engine", () => ({ separateStems: vi.fn() }));

const audio = (n = 4): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(n), new Float32Array(n)] });
const file = (name: string) => new File([new Uint8Array(4)], name);
const stems = (): Separation => ({ stems: Array.from({ length: 6 }, (_, i) => [new Float32Array(4).fill(i), new Float32Array(4)]), backend: "webgpu", seconds: 1.5 });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("song store", () => {
  it("decodes a file into the source and clears the stems", async () => {
    const useSong = createSongStore({ decode: async () => audio(), separate: async () => stems() });
    const loading = useSong.getState().load(file("a.mp3"));
    expect(useSong.getState().status).toEqual({ kind: "decoding" });
    await loading;
    expect(useSong.getState().source?.name).toBe("a.mp3");
    expect(useSong.getState().status).toEqual({ kind: "idle" });
  });

  it("shows decode errors", async () => {
    const useSong = createSongStore({ decode: async () => Promise.reject(new Error("bad file")), separate: async () => stems() });
    await useSong.getState().load(file("x.ogg"));
    expect(useSong.getState().status).toEqual({ kind: "error", message: "bad file" });
    expect(useSong.getState().source).toBeNull();
  });

  it("walks model download → splitting → done and maps stems by name", async () => {
    const statuses: string[] = [];
    const useSong = createSongStore({
      decode: async () => audio(),
      separate: async (_a, onProgress: (p: SeparationProgress) => void) => {
        onProgress({ stage: "model", fraction: 0.5 });
        statuses.push(JSON.stringify(useSong.getState().status));
        onProgress({ stage: "split", fraction: 0.25 });
        statuses.push(JSON.stringify(useSong.getState().status));
        return stems();
      },
    });
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    expect(statuses).toEqual([JSON.stringify({ kind: "model", fraction: 0.5 }), JSON.stringify({ kind: "splitting", fraction: 0.25 })]);
    const s = useSong.getState();
    expect(s.status).toEqual({ kind: "done" });
    expect(s.stems?.guitar.channels[0][0]).toBe(4);
    expect(s.stems?.drums.channels[0][0]).toBe(0);
    expect(s.lastSplit).toEqual({ backend: "webgpu", seconds: 1.5 });
  });

  it("cancel aborts the split and drops its result", async () => {
    const d = deferred<Separation>();
    let signal: AbortSignal | null = null;
    const useSong = createSongStore({
      decode: async () => audio(),
      separate: (_a, _p, s) => {
        signal = s;
        return d.promise;
      },
    });
    await useSong.getState().load(file("a.wav"));
    const running = useSong.getState().split();
    useSong.getState().cancel();
    expect(signal!.aborted).toBe(true);
    expect(useSong.getState().status).toEqual({ kind: "idle" });
    d.resolve(stems());
    await running;
    expect(useSong.getState().stems).toBeNull();
    expect(useSong.getState().status).toEqual({ kind: "idle" });
  });

  it("loading another song aborts a running split; errors after abort are ignored", async () => {
    const d = deferred<Separation>();
    let signal: AbortSignal | null = null;
    const useSong = createSongStore({
      decode: async () => audio(),
      separate: (_a, _p, s) => {
        signal = s;
        return d.promise;
      },
    });
    await useSong.getState().load(file("a.wav"));
    const running = useSong.getState().split();
    await useSong.getState().load(file("b.flac"));
    expect(signal!.aborted).toBe(true);
    d.reject(new DOMException("Separation cancelled", "AbortError"));
    await running;
    expect(useSong.getState().source?.name).toBe("b.flac");
    expect(useSong.getState().status).toEqual({ kind: "idle" });
  });

  it("shows split errors and reset clears everything", async () => {
    const useSong = createSongStore({ decode: async () => audio(), separate: async () => Promise.reject(new Error("offline")) });
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    expect(useSong.getState().status).toEqual({ kind: "error", message: "offline" });
    useSong.getState().reset();
    expect(useSong.getState()).toMatchObject({ source: null, stems: null, status: { kind: "idle" } });
  });

  it("split without a song does nothing", async () => {
    const separate = vi.fn();
    const useSong = createSongStore({ decode: async () => audio(), separate });
    await useSong.getState().split();
    expect(separate).not.toHaveBeenCalled();
  });
});
