import { useEffect, useState } from "react";
import { AudioLines, FileUp, RotateCcw, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { SEPARATION_MODEL } from "@shared/host/song";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useSong } from "@/song/store";
import { StemMixer } from "./StemMixer";

const PANEL = "glass rounded-xl min-w-0 min-h-0";
const MODEL_MB = Math.round(SEPARATION_MODEL.bytes / 1e6);

/** The Stems tab: pick a song, follow the split, then play and export the stems. */
export function StemsPanel({ onPick }: { onPick: () => void }) {
  const source = useSong((s) => s.source);
  const stems = useSong((s) => s.stems);
  const status = useSong((s) => s.status);
  const [hasModel, setHasModel] = useState(true);

  useEffect(() => {
    if (source) return;
    let live = true;
    host.song.hasModel().then((has) => live && setHasModel(has), () => live && setHasModel(false));
    return () => {
      live = false;
    };
  }, [source]);

  if (stems && source) return <StemMixer key={source.name} stems={stems} songName={source.name} />;

  if (status.kind === "decoding") return <Working title="Reading the song" />;
  if (status.kind === "model")
    return (
      <Working
        title="Downloading the separation model"
        detail={`First split only: ${Math.round(status.fraction * MODEL_MB)} of ${MODEL_MB} MB. It is kept for next time.`}
        fraction={status.fraction}
      />
    );
  if (status.kind === "splitting")
    return (
      <Working
        title="Splitting into stems"
        detail={status.fraction === 0 ? "Starting the separation model" : "Runs on this computer, on the graphics card when it can."}
        fraction={status.fraction}
      />
    );

  if (status.kind === "error")
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>{source ? "The split didn't finish" : "This song can't be opened"}</AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            <div className="mt-3 flex gap-2">
              {source && (
                <Button size="sm" onClick={() => void useSong.getState().split()}>
                  <RotateCcw data-icon="inline-start" />
                  Try again
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onPick}>
                <FileUp data-icon="inline-start" />
                Open a song…
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );

  if (source)
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AudioLines />
            </EmptyMedia>
            <EmptyTitle>{source.name}</EmptyTitle>
            <EmptyDescription>Split it into drums, bass, guitar, piano, vocals and everything else.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            <Button onClick={() => void useSong.getState().split()}>Split into stems</Button>
          </EmptyContent>
        </Empty>
      </div>
    );

  return (
    <div className={cn(PANEL, "grid flex-1 place-items-center border border-dashed border-seam-strong p-6")}>
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AudioLines />
          </EmptyMedia>
          <EmptyTitle>Split a song into stems</EmptyTitle>
          <EmptyDescription>
            Drop an audio file here (WAV, MP3, FLAC, M4A or OGG) or choose one. Tone Studio separates it on this computer into drums, bass,
            guitar, piano, vocals and everything else.{!hasModel && ` The first split downloads the separation model (${MODEL_MB} MB) once.`}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button onClick={onPick}>
            <FileUp data-icon="inline-start" />
            Open a song…
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

function Working({ title, detail, fraction }: { title: string; detail?: string; fraction?: number }) {
  const percent = fraction === undefined ? null : Math.round(fraction * 100);
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div role="status" className={cn(PANEL, "flex w-full max-w-md flex-col gap-3 px-5 py-4")}>
        <div className="flex items-center gap-2.5 text-[13px]">
          <Spinner />
          <b className="font-semibold">{title}</b>
          {percent !== null && <span className="ml-auto text-silkscreen-2 tabular-nums">{percent}%</span>}
        </div>
        {percent !== null && <Progress value={percent} aria-label={title} />}
        <div className="flex items-center gap-3">
          {detail && <p className="text-[12px] text-pretty text-silkscreen-3">{detail}</p>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => useSong.getState().cancel()}>
            <X data-icon="inline-start" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
