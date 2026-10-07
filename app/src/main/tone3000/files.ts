import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";

/** Stream a response body to `path` (via a .part file) reporting bytes received. Returns the byte count. */
export async function streamToFile(res: Response, path: string, onProgress: (received: number, total: number | null) => void): Promise<number> {
  if (!res.body) throw new Error("Empty download");
  const total = Number(res.headers.get("content-length")) || null;
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  const out = createWriteStream(part);
  const reader = res.body.getReader();
  let received = 0;
  let lastReport = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      const now = Date.now();
      if (now - lastReport > 100) {
        lastReport = now;
        onProgress(received, total);
      }
    }
    out.end();
    await finished(out);
    await rename(part, path);
    onProgress(received, total);
    return received;
  } catch (e) {
    out.destroy();
    await rm(part, { force: true });
    throw e;
  }
}
