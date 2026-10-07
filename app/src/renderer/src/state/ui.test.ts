import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNav } from "./nav";
import { openFiles, resetBusForTests, runCommand, useCommand, useFileHandler, useStatusMessage, useUi, type OpenFile, type StatusMessage } from "./ui";

const file = (name: string): OpenFile => ({ name, path: `/tmp/${name}`, file: null });

describe("command bus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBusForTests();
    useNav.setState({ screen: "rig", param: null });
  });
  afterEach(() => vi.useRealTimers());

  it("runs the most recently registered handler", () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useCommand("save-to-slot", a));
    const second = renderHook(() => useCommand("save-to-slot", b));
    runCommand("save-to-slot");
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    second.unmount();
    runCommand("save-to-slot");
    expect(a).toHaveBeenCalledOnce();
  });

  it("opens the home screen and delivers the command when its handler registers", () => {
    useNav.setState({ screen: "rig" });
    const backup = vi.fn();
    runCommand("backup-pedal");
    expect(useNav.getState().screen).toBe("library");
    renderHook(() => useCommand("backup-pedal", backup));
    vi.runAllTimers();
    expect(backup).toHaveBeenCalledOnce();
  });

  it("drops a pending command after 3 s", () => {
    const backup = vi.fn();
    runCommand("backup-pedal");
    vi.advanceTimersByTime(3500);
    renderHook(() => useCommand("backup-pedal", backup));
    vi.runAllTimers();
    expect(backup).not.toHaveBeenCalled();
  });

  it("does nothing when the home screen is shown but the command is unavailable", () => {
    const undo = vi.fn();
    const { rerender } = renderHook(({ on }) => useCommand("undo", undo, on), { initialProps: { on: false } });
    runCommand("undo");
    rerender({ on: true });
    vi.runAllTimers();
    expect(undo).not.toHaveBeenCalled();
  });

  it("routes files by extension and reports the rest", () => {
    const prst = vi.fn();
    const wav = vi.fn();
    renderHook(() => useFileHandler("prst", prst));
    renderHook(() => useFileHandler("wav", wav));
    const { ignored } = openFiles([file("a.prst"), file("b.PRST"), file("ir.wav"), file("notes.txt")]);
    expect(prst).toHaveBeenCalledWith([file("a.prst"), file("b.PRST")]);
    expect(wav).toHaveBeenCalledWith([file("ir.wav")]);
    expect(ignored).toEqual([file("notes.txt")]);
  });
});

describe("status bar overrides", () => {
  beforeEach(() => resetBusForTests());

  it("brings back the earlier owner's message when a newer one goes away", () => {
    const screen = renderHook(({ m }) => useStatusMessage(m), { initialProps: { m: { led: "on", text: "Screen" } as StatusMessage | null } });
    const job = renderHook(({ m }) => useStatusMessage(m), { initialProps: { m: { led: "warn", text: "Backing up" } as StatusMessage | null } });
    expect(useUi.getState().message?.text).toBe("Backing up");
    // The older owner updating doesn't jump above the newer one.
    screen.rerender({ m: { led: "on", text: "Screen 2" } });
    expect(useUi.getState().message?.text).toBe("Backing up");
    job.rerender({ m: null });
    expect(useUi.getState().message?.text).toBe("Screen 2");
    job.rerender({ m: { led: "warn", text: "Restoring" } });
    job.unmount();
    expect(useUi.getState().message?.text).toBe("Screen 2");
    screen.unmount();
    expect(useUi.getState().message).toBeNull();
  });
});
