import { create } from "zustand";
import { notifyError, notifySuccess } from "@/app/notify";
import { host } from "@/host";

/** Whether Tone Studio has Valeton's test signal (shared/host/snaptone.ts); null until checked. */
export const useTestSignal = create<{ has: boolean | null; choosing: boolean }>(() => ({ has: null, choosing: false }));

/** Ask the host once (main also finds it in a Valeton Suite install). */
export async function checkTestSignal(): Promise<void> {
  if (useTestSignal.getState().has !== null) return;
  const has = await host.snaptone.hasSignal().catch(() => false);
  useTestSignal.setState({ has });
}

export async function chooseTestSignal(): Promise<void> {
  useTestSignal.setState({ choosing: true });
  try {
    if (await host.snaptone.chooseSignal()) {
      useTestSignal.setState({ has: true });
      notifySuccess("Tone Studio has Valeton's test signal", "It can make SnapTones now.");
    }
  } catch (e) {
    notifyError("That file isn't Valeton's test signal", e);
  } finally {
    useTestSignal.setState({ choosing: false });
  }
}
