import { useCallback, useEffect, useRef, useState } from "react";
import { AudioWaveform, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/host";
import { notifyError } from "@/app/notify";
import { useNav } from "@/state/nav";
import { useCommand, useFileHandler, useStatusHints, type OpenFile } from "@/state/ui";
import { loadRecords } from "@/screens/tones/store";
import { AuditionStrip, audition, compareOptions, togglePlay, type PlayState } from "./Audition";
import { EditPanel } from "./EditPanel";
import { Head } from "./Head";
import { Pipeline } from "./Pipeline";
import { VersionsButton, VersionsPanel } from "./Versions";
import { isDirty, useCapture, type EditTab } from "./store";
import { CLIPS } from "./audio/engine";

const HINTS = [
  { keys: ["Space"], label: "play" },
  { keys: ["A", "B"], label: "compare" },
  { keys: ["L"], label: "level match" },
  { keys: ["Mod", "S"], label: "save version" },
];
const TABS: EditTab[] = ["info", "level", "size", "shape"];

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);
const modalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"]');

/** Import `.nam` files (OS open, drop, file picker) and show the first one. */
async function openNamFiles(files: OpenFile[]) {
  const f = files[0];
  if (!f) return;
  try {
    const ref = f.path ? await host.capture.importFile(f.path) : f.file ? await host.capture.importText(f.name, await f.file.text()) : null;
    if (ref) useNav.getState().go("capture", ref);
  } catch (e) {
    notifyError(`Couldn't open ${f.name}`, e);
  }
}

/** Capture editor (design/screens/capture-editor.md): inspect and edit a NAM capture, versions, GP-5 readiness. */
export function CaptureEditorScreen() {
  const param = useNav((s) => s.param);
  const status = useCapture((s) => s.status);
  const error = useCapture((s) => s.error);
  const progress = useCapture((s) => s.progress);
  const fileInput = useRef<HTMLInputElement>(null);
  const [play, setPlayState] = useState<PlayState>({ playing: false, starting: false, duration: null, error: null });
  const setPlay = useCallback((p: Partial<PlayState>) => setPlayState((s) => ({ ...s, ...p })), []);
  const playRef = useRef(play);
  playRef.current = play;

  const isA2 = useCapture((s) => s.loaded?.info.arch.kind === "A2");
  useStatusHints(status === "ready" ? (isA2 ? HINTS : HINTS.filter((h) => h.label !== "compare")) : null);
  useFileHandler("nam", openNamFiles);

  useEffect(() => {
    void loadRecords();
  }, []);

  // Open the capture named by the nav param; leaving it (other capture or screen) closes the draft as a version.
  useEffect(() => {
    if (!param) {
      useCapture.getState().reset();
      return;
    }
    void useCapture.getState().open(param);
    return () => {
      audition.stop();
      setPlay({ playing: false, starting: false });
      const s = useCapture.getState();
      if (isDirty(s) && s.viewing === null) s.saveVersion().catch((e) => notifyError("Couldn't save your changes as a version", e));
    };
  }, [param, setPlay]);

  useEffect(() => () => void audition.dispose(), []);

  const save = useCallback(async () => {
    try {
      await useCapture.getState().saveVersion();
    } catch (e) {
      notifyError("Couldn't save the version", e);
    }
  }, []);
  useCommand("save-to-slot", save, status === "ready");
  useCommand("undo", () => useCapture.getState().undo(), status === "ready");
  useCommand("redo", () => useCapture.getState().redo(), status === "ready");

  // Screen keys (design: Keyboard). Ctrl/Cmd S, Z and Shift Z arrive as commands from the shell.
  useEffect(() => {
    if (status !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || modalOpen()) return;
      const s = useCapture.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
        const tab = TABS[Number(e.code[5]) - 1];
        if (tab === "size" && s.loaded?.info.arch.kind !== "A2") return;
        e.preventDefault();
        s.set({ tab });
        return;
      }
      if (mod || e.shiftKey || isEditable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if (e.key === " " && !(document.activeElement instanceof HTMLButtonElement)) {
        e.preventDefault();
        void togglePlay(playRef.current, s.source, setPlay);
      } else if (key === "a" || key === "b") {
        const opt = s.loaded ? compareOptions(s.loaded.info).find((o) => o.key === key.toUpperCase()) : undefined;
        if (opt) s.set({ choice: opt.id });
      } else if (key === "l") {
        s.set({ levelMatched: !s.levelMatched });
      } else if (/^[1-9]$/.test(key)) {
        const i = Number(key) - 1;
        const source = i < CLIPS.length ? CLIPS[i].id : i === CLIPS.length ? "live" : null;
        if (source && source !== s.source) {
          if (playRef.current.playing) {
            audition.stop();
            setPlay({ playing: false });
          }
          s.set({ source });
        }
      } else if (e.key === "Escape" && s.viewing !== null) {
        s.view(null);
      } else if (e.key === "Escape") {
        useNav.getState().go("tones", s.loaded?.source.kind === "tone" ? s.loaded.source.ref : null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, setPlay]);

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept=".nam"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void openNamFiles([{ name: file.name, path: null, file }]);
      }}
    />
  );
  const pick = () => fileInput.current?.click();

  if (!param || status === "error") {
    return (
      <div className="grid h-full place-items-center p-6">
        {picker}
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AudioWaveform />
            </EmptyMedia>
            <EmptyTitle>{status === "error" ? "This capture can't be opened" : "Edit a NAM capture"}</EmptyTitle>
            <EmptyDescription>
              {status === "error"
                ? error
                : "Open a .nam file, or choose a NAM tone in Tones and pick Edit capture. The original file is never changed: every edit is a version on top of it."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            <Button onClick={pick}>
              <FileUp aria-hidden />
              Open a .nam file…
            </Button>
            <Button variant="outline" onClick={() => useNav.getState().go("tones")}>
              Go to Tones
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (status !== "ready") {
    return (
      <div className="grid h-full place-items-center text-[12px] text-silkscreen-3" role="status">
        <span className="flex items-center gap-2">
          <Spinner />
          {progress ?? "Opening the capture"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {picker}
      <Head onOpenFile={pick} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_392px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-6 pb-4 min-[1421px]:grid-cols-[minmax(0,1fr)_220px_392px]">
        <AuditionStrip play={play} setPlay={setPlay} />
        <EditPanel versionsButton={<VersionsButton />} />
        <VersionsPanel />
        <Pipeline />
      </div>
    </div>
  );
}
