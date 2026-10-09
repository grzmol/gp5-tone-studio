import { readSignalWav, type SnapToneApi } from "@shared/host/snaptone";
import { HostError } from "@shared/ipc";

// Browser build: the chosen test signal is kept in memory for this page load. signal() hands out copies: the
// converter transfers its buffer to a worker.
let kept: Uint8Array | null = null;

function chooseWav(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".wav,audio/wav";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export const webSnapTone: SnapToneApi = {
  hasSignal: async () => kept !== null,
  signal: async () => kept?.slice() ?? null,
  async chooseSignal() {
    const file = await chooseWav();
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      readSignalWav(bytes);
    } catch (e) {
      throw new HostError("invalid", e instanceof Error ? e.message : String(e));
    }
    kept = bytes;
    return bytes;
  },
};
