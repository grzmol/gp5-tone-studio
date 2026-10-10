import { beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock is hoisted above these imports: the real analysis runs in a worker, the split needs the model.
import { useSong } from "@/song/store";
import type { PcmAudio, StemName } from "@/song/types";
import type { GuitarAnalysis } from "./analyse";
import { analyseStem } from "./run";
import { useToneMatch } from "./store";

vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));
vi.mock("./run", () => ({ analyseStem: vi.fn() }));
vi.mock("./proposal", () => ({ proposePreset: () => ({ blocks: [] }) }));

const pcm = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4)] });
const stems = () => ({ drums: pcm(), bass: pcm(), other: pcm(), vocals: pcm(), guitar: pcm(), piano: pcm() }) as Record<StemName, PcmAudio>;
const analysis = {} as GuitarAnalysis;

describe("tone match store", () => {
  beforeEach(() => {
    vi.mocked(analyseStem).mockReset();
    useSong.setState({ stems: null });
    useToneMatch.getState().reset();
  });

  it("analyses the guitar stem as soon as a split delivers it, without the Tone match tab open", async () => {
    vi.mocked(analyseStem).mockResolvedValue(analysis);
    const next = stems();
    useSong.setState({ stems: next });
    expect(analyseStem).toHaveBeenCalledOnce();
    expect(vi.mocked(analyseStem).mock.calls[0][0]).toBe(next.guitar);
    await vi.waitFor(() => expect(useToneMatch.getState().status.kind).toBe("done"));
    expect(useToneMatch.getState().analysis).toBe(analysis);
  });

  it("drops the analysis when the stems go away", async () => {
    vi.mocked(analyseStem).mockResolvedValue(analysis);
    useSong.setState({ stems: stems() });
    await vi.waitFor(() => expect(useToneMatch.getState().status.kind).toBe("done"));
    useSong.setState({ stems: null });
    expect(useToneMatch.getState()).toMatchObject({ status: { kind: "idle" }, analysis: null, proposal: null });
    expect(analyseStem).toHaveBeenCalledOnce();
  });

  it("aborts the running analysis when new stems arrive and keeps only the new result", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(analyseStem).mockImplementation((_stem, _progress, signal) => {
      signals.push(signal!);
      return new Promise<GuitarAnalysis>(() => {});
    });
    useSong.setState({ stems: stems() });
    useSong.setState({ stems: stems() });
    expect(analyseStem).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(useToneMatch.getState().status.kind).toBe("running");
  });
});
