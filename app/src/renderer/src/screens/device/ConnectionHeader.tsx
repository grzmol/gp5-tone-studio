import { useShallow } from "zustand/react/shallow";
import { CircleCheck, LoaderCircle, RefreshCw, TriangleAlert, Unlink, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/app/notify";
import { cn } from "@/lib/utils";
import { gp5OnUsb, useDevice } from "@/state/device";
import { clock, requestErrorLine, type ConnectionView, type Led } from "./guidance";

export const LED_CLASS: Record<Led, string> = { on: "bg-led-on", warn: "bg-led-warn", fault: "bg-led-fault", off: "bg-led-off" };

/** Device name plus its state line; owns the primary action in problem states (device.md › Layout). */
export function ConnectionHeader({ view, onShowFix }: { view: ConnectionView; onShowFix: () => void }) {
  const d = useDevice(
    useShallow((s) => ({
      status: s.status,
      mode: s.mode,
      hostStatus: s.hostStatus,
      lastError: s.lastError,
      connectedAt: s.connectedAt,
      portName: s.portName,
      activeSlot: s.preset?.slot ?? null,
      activeName: s.preset?.name ?? null,
      busy: s.busy,
      connect: s.connect,
      disconnect: s.disconnect,
      cancelConnect: s.cancelConnect,
      checkHost: s.checkHost,
      sync: s.sync,
    })),
  );
  const connected = d.status === "connected";
  const usbIds = gp5OnUsb(d.hostStatus) && d.mode !== "mock";
  const errorLine = connected ? requestErrorLine(d.lastError) : null;

  const lookForPedal = () => void d.connect("webmidi").catch(() => {});
  const checkAgain = async () => {
    await d.checkHost();
    lookForPedal();
  };
  const readAgain = () => void d.sync().catch((e) => notifyError("Couldn't read the pedal", e));

  return (
    <header className="flex items-end gap-6 px-7 pt-[22px] pb-1.5">
      <div className="min-w-0">
        <h1 className="text-[44px] leading-none font-bold tracking-[-0.02em] text-balance">Valeton GP-5</h1>
        <div className="mt-3.5 flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-sm text-silkscreen-3">
          <span className="flex items-center gap-1.5">
            {view.kind === "connecting" ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <span className={cn("size-[7px] shrink-0 rounded-full", LED_CLASS[view.led])} aria-hidden />
            )}
            <span className="font-semibold text-silkscreen">{view.state}</span>
            {view.detail}
            {connected && d.connectedAt && <b className="font-semibold text-silkscreen">{clock(d.connectedAt)}</b>}
          </span>
          {usbIds && (
            <span>
              USB <b className="font-semibold text-silkscreen">84EF:0184</b>
            </span>
          )}
          {(connected || view.kind === "connecting") && d.portName && (
            <span>
              MIDI port <b className="font-semibold text-silkscreen">{d.portName}</b>
            </span>
          )}
          {connected && d.activeSlot !== null && (
            <span>
              Active preset{" "}
              <b className="font-semibold text-silkscreen">
                {String(d.activeSlot).padStart(2, "0")} {d.activeName}
              </b>
            </span>
          )}
          {view.kind === "driver" && d.hostStatus?.driver && (
            <span>
              Driver <b className="font-semibold text-silkscreen">{d.hostStatus.driver}</b>
            </span>
          )}
          {connected && d.mode === "webmidi" && d.hostStatus?.suiteRunning === false && (
            <span className="flex items-center gap-1.5">
              <CircleCheck className="size-3.5" aria-hidden />
              Valeton Suite is not running
            </span>
          )}
        </div>
        {view.note && <p className="mt-2.5 max-w-[640px] text-pretty text-silkscreen-2">{view.note}</p>}
        {view.steps.length > 0 && view.kind !== "driver" && (
          <ol className="mt-2 flex max-w-[640px] list-decimal flex-col gap-1 pl-[18px] text-silkscreen-2 marker:font-semibold marker:text-silkscreen-3">
            {view.steps.map((s) => (
              <li key={s} className="select-text">
                {s}
              </li>
            ))}
          </ol>
        )}
        {errorLine && (
          <p role="alert" className="mt-2.5 flex items-center gap-2 text-sm text-silkscreen-2">
            <TriangleAlert className="size-4 text-led-warn" aria-hidden />
            {errorLine}
            <Button variant="ghost" size="sm" onClick={readAgain} disabled={!!d.busy}>
              <RefreshCw aria-hidden />
              Retry
            </Button>
          </p>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 pb-0.5">
        {connected ? (
          <>
            <Button variant="ghost" onClick={readAgain} disabled={!!d.busy}>
              <RefreshCw className={cn(d.busy?.kind === "sync" && "animate-spin motion-reduce:animate-none")} aria-hidden />
              Read pedal again
            </Button>
            <Button variant="outline" onClick={() => void d.disconnect()} disabled={!!d.busy && d.busy.kind !== "sync"}>
              <Unlink aria-hidden />
              Disconnect
            </Button>
          </>
        ) : (
          <>
            {view.kind !== "bootloader" && view.kind !== "connecting" && (
              <Button variant={view.action === "none" ? "outline" : "ghost"} onClick={() => void d.connect("mock").catch(() => {})}>
                Use the simulated pedal
              </Button>
            )}
            {view.action === "cancel" && (
              <Button variant="ghost" onClick={() => void d.cancelConnect()}>
                Cancel
              </Button>
            )}
            {view.action === "connect" && (
              <Button onClick={lookForPedal}>
                <RefreshCw aria-hidden />
                {view.actionLabel}
              </Button>
            )}
            {view.action === "check" && (
              <Button onClick={() => void checkAgain()}>
                <RefreshCw aria-hidden />
                {view.actionLabel}
              </Button>
            )}
            {view.action === "show-fix" && (
              <Button onClick={onShowFix}>
                <Wrench aria-hidden />
                {view.actionLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
