import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ExternalLinkIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";
import { defaultParams, modelsForBlock } from "@/gp5/lib/catalog.mjs";
import { notifyError } from "@/app/notify";
import { Capture, GearFor } from "@/components/gear";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { BLOCK_CODES, type BlockCode, type BlockState, type ModelInfo, type SlotName } from "@/state/device-types";
import { useNav } from "@/state/nav";
import { applyBlock, recordBlock, snapshot } from "./edits";
import type { BlockSnapshot } from "./history";
import { groupsOf, groupOf } from "./order";
import { useRig } from "./rig-store";
import { snapToneIndex } from "./snaptone";

const CATEGORY: Record<BlockCode, string> = {
  NR: "Noise gate",
  PRE: "Comp, boost, wah",
  DST: "Distortion",
  NS: "SnapTone captures",
  AMP: "Amps",
  CAB: "Cabs and IRs",
  EQ: "EQ",
  MOD: "Modulation",
  DLY: "Delay",
  RVB: "Reverb",
};
const NOUN: Record<BlockCode, string> = {
  NR: "noise gate",
  PRE: "comp, boost or wah",
  DST: "distortion",
  NS: "SnapTone",
  AMP: "amp",
  CAB: "cab or IR",
  EQ: "EQ",
  MOD: "modulation",
  DLY: "delay",
  RVB: "reverb",
};
const article = (w: string) => (/^[aeiou]|^EQ/i.test(w) ? "an" : "a");

const FAV_KEY = "gp5.favorites.v1";
const loadFavs = (): number[] => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as number[];
  } catch {
    return [];
  }
};

interface Tile {
  model: ModelInfo;
  title: string;
  sub: string;
  empty?: boolean;
}

function tilesFor(code: BlockCode, snapTones: SlotName[] | null, userIRs: SlotName[] | null): Tile[] {
  const models = modelsForBlock(code) as ModelInfo[];
  if (code === "NS")
    return models.map((m) => {
      const n = snapToneIndex(m.fxid);
      const name = snapTones?.find((s) => s.slot === n)?.name;
      const empty = n >= 50 && name === "Empty";
      return { model: m, title: name ? `${n} ${name}` : m.title, sub: n >= 50 ? (empty ? "Empty user slot" : "User slot") : "Factory slot", empty };
    });
  return models.map((m) => {
    if (m.type === "User IR") {
      // Catalog titles are 1-based ("User IR 1" = fxid 0x0A100000), the slot table 0-based.
      const n = Number(/\d+/.exec(m.title)?.[0] ?? 0);
      const name = userIRs?.find((s) => s.slot === n - 1)?.name;
      return { model: m, title: name && !/^User IR \d+$/.test(name) ? `IR ${n} ${name}` : m.title, sub: "User IR slot" };
    }
    return { model: m, title: m.title, sub: m.origin ?? m.type };
  });
}

function tabsFor(code: BlockCode, tiles: Tile[]): { value: string; label: string }[] {
  if (code === "NS") return [{ value: "user", label: "User 50–79" }, { value: "factory", label: "Factory 0–49" }, { value: "fav", label: "Favorites" }];
  if (code === "CAB") return [{ value: "all", label: "All" }, { value: "factory", label: "Factory cabs" }, { value: "User IR", label: "User IRs" }, { value: "fav", label: "Favorites" }];
  const types = [...new Set(tiles.map((t) => t.model.type))];
  return [{ value: "all", label: "All" }, ...(types.length > 1 ? types.map((t) => ({ value: t, label: t })) : []), { value: "fav", label: "Favorites" }];
}

function inTab(tab: string, t: Tile, favs: number[]): boolean {
  const n = snapToneIndex(t.model.fxid);
  switch (tab) {
    case "all":
      return true;
    case "fav":
      return favs.includes(t.model.fxid);
    case "user":
      return n >= 50;
    case "factory":
      return t.model.block === "NS" ? n < 50 : t.model.type !== "User IR";
    default:
      return t.model.type === tab;
  }
}

/** Thumbnail state: the live params for the current model, catalog defaults for the others; always drawn on. */
const thumbBlock = (b: BlockState, m: ModelInfo): BlockState => ({
  index: b.index,
  code: b.code,
  enabled: true,
  fxid: m.fxid,
  model: m,
  params: b.fxid === m.fxid ? b.params : defaultParams(m.fxid),
});

const THUMB_W: Partial<Record<BlockCode, string>> = { AMP: "w-[104px]", CAB: "w-[88px]" };

/** Visual model browser over the board (rig.html#picker): arrows audition on the pedal, Enter keeps, Esc reverts. */
export function ModelPicker() {
  const picker = useRig((s) => s.picker);
  const preset = useDevice((s) => s.preset);
  if (!picker || !preset) return null;
  return <PickerPanel key={`${picker.block}`} blockIndex={picker.block} highlight={picker.highlight} initialTab={picker.tab} />;
}

function PickerPanel({ blockIndex, highlight, initialTab }: { blockIndex: number; highlight?: number; initialTab?: string }) {
  const preset = useDevice((s) => s.preset)!;
  const connected = useDevice((s) => s.status === "connected");
  const snapTones = useDevice((s) => s.snapTones);
  const userIRs = useDevice((s) => s.userIRs);
  const block = preset.blocks[blockIndex];
  const code = block.code;
  const original = useRef<BlockSnapshot>(snapshot(block)).current;
  const originalTitle = useRef(block.model?.title ?? "the original model").current;
  const tiles = useMemo(() => tilesFor(code, snapTones, userIRs), [code, snapTones, userIRs]);
  const tabs = useMemo(() => tabsFor(code, tiles), [code, tiles]);
  const [tab, setTab] = useState(() => initialTab ?? (code === "NS" ? (snapToneIndex(block.fxid) >= 50 ? "user" : "factory") : "all"));
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState(loadFavs);
  const [focusFx, setFocusFx] = useState<number>(highlight ?? block.fxid);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const want = useRef<number | null>(null);
  const run = useRef<Promise<void> | null>(null);

  // SnapTone and IR names come from the pedal on demand.
  useEffect(() => {
    if (!connected) return;
    const d = useDevice.getState();
    if (code === "NS" && !d.snapTones) d.readSnapTones().catch((e) => notifyError("Couldn't read SnapTone slots", e, () => void useDevice.getState().readSnapTones()));
    if (code === "CAB" && !d.userIRs) d.readUserIRs().catch((e) => notifyError("Couldn't read User IR slots", e, () => void useDevice.getState().readUserIRs()));
  }, [code, connected]);

  const q = query.trim().toLowerCase();
  const visible = tiles.filter((t) => inTab(tab, t, favs) && (!q || t.title.toLowerCase().includes(q) || t.model.name.toLowerCase().includes(q) || (t.model.origin ?? "").toLowerCase().includes(q)));
  const playing = block.fxid;
  const auditioning = playing !== original.fxid;
  const playingTile = tiles.find((t) => t.model.fxid === playing);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-fx="${focusFx}"]`)?.focus({ preventScroll: false });
  }, [focusFx]);

  /** Latest requested model wins; one setModel in flight. */
  const audition = (fxid: number) => {
    setFocusFx(fxid);
    if (!connected) return;
    want.current = fxid;
    if (run.current) return;
    run.current = (async () => {
      try {
        while (want.current !== null) {
          const f = want.current;
          want.current = null;
          if (useDevice.getState().preset?.blocks[blockIndex].fxid !== f) await useDevice.getState().setModel(blockIndex, f);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        run.current = null;
      }
    })();
  };

  const settle = async () => {
    want.current = null;
    await run.current;
  };
  const close = () => useRig.getState().openPicker(null);
  const keep = async () => {
    await settle();
    const now = useDevice.getState().preset?.blocks[blockIndex];
    if (now) recordBlock(`Change ${code} model`, original, snapshot(now));
    close();
  };
  const revert = async () => {
    await settle();
    try {
      await applyBlock(original);
    } catch (e) {
      notifyError(`Couldn't put ${originalTitle} back`, e);
    }
    close();
  };
  const switchBlock = async (b: number) => {
    await revert();
    useRig.getState().select(b);
    useRig.getState().openPicker({ block: b });
  };
  const toggleFav = (fxid: number) => {
    const next = favs.includes(fxid) ? favs.filter((f) => f !== fxid) : [...favs, fxid];
    setFavs(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" && e.key !== "Escape" && e.key !== "Enter" && e.key !== "ArrowDown") return;
    if (e.key === "Escape") {
      e.preventDefault();
      void revert();
      return;
    }
    if (e.key === "Enter" && !(e.target as HTMLElement).closest("button:not([data-fx])")) {
      e.preventDefault();
      if (connected) void keep();
      else close();
      return;
    }
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleFav(focusFx);
      return;
    }
    const grid = gridRef.current;
    if (!grid || !visible.length) return;
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const i = visible.findIndex((t) => t.model.fxid === focusFx);
    const next = visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + delta))];
    audition(next.model.fxid);
  };

  const group = groupOf(preset.order, blockIndex);
  const inGroup = groupsOf(preset.order)[group];
  const cats = [...inGroup, ...(group === "amp" ? [] : [3, 4])];
  const focusTile = tiles.find((t) => t.model.fxid === focusFx);
  const favOn = favs.includes(focusFx);
  const title = `Choose ${article(NOUN[code])} ${NOUN[code]}`;
  const count = code === "NS" ? `NS, ${tiles.filter((t) => snapToneIndex(t.model.fxid) >= 50 && !t.empty).length} of 30 user slots used` : `${code}, ${tiles.length} models`;

  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={onKeyDown}
      className="glass-strong absolute inset-[14px_28px_12px] z-40 flex flex-col rounded-xl [@media(max-height:820px)]:inset-[10px_28px_10px]"
    >
      <div className="flex items-center gap-4 border-b border-seam py-3 pr-4 pl-5">
        <div className="mr-2 flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span className="size-[9px] flex-none rounded-full" style={{ background: `var(--block-${code.toLowerCase()})` }} />
          <b className="text-[15px] font-semibold">{title}</b>
          <span className="text-sm text-silkscreen-3 max-[1320px]:hidden">{count}</span>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="min-w-0 shrink overflow-x-auto [scrollbar-width:none]">
          <TabsList aria-label="Model types">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.value === "fav" && <StarIcon className="size-3" aria-hidden />}
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {code === "NS" && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void revert().then(() => useNav.getState().go("tones"))}>
            <ExternalLinkIcon className="size-3.5" aria-hidden />
            Browse TONE3000 captures
          </Button>
        )}
        <InputGroup className={cn("ml-auto h-8 min-w-[150px] shrink", code === "NS" ? "w-[200px]" : "w-[260px]")}>
          <InputGroupAddon>
            <SearchIcon className="size-3.5" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search models"
            placeholder={code === "NS" ? "Find a SnapTone" : "Find a model or the gear it models"}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </InputGroup>
        <Button variant="ghost" size="icon" aria-label="Close and revert" onClick={() => void revert()}>
          <XIcon aria-hidden />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[210px_1fr]">
        <nav aria-label="Blocks" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-seam px-2.5 py-3">
          {cats.map((b) => {
            const c = BLOCK_CODES[b];
            const enabled = inGroup.includes(b);
            return (
              <button
                key={b}
                type="button"
                disabled={!enabled}
                aria-current={b === blockIndex}
                onClick={() => b !== blockIndex && void switchBlock(b)}
                className={cn(
                  "flex h-[34px] shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-silkscreen-2 enabled:hover:bg-accent disabled:cursor-default disabled:opacity-35",
                  b === blockIndex && "bg-white/14 text-silkscreen shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]",
                )}
              >
                <span className="size-[9px] flex-none rounded-full" style={{ background: `var(--block-${c.toLowerCase()})` }} />
                {CATEGORY[c]}
                <span className="ml-auto text-xs tracking-wide text-silkscreen-4">{c}</span>
              </button>
            );
          })}
          <p className="mx-1.5 mt-auto mb-1 text-xs text-pretty text-silkscreen-4">
            {code === "NS"
              ? "Captures live in SnapTone slots on the pedal. New ones arrive through Tones and the capture editor."
              : `Each GP-5 block holds one kind of effect, so ${article(NOUN[code])} ${NOUN[code]} can only go in ${code}.`}
          </p>
        </nav>
        <div ref={gridRef} role="listbox" aria-label={`${CATEGORY[code]} models`} className="grid min-h-0 auto-rows-max grid-cols-[repeat(auto-fill,minmax(118px,1fr))] content-start gap-2.5 overflow-auto px-4 py-3.5">
          {visible.map((t) => {
            const current = t.model.fxid === original.fxid;
            const live = t.model.fxid === playing && auditioning;
            const focused = t.model.fxid === focusFx;
            return (
              <button
                key={t.model.fxid}
                type="button"
                role="option"
                aria-selected={live || (current && !auditioning)}
                data-fx={t.model.fxid}
                tabIndex={focused ? 0 : -1}
                onClick={() => audition(t.model.fxid)}
                onDoubleClick={() => connected && void keep()}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-lg px-2 pt-6 pb-2.5 text-center hover:bg-accent",
                  current && "bg-white/8 shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.9)]",
                  live && "bg-faceplate-raised shadow-[inset_0_0_0_1.5px_var(--led-on)]",
                  t.empty && "opacity-60",
                )}
              >
                {live && <em className="absolute top-2 left-2 text-xs font-bold tracking-wide text-led-on uppercase not-italic">Playing now</em>}
                {current && <CheckIcon className="absolute top-2 right-2 size-3.5" aria-label="Current model" />}
                {!current && favs.includes(t.model.fxid) && <StarIcon className="absolute top-2 right-2 size-3 fill-current text-silkscreen-3" aria-label="Favorite" />}
                {code === "NS" ? (
                  <Capture name={t.title.replace(/^\d+ /, "")} className="mb-1 w-[62px] drop-shadow-[0_8px_10px_rgb(0_0_0/0.6)]" />
                ) : (
                  <GearFor block={thumbBlock(block, t.model)} className={cn(THUMB_W[code] ?? "w-[62px]", "mb-1 drop-shadow-[0_8px_10px_rgb(0_0_0/0.6)]")} />
                )}
                <b className="text-sm font-semibold">{t.title}</b>
                <span className="text-xs leading-tight text-silkscreen-3">{t.sub}</span>
              </button>
            );
          })}
          {!visible.length && (
            <p className="col-span-full py-10 text-center text-sm text-silkscreen-3">
              {tab === "fav" ? "No favorites here yet. Select a model and press F, or use the star button below." : "Nothing matches. Try the model or the gear it is based on."}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3.5 border-t border-seam px-4 py-2.5 text-xs text-silkscreen-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-[7px] flex-none rounded-full", error ? "bg-led-fault" : auditioning ? "bg-led-on" : "bg-led-off")} />
          <span className="truncate">
            {error
              ? `Couldn't switch the model: ${error}`
              : !connected
                ? "Connect the GP-5 to audition models on the pedal."
                : auditioning
                  ? `Auditioning ${playingTile?.title ?? "a model"} on the pedal. ${originalTitle} comes back if you press Esc.`
                  : "Click a model or use the arrow keys to hear it on the pedal."}
          </span>
        </span>
        <span className="grow" />
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-silkscreen-3 max-[1320px]:hidden">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> audition <Kbd>Enter</Kbd> keep <Kbd>Esc</Kbd> revert
        </span>
        {focusTile && (
          <Button variant="ghost" size="sm" aria-pressed={favOn} onClick={() => toggleFav(focusFx)}>
            <StarIcon className={cn("size-3.5", favOn && "fill-current")} aria-hidden />
            {favOn ? "Favorite" : "Add to favorites"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void revert()}>
          Revert
        </Button>
        <Button size="sm" disabled={!connected} onClick={() => void keep()}>
          {auditioning ? `Keep ${playingTile?.title ?? "model"}` : "Done"}
        </Button>
      </div>
    </div>
  );
}
