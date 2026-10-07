import { useEffect } from "react";
import type { MenuCommand } from "@shared/ipc";
import { host } from "@/host";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";
import { openFiles, runCommand, useUi, type AppCommand } from "@/state/ui";
import { modKey } from "./keys";
import { notifyError } from "./notify";
import { requestPresetSwitch } from "./preset-switch";

/** Reconnect to the pedal in the current mode (simulated stays simulated). */
export async function reconnect(): Promise<void> {
  const d = useDevice.getState();
  try {
    await d.connect(d.mode);
  } catch {
    const err = useDevice.getState().error;
    notifyError("Couldn't connect to the GP-5", err ?? new Error("The GP-5 didn't answer."), reconnect);
  }
}

const isEditable = (el: Element | null): boolean =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

/** Undo/redo inside a text field stays native text editing; everywhere else it is the screen's undo. */
const TEXT_EDIT: Partial<Record<MenuCommand, string>> = { undo: "undo", redo: "redo" };

/** One entry point for the native menu, global shortcuts and the palette. */
export function runMenuCommand(cmd: MenuCommand): void {
  const textCmd = TEXT_EDIT[cmd];
  if (textCmd && isEditable(document.activeElement)) {
    document.execCommand(textCmd);
    return;
  }
  const { go } = useNav.getState();
  const ui = useUi.getState();
  switch (cmd) {
    case "go-rig":
      return go("rig");
    case "go-library":
      return go("library");
    case "go-tones":
      return go("tones");
    case "go-device":
      return go("device");
    case "settings":
      return go("device", "settings");
    case "command-palette":
      return ui.setPaletteOpen(!ui.paletteOpen);
    case "about":
      return ui.setAboutOpen(true);
    case "reconnect":
      return void reconnect();
    default:
      return runCommand(cmd satisfies AppCommand);
  }
}

const modalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

/**
 * Keyboard shortcuts. In Electron the native menu owns the accelerators (they arrive as menu events),
 * so only keys without a menu item are bound here; the web build binds everything.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat && e.key !== "[" && e.key !== "]") return;
  const mod = modKey(e);
  const web = host.kind === "web";
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let cmd: MenuCommand | null = null;
  let rename = false;
  let step = 0;

  if (mod && !e.altKey && !e.shiftKey && key === "k") cmd = "command-palette";
  else if (modalOpen()) return;
  else if (mod && e.shiftKey && !e.altKey && /^Digit[1-4]$/.test(e.code)) cmd = web ? (["go-rig", "go-library", "go-tones", "go-device"] as const)[Number(e.code[5]) - 1] : null;
  else if (mod && !e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight")) step = e.code === "BracketLeft" ? -1 : 1;
  else if (mod && !e.altKey && !e.shiftKey && key === "s") cmd = web ? "save-to-slot" : null;
  else if (mod && !e.altKey && !e.shiftKey && key === "d") cmd = web ? "compare-with-saved" : null;
  else if (mod && !e.altKey && key === "z") cmd = web && !isEditable(document.activeElement) ? (e.shiftKey ? "redo" : "undo") : null;
  else if (mod && e.altKey && !e.shiftKey && e.code === "KeyC") cmd = web ? "copy-block" : null;
  else if (mod && e.altKey && !e.shiftKey && e.code === "KeyV") cmd = web ? "paste-block" : null;
  else if (mod && e.shiftKey && !e.altKey && key === "b") cmd = web ? "backup-pedal" : null;
  else if (mod && !e.altKey && !e.shiftKey && key === "o") cmd = web ? "import-presets" : null;
  else if (mod && !e.altKey && !e.shiftKey && key === "e") cmd = web ? "export-preset" : null;
  else if (mod && !e.altKey && !e.shiftKey && key === ",") cmd = web ? "settings" : null;
  else if (!mod && !e.altKey && !isEditable(document.activeElement)) {
    if (e.key === "[" || e.key === "]") step = e.key === "[" ? -1 : 1;
    else if (e.key === "F2" && useNav.getState().screen === "rig") rename = true;
  }

  if (step) {
    const slot = useDevice.getState().slot;
    if (slot === null) return;
    e.preventDefault();
    void requestPresetSwitch(slot + step);
  } else if (rename) {
    e.preventDefault();
    runCommand("rename-slot");
  } else if (cmd) {
    e.preventDefault();
    runMenuCommand(cmd);
  }
}

/** Menu events, OS file opens and global shortcuts. Mount once (AppShell). */
export function useAppCommands(): void {
  useEffect(() => {
    const open = (paths: string[]) => {
      if (paths.length) openFiles(paths.map((path) => ({ name: path.split(/[\\/]/).pop() ?? path, path, file: null })));
    };
    window.addEventListener("keydown", onKeyDown);
    const off = host.app.onEvent((event) => {
      if (event.type === "menu") runMenuCommand(event.command);
      else if (event.type === "open-files") open(event.paths);
    });
    // Files from "Open with" / the command line that arrived before this listener existed.
    void host.app.takeOpenedFiles().then(open, () => {});
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      off();
    };
  }, []);
}
