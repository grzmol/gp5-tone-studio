import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
// vi.mock is hoisted above these imports: the real engine needs a worker and the model.
import { useSong } from "@/song/store";
import type { PcmAudio, StemName } from "@/song/types";
import { useNav } from "@/state/nav";
import { useSongTab } from "./tab";

vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));

const STEMS = {} as Record<StemName, PcmAudio>;

/** Mount the Song screen's tab hook the way AppShell does: only while Song is the active screen. */
const mountSong = (param: string | null = null) => {
  act(() => useNav.getState().go("song", param));
  return renderHook(() => useSongTab());
};

describe("Song tab", () => {
  beforeEach(() => {
    useSong.setState({ stems: STEMS });
    // Start every test from Stems as the last tab used.
    mountSong("stems").unmount();
  });

  it("opens the tab named by the nav param", () => {
    expect(mountSong("tone").result.current[0]).toBe("tone");
    expect(mountSong("stems").result.current[0]).toBe("stems");
  });

  it("defaults to Stems", () => {
    expect(mountSong().result.current[0]).toBe("stems");
  });

  it("choosing a tab sets the nav param", () => {
    const { result } = mountSong();
    act(() => result.current[1]("tone"));
    expect(useNav.getState()).toMatchObject({ screen: "song", param: "tone" });
    expect(result.current[0]).toBe("tone");
  });

  it("comes back to Tone match after a trip to the Rig", () => {
    const song = mountSong();
    act(() => song.result.current[1]("tone"));
    song.unmount();
    act(() => useNav.getState().go("rig"));
    expect(mountSong().result.current[0]).toBe("tone");
  });

  it("shows Stems when Tone match was last but there are no stems to match", () => {
    mountSong("tone").unmount();
    useSong.setState({ stems: null });
    const { result } = mountSong();
    expect(result.current[0]).toBe("stems");
    act(() => useSong.setState({ stems: STEMS }));
    expect(result.current[0]).toBe("tone");
  });
});
