import { ChevronLeft, CircleCheck, Download, EllipsisVertical, ExternalLink, FileUp, FolderOpen, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { gearLabel, licenseLabel } from "@shared/tone3000";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { host, isElectron } from "@/host";
import { notifyError, notifySuccess } from "@/app/notify";
import { useNav } from "@/state/nav";
import { ToneImage } from "@/screens/tones/ToneImage";
import { formatKhz, type NamInfo } from "./nam/model";
import { originalRecipe } from "./nam/recipe";
import { exportText, isDirty, useCapture, useShownRecipe } from "./store";
import { archLabel, Led, useCaptureTitle, useToneRecord } from "./parts";

export interface Verdict {
  tone: "on" | "warn" | "fault";
  label: string;
  reason: string;
}

/** GP-5 compatibility of the open capture (head pill and pipeline). */
export function verdictOf(info: NamInfo, linkedSlot: number | null): Verdict {
  if (info.unsupported) return { tone: "fault", label: "Can't convert this capture", reason: info.unsupported };
  if (info.arch.kind === "A1" && info.arch.size !== "standard") {
    return { tone: "fault", label: "GP-5 can't load this", reason: `The GP-5 loads NAM A1 standard only. This file is A1 ${info.arch.size}.` };
  }
  if (info.arch.kind === "A1") {
    if (linkedSlot !== null) return { tone: "on", label: `Linked to slot ${linkedSlot} on your GP-5`, reason: "This tone is linked to a user SnapTone slot on your GP-5." };
    return { tone: "on", label: "Ready for GP-5", reason: "NAM A1 standard: Tone Studio can turn it into a SnapTone and write it to the pedal." };
  }
  return { tone: "warn", label: "GP-5 needs A1: convert", reason: "The GP-5 loads NAM A1 standard only. This A2 capture needs an A1 version first." };
}

export function Head({ onOpenFile }: { onOpenFile: () => void }) {
  const loaded = useCapture((s) => s.loaded)!;
  const { base, savedN, saving, viewing, past, future, undo, redo, edit } = useCapture();
  const dirty = useCapture(isDirty);
  const recipe = useShownRecipe();
  const record = useToneRecord();
  const title = useCaptureTitle();
  const go = useNav((s) => s.go);
  const { info, source } = loaded;
  const arch = archLabel(info);
  const verdict = verdictOf(info, record?.gp5.snaptoneSlot ?? null);
  const nextN = (loaded.versions.at(-1)?.n ?? 0) + 1;

  const onExport = async () => {
    if (!recipe) return;
    try {
      const name = `${title}.nam`;
      const path = await host.capture.exportFile(name, exportText(loaded, recipe));
      if (path) notifySuccess(`Exported ${name}`, isElectron ? path : "Saved to your downloads.");
    } catch (e) {
      notifyError("Couldn't export the capture", e);
    }
  };

  const onShowFiles = () => host.capture.showFiles(loaded.key).catch((e) => notifyError("Couldn't show the files", e));

  return (
    <div className="flex items-end gap-5 px-6 pt-3.5 pb-4">
      {record ? (
        <ToneImage url={record.image_url} gear={record.gear} format={record.format} alt={record.title} square className="w-[92px] max-[1420px]:w-20" />
      ) : (
        <ToneImage url={null} gear={String(loaded.file.metadata?.gear_type ?? "amp")} format="nam" alt="" square caption={false} className="w-[92px] max-[1420px]:w-20" />
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[11px] text-silkscreen-3">
          <button
            type="button"
            onClick={() => go("tones", source.kind === "tone" ? source.ref : null)}
            className="relative inline-flex items-center gap-0.5 text-silkscreen-2 before:absolute before:-inset-x-1 before:-inset-y-2 hover:text-silkscreen"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Tones
          </button>
          <span className="size-[3px] rounded-full bg-silkscreen-4" aria-hidden />
          <span>Edit capture</span>
          <span className="size-[3px] rounded-full bg-silkscreen-4" aria-hidden />
          {source.kind === "tone" ? (
            <span className="font-extrabold tracking-[0.02em] text-silkscreen-2">TONE3000</span>
          ) : (
            <span className="truncate">{source.fileName}</span>
          )}
        </nav>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="truncate text-[32px] leading-[1.05] font-bold tracking-[-0.02em]">{title}</h1>
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <span tabIndex={0} className="inline-flex h-6 items-center rounded-pill text-[11px] font-semibold text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
                <b className="grid h-6 place-items-center rounded-pill bg-faceplate-raised px-[9px] font-bold tracking-[0.02em] text-silkscreen shadow-[inset_0_0_0_1px_var(--seam-strong)]">
                  {arch.arch}
                </b>
                <span className="pr-2.5 pl-2">{arch.detail}</span>
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 text-[12px] text-silkscreen-2">
              {info.arch.kind === "A2"
                ? "One A2 file holds two sizes of the same model: Full for accuracy, Lite for small hardware."
                : info.arch.kind === "A1"
                  ? `NAM A1 WaveNet, ${info.arch.size} size, in the ${info.arch.layout === "0.5" ? "0.5.x" : "0.7.x"} file layout.`
                  : `NAM ${info.arch.architecture} model.`}
            </HoverCardContent>
          </HoverCard>
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <span
                tabIndex={0}
                className={
                  "inline-flex h-6 items-center gap-2 rounded-pill pr-2.5 pl-[9px] text-[12px] font-semibold whitespace-nowrap text-silkscreen " +
                  (verdict.tone === "on" ? "bg-led-on/12" : verdict.tone === "warn" ? "bg-led-warn/12" : "bg-led-fault/12")
                }
              >
                <Led tone={verdict.tone} />
                {verdict.label}
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 text-[12px] text-silkscreen-2">{verdict.reason}</HoverCardContent>
          </HoverCard>
        </div>
        <div className="flex items-center gap-3.5 text-[12px] whitespace-nowrap text-silkscreen-3">
          {record && (
            <span className="inline-flex items-center gap-1.5 text-silkscreen-2">
              <Avatar className="size-5">
                {record.creator.avatar_url && <AvatarImage src={record.creator.avatar_url} alt="" />}
                <AvatarFallback className="text-[11px]">{record.creator.username.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              {record.creator.username}
            </span>
          )}
          {record && <Badge variant="outline">{gearLabel(record.gear)}</Badge>}
          <Badge variant="outline">NAM</Badge>
          {record && <span>{licenseLabel(record.license)}</span>}
          {info.sampleRate !== null && <span>{formatKhz(info.sampleRate)}</span>}
          {record && (
            <Button variant="link" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => host.app.openExternal(record.url).catch((e) => notifyError("Couldn't open the tone page", e))}>
              <ExternalLink className="size-3" aria-hidden />
              Tone page
            </Button>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2 pb-0.5">
        <span className="mr-1.5 inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap text-silkscreen-3" aria-live="polite">
          {saving ? (
            <>
              <Spinner className="size-3.5" />
              Saving version {nextN}
            </>
          ) : viewing !== null ? null : dirty ? (
            <>
              <Led tone="warn" />
              Draft, not a version yet
            </>
          ) : base > 0 ? (
            <>
              <CircleCheck className="size-3.5 text-led-on" aria-hidden />
              {savedN === base ? `Saved as version ${base}` : `Version ${base}`}
            </>
          ) : (
            <>
              <CircleCheck className="size-3.5 text-led-on" aria-hidden />
              Original, no changes
            </>
          )}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!past.length || viewing !== null} onClick={undo}>
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!future.length || viewing !== null} onClick={redo}>
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>
        <Button variant="outline" size="sm" onClick={onExport} disabled={!recipe}>
          <Download className="size-3.5" aria-hidden />
          {info.arch.kind === "A2" ? "Export A2 .nam" : "Export .nam"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onOpenFile}>
                <FileUp />
                Open a .nam file…
              </DropdownMenuItem>
              {isElectron && (
                <DropdownMenuItem onSelect={onShowFiles}>
                  <FolderOpen />
                  Show files
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={viewing !== null} onSelect={() => edit(() => originalRecipe(loaded.file))}>
                <RotateCcw />
                Revert to original
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
