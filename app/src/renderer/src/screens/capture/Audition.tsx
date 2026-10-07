import { useEffect, useMemo, useRef, useState } from "react";
import { Guitar, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Audition, CLIPS, peaks, renderOffline, SLIM_SIZE, type ChainSettings, type ClipId, type ModelChoice } from "./audio/engine";
import { loudnessOf, type NamInfo } from "./nam/model";
import { levelGainDb } from "./nam/recipe";
import { useCapture, useShownRecipe, type AuditionSource } from "./store";
import { fmtInt, PANEL } from "./parts";

/** Loudness every compare choice is matched to when "Level-matched" is on. */
const MATCH_DB = -18;
const BARS = 150;

export interface CompareOption {
  id: string;
  key: string;
  title: string;
  detail: string;
  choice: ModelChoice;
}

export function compareOptions(info: NamInfo): CompareOption[] {
  if (info.arch.kind === "A2") {
    const order = ["full", "lite"] as const;
    return order.flatMap((size, i) => {
      const sub = info.arch.kind === "A2" ? info.arch.submodels.find((s) => s.size === size) : undefined;
      if (!sub) return [];
      return [{ id: size, key: "AB"[i], title: size === "full" ? "A2-Full" : "A2-Lite", detail: `${fmtInt(sub.params)} params`, choice: { id: size, slimSize: SLIM_SIZE[size] } }];
    });
  }
  const title = info.arch.kind === "A1" ? `A1 ${info.arch.size}` : "Model";
  return [{ id: "a1", key: "A", title, detail: `${fmtInt(info.params)} params`, choice: { id: "a1", slimSize: SLIM_SIZE.full } }];
}

/** The one audition engine of the screen (one AudioContext, created when the editor opens). */
export const audition = new Audition();

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function useChainSettings(): ChainSettings | null {
  const loaded = useCapture((s) => s.loaded);
  const recipe = useShownRecipe();
  const levelMatched = useCapture((s) => s.levelMatched);
  return useMemo(() => {
    if (!loaded || !recipe) return null;
    const { info } = loaded;
    const gainDb: Record<string, number> = {};
    for (const o of compareOptions(info)) {
      const loud = loudnessOf(info, o.id === "a1" ? "a1" : (o.id as "full" | "lite"));
      gainDb[o.id] = levelMatched && loud !== null ? MATCH_DB - loud : levelGainDb(recipe, info.loudness);
    }
    return { shaping: recipe.shaping, gainDb };
  }, [loaded, recipe, levelMatched]);
}

export interface PlayState {
  playing: boolean;
  starting: boolean;
  duration: number | null;
  error: string | null;
}

/** Start or stop playback of the current source (Space). */
export async function togglePlay(state: { playing: boolean }, source: AuditionSource, onState: (p: Partial<PlayState>) => void) {
  if (state.playing) {
    audition.stop();
    onState({ playing: false });
    return;
  }
  onState({ starting: true, error: null });
  try {
    if (source === "live") {
      await audition.playLive();
      onState({ playing: true, starting: false, duration: null });
    } else {
      const { duration } = await audition.playClip(source);
      onState({ playing: true, starting: false, duration });
    }
  } catch (e) {
    const err = e as Error;
    const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
    onState({ starting: false, playing: false, error: denied ? "Live input needs permission to use your audio input." : (err?.message ?? String(e)) });
  }
}

/** Transport, DI source, level match, compare and the rendered preview (design: Audition strip). */
export function AuditionStrip({ play, setPlay }: { play: PlayState; setPlay: (p: Partial<PlayState>) => void }) {
  const loaded = useCapture((s) => s.loaded)!;
  const { choice, source, levelMatched, set } = useCapture();
  const settings = useChainSettings();
  const options = useMemo(() => compareOptions(loaded.info), [loaded.info]);
  const [engine, setEngine] = useState<"loading" | "ready" | "error">("loading");
  const [engineError, setEngineError] = useState<string | null>(null);

  // Load the capture into the worklet (one node per compare choice) whenever the file changes.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  useEffect(() => {
    let live = true;
    setEngine("loading");
    if (!settingsRef.current) return;
    audition
      .load(
        loaded.source.text,
        options.map((o) => o.choice),
        settingsRef.current,
        choiceRef.current,
      )
      .then(
        () => live && setEngine("ready"),
        (e: Error) => {
          if (!live) return;
          setEngine("error");
          setEngineError(e?.message ?? String(e));
        },
      );
    return () => {
      live = false;
    };
  }, [loaded.source.text, options]);

  useEffect(() => {
    if (settings && engine === "ready") audition.update(settings, choice);
  }, [settings, choice, engine]);

  const onSource = (v: string) => {
    if (!v) return;
    const next = v as AuditionSource;
    const wasPlaying = play.playing;
    if (wasPlaying) {
      audition.stop();
      setPlay({ playing: false });
    }
    set({ source: next });
    if (wasPlaying) void togglePlay({ playing: false }, next, setPlay);
  };

  const ready = engine === "ready";
  return (
    <section aria-label="Audition" className={cn(PANEL, "col-start-1 row-start-1 flex flex-col gap-3 px-4 py-3.5 min-[1421px]:col-span-2")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon-lg"
            aria-label="Play"
            aria-pressed={play.playing}
            aria-keyshortcuts="Space"
            disabled={!ready || play.starting || play.playing}
            onClick={() => void togglePlay(play, source, setPlay)}
            className="disabled:aria-pressed:opacity-100 aria-pressed:shadow-[inset_0_0_0_2px_var(--silkscreen)]"
          >
            {play.starting ? <Spinner /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Stop" disabled={!play.playing} onClick={() => (audition.stop(), setPlay({ playing: false }))}>
            <Square className="size-3" />
          </Button>
        </div>
        <span className="h-[22px] w-px bg-border" aria-hidden />
        <div className="flex items-center gap-2.5">
          <span id="ce-play-through" className="text-[11px] font-medium tracking-[0.04em] text-silkscreen-3 uppercase">
            Play through
          </span>
          <ToggleGroup type="single" value={source} onValueChange={onSource} aria-labelledby="ce-play-through" className="gap-1">
            {CLIPS.map((c, i) => (
              <ToggleGroupItem key={c.id} value={c.id} aria-keyshortcuts={String(i + 1)}>
                {c.label}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="live" aria-keyshortcuts={String(CLIPS.length + 1)}>
              <Guitar className="size-3.5" aria-hidden />
              Live input
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          <Switch id="ce-level-matched" checked={levelMatched} onCheckedChange={(v) => set({ levelMatched: v })} aria-keyshortcuts="L" />
          <Label htmlFor="ce-level-matched" className="text-[12px] font-normal whitespace-nowrap text-silkscreen-2">
            Level-matched
          </Label>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <div role="radiogroup" aria-label="Compare" className="grid flex-[3_1_380px] grid-cols-[repeat(3,minmax(0,178px))] gap-1.5">
          {options.map((o) => {
            const on = choice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-keyshortcuts={o.key}
                onClick={() => set({ choice: o.id })}
                className={cn(
                  "grid min-w-0 grid-cols-[auto_1fr] grid-rows-2 items-center gap-x-[9px] rounded-lg px-2.5 py-[7px] text-left shadow-[inset_0_0_0_1px_var(--seam-strong)] hover:bg-accent",
                  on && "bg-faceplate-raised shadow-[inset_0_0_0_2px_var(--silkscreen)]",
                )}
              >
                <span
                  className={cn(
                    "row-span-2 grid size-[22px] place-items-center rounded-xs bg-muted text-[11px] font-bold text-silkscreen-2",
                    on && "bg-silkscreen text-lamp-ink",
                  )}
                  aria-hidden
                >
                  {o.key}
                </span>
                <b className="text-[12px] leading-tight font-semibold text-silkscreen">{o.title}</b>
                <small className="truncate text-[11px] leading-snug text-silkscreen-3">{o.detail}</small>
              </button>
            );
          })}
        </div>
        <Preview play={play} engineReady={ready} />
      </div>
      {(engine === "error" || play.error || source === "live") && (
        <p className={cn("text-[12px]", engine === "error" || play.error ? "text-led-fault" : "text-silkscreen-3")} role={engine === "error" || play.error ? "alert" : undefined}>
          {engine === "error"
            ? `The audition engine couldn't load this capture: ${engineError}`
            : play.error
              ? play.error
              : "Use your audio interface's instrument input. The GP-5's USB audio isn't a dry signal."}
        </p>
      )}
    </section>
  );
}

/** Waveform of the offline render of the clip through the current choice (not a meter). */
function Preview({ play, engineReady }: { play: PlayState; engineReady: boolean }) {
  const loaded = useCapture((s) => s.loaded)!;
  const { choice, source } = useCapture();
  const settings = useChainSettings();
  const options = useMemo(() => compareOptions(loaded.info), [loaded.info]);
  const option = options.find((o) => o.id === choice) ?? options[0];
  const clip = source === "live" ? null : CLIPS.find((c) => c.id === source)!;
  const key = clip && settings ? JSON.stringify([loaded.source.sha256, option.id, settings.shaping, settings.gainDb[option.id], clip.id]) : null;
  const [render, setRender] = useState<{ key: string; bars: number[]; duration: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const cache = useRef(new Map<string, { bars: number[]; duration: number }>());

  useEffect(() => {
    if (!key || !clip || !settings || !engineReady) return;
    const hit = cache.current.get(key);
    if (hit) {
      setRender({ key, ...hit });
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      renderOffline(loaded.source.text, option.choice, settings, clip.id as ClipId).then(
        (samples) => {
          // Scaled to the render's own peak: the shape of the rendered clip, not a level reading.
          const raw = peaks(samples, BARS);
          const top = Math.max(1e-4, ...raw);
          const entry = { bars: raw.map((p) => p / top), duration: samples.length / 48000 };
          cache.current.set(key, entry);
          if (live) {
            setRender({ key, ...entry });
            setFailed(null);
          }
        },
        (e: Error) => live && setFailed(e?.message ?? String(e)),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // key covers settings/option/clip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, engineReady]);

  const [pos, setPos] = useState(0);
  const duration = play.duration ?? render?.duration ?? null;
  useEffect(() => {
    if (!play.playing || !duration) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 80) {
        last = t;
        setPos(audition.position(duration) ?? 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play.playing, duration]);

  const stale = render && render.key !== key;
  const head = play.playing && duration ? Math.round((pos / duration) * BARS) : 0;
  return (
    <div className="relative h-14 min-w-[180px] flex-[1_1_180px] rounded-lg bg-well px-2.5 pt-[21px] pb-1" aria-label="Preview of the rendered clip">
      <div className="absolute inset-x-2.5 top-1 flex justify-between gap-2 text-[11px] whitespace-nowrap text-silkscreen-3">
        <span className="min-w-0 truncate">
          <b className="font-medium text-silkscreen-2">{clip ? "Rendered preview" : "Live input"}</b>
          {clip ? ` · ${clip.label}, ${option.title}` : " · nothing is recorded"}
        </span>
        {clip && duration ? <span className="tabular-nums">{`${fmtTime(play.playing ? pos : 0)} / ${fmtTime(duration)}`}</span> : null}
      </div>
      {clip ? (
        render ? (
          <svg viewBox={`0 0 ${BARS * 4} 32`} preserveAspectRatio="none" aria-hidden className={cn("block h-[30px] w-full", stale && "opacity-50")}>
            {render.bars.map((p, i) => {
              const h = Math.max(1.5, Math.min(1, p) * 30);
              return <rect key={i} x={i * 4} y={(32 - h) / 2} width={2.4} height={h} rx={1} className={play.playing && i < head ? "fill-silkscreen-2" : "fill-silkscreen-4"} />;
            })}
            {play.playing && <line x1={head * 4 - 1} x2={head * 4 - 1} y1={0} y2={32} className="stroke-silkscreen" strokeWidth={1.5} />}
          </svg>
        ) : (
          <span className="flex h-[30px] items-center gap-2 text-[11px] text-silkscreen-3">
            {failed ? `Couldn't render: ${failed}` : (
              <>
                <Spinner className="size-3" />
                Rendering
              </>
            )}
          </span>
        )
      ) : (
        <span className="flex h-[30px] items-center text-[11px] text-silkscreen-3">The preview needs a DI clip.</span>
      )}
    </div>
  );
}
