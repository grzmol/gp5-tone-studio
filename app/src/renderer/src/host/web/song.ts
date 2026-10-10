import { MODEL_CHECKSUM_ERROR, modelDownloadError, SEPARATION_MODEL, sha256Hex, type ModelProgress, type SongHostApi } from "@shared/host/song";
import { HostError } from "@shared/ipc";

// Browser build: the model is cached in Cache Storage under its pinned URL, checked before it is stored; exported
// files are downloads.
const CACHE = "vltn-models";
const listeners = new Set<(p: ModelProgress) => void>();
const PROGRESS_EVERY_BYTES = 1 << 20;
let pending: Promise<Uint8Array> | null = null;

async function cached(): Promise<Uint8Array | null> {
  const res = await (await caches.open(CACHE)).match(SEPARATION_MODEL.url);
  if (!res) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength === SEPARATION_MODEL.bytes ? bytes : null;
}

async function download(): Promise<Uint8Array> {
  const total = SEPARATION_MODEL.bytes;
  const emit = (received: number) => listeners.forEach((cb) => cb({ received, total }));
  let res: Response;
  try {
    res = await fetch(SEPARATION_MODEL.url);
  } catch {
    throw new HostError("network", modelDownloadError(null));
  }
  if (!res.ok || !res.body) throw new HostError("network", modelDownloadError(res.status));
  const bytes = new Uint8Array(total);
  let received = 0;
  let reported = 0;
  const reader = res.body.getReader();
  emit(0);
  for (;;) {
    const chunk = await reader.read().catch(() => {
      throw new HostError("network", modelDownloadError(null));
    });
    if (chunk.done) break;
    if (received + chunk.value.byteLength > total) throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
    bytes.set(chunk.value, received);
    received += chunk.value.byteLength;
    if (received - reported >= PROGRESS_EVERY_BYTES) {
      reported = received;
      emit(received);
    }
  }
  emit(received);
  if (received !== total || (await sha256Hex(bytes)) !== SEPARATION_MODEL.sha256) throw new HostError("invalid", MODEL_CHECKSUM_ERROR);
  await (await caches.open(CACHE)).put(SEPARATION_MODEL.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  return bytes;
}

function downloadFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const webSong: SongHostApi = {
  hasModel: async () => (await (await caches.open(CACHE)).match(SEPARATION_MODEL.url)) !== undefined,
  async model() {
    const hit = await cached();
    if (hit) return hit;
    pending ??= download().finally(() => {
      pending = null;
    });
    // The worker takes the buffer: hand out a copy so a joined request keeps its own.
    return (await pending).slice();
  },
  onModelProgress(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async saveFiles(files) {
    files.forEach((f) => downloadFile(f.name, f.bytes));
    return files.length === 1 ? files[0].name : `${files.length} files`;
  },
};
