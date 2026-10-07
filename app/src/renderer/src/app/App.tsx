import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "./AppShell";

export function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <AppShell />
      {/* overlays.md G: bottom right above the 30px status bar, max 3, newest on top. */}
      <Toaster
        position="bottom-right"
        visibleToasts={3}
        expand
        offset={{ bottom: 42, right: 20 }}
        gap={12}
        toastOptions={{ classNames: { toast: "glass-float !rounded-lg !border-0 !text-[13px]", description: "!text-silkscreen-2 !text-xs" } }}
      />
    </TooltipProvider>
  );
}
