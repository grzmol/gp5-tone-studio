// Web Worker: analyses the guitar stem off the UI thread (a few seconds for a whole song).
import { analyseGuitar } from "./analyse";
import type { AnalyseReply, AnalyseRequest } from "./run";

self.onmessage = (e: MessageEvent<AnalyseRequest>) => {
  const post = (msg: AnalyseReply) => self.postMessage(msg);
  try {
    const result = analyseGuitar(e.data.samples, e.data.sampleRate, (fraction) => post({ type: "progress", fraction }));
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
