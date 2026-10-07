import { PlugZapIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/state/device";
import { useNav } from "@/state/nav";

/** overlays.md C: not dismissable, disappears on reconnect. The Rig below shows the last read, read-only. */
export function DisconnectedBanner() {
  const error = useDevice((s) => s.error);
  const silent = error?.code === "busy" || error?.code === "timeout";
  return (
    <Alert className="glass mx-7 mt-3 flex w-auto items-center gap-4 rounded-lg border-0 px-4 py-2.5">
      <PlugZapIcon className="size-5 text-led-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <AlertTitle>{silent ? "Found the GP-5, but it doesn't answer" : "The GP-5 isn't connected"}</AlertTitle>
        <AlertDescription className="text-silkscreen-2 [@media(max-height:820px)]:line-clamp-1">
          {silent
            ? "Another app may be using it. Close Valeton Suite and try again."
            : "Plug it in over USB. If Valeton Suite is open, close it first because it holds the port."}
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 [@media(max-height:820px)]:hidden">
            <span className="text-xs text-silkscreen-3">Works offline</span>
            <Badge variant="outline">Library and backups</Badge>
            <Badge variant="outline">Preset files (.prst)</Badge>
            <Badge variant="outline">NAM and IR files</Badge>
          </span>
        </AlertDescription>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={() => useNav.getState().go("library")}>
          Open Library
        </Button>
        {silent ? (
          <Button onClick={() => void useDevice.getState().connect().catch(() => {})}>Try again</Button>
        ) : (
          <Button variant="ghost" onClick={() => useNav.getState().go("device", "troubleshooting")}>
            Connection help
          </Button>
        )}
      </div>
    </Alert>
  );
}
