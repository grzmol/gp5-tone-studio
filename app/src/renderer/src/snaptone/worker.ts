// Web Worker: NAM text in, 2696-byte SnapTone file out (about 10 s of CPU, kept off the UI thread).
import { cloneToSnapToneFile } from "@/gp5/lib/snaptone.mjs";
import kernelUrl from "./a1kernel.wasm?url";
import excitationUrl from "./excitation.bin?url";
import { decodeExcitation, namToCloneBlob } from "./pipeline";
import type { ConvertReply, ConvertRequest } from "./convert";

const post = (msg: ConvertReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return res.arrayBuffer();
}

self.onmessage = async (e: MessageEvent<ConvertRequest>) => {
  try {
    const [excitation, kernel] = await Promise.all([fetchBytes(excitationUrl).then(decodeExcitation), fetchBytes(kernelUrl)]);
    const blob = await namToCloneBlob(e.data.namText, excitation, kernel, (phase, fraction) => post({ type: "progress", phase, fraction }));
    const file = cloneToSnapToneFile(blob);
    post({ type: "done", file }, [file.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
