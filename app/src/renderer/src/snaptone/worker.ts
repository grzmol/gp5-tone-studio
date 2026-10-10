// Web Worker: NAM text + Valeton's test signal in, 2696-byte SnapTone file out (about 10 s of CPU, kept off the UI thread).
import { readSignalWav } from "@shared/host/snaptone";
import { cloneToSnapToneFile } from "@/gp5/lib/snaptone.mjs";
import a1KernelUrl from "./a1kernel.wasm?url";
import a2KernelUrl from "./a2kernel.wasm?url";
import { namToCloneBlob } from "./pipeline";
import type { ConvertReply, ConvertRequest } from "./convert";

const post = (msg: ConvertReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

async function fetchKernel(arch: "A1" | "A2"): Promise<ArrayBuffer> {
  const res = await fetch(arch === "A2" ? a2KernelUrl : a1KernelUrl);
  if (!res.ok) throw new Error(`Couldn't load the SnapTone converter (${res.status})`);
  return res.arrayBuffer();
}

self.onmessage = async (e: MessageEvent<ConvertRequest>) => {
  try {
    const excitation = readSignalWav(e.data.signalWav);
    const blob = await namToCloneBlob(e.data.namText, excitation, fetchKernel, (phase, fraction) => post({ type: "progress", phase, fraction }));
    const file = cloneToSnapToneFile(blob);
    post({ type: "done", file }, [file.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
