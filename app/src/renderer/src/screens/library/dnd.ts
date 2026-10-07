// Drag and drop inside the Library (native HTML5 DnD; the drag image is a ghost card built from the source).
import type { DragEvent } from "react";
import { useLibrary, type LibraryDrag } from "./store";

export const LOCAL_MIME = "application/x-gp5-local-preset";
export const SLOTS_MIME = "application/x-gp5-slots";

export const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Ghost: name, origin and the source's MiniChain, in a solid raised card (design: library.css .ghost). */
function ghost(source: HTMLElement, title: string, origin: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fixed -top-[200px] left-0 flex items-center gap-2.5 rounded-lg bg-surface-solid-raised py-2 pr-3 pl-2.5 text-[13px] text-silkscreen shadow-[0_0_0_1px_var(--seam-strong)]";
  const text = document.createElement("span");
  text.className = "flex flex-col";
  const name = document.createElement("b");
  name.className = "font-[650]";
  name.textContent = title;
  const sub = document.createElement("span");
  sub.className = "text-xs text-silkscreen-3";
  sub.textContent = origin;
  text.append(name, sub);
  el.append(text);
  const chain = source.querySelector('[role="img"]');
  if (chain) el.append(chain.cloneNode(true));
  document.body.append(el);
  return el;
}

export function startDrag(e: DragEvent<HTMLElement>, drag: LibraryDrag, mime: string) {
  e.dataTransfer.effectAllowed = drag.kind === "local" ? "copy" : "copyMove";
  e.dataTransfer.setData(mime, JSON.stringify(drag.kind === "local" ? { id: drag.preset.id, collectionId: drag.preset.collectionId } : drag.slots));
  const title = drag.kind === "local" ? drag.preset.name : drag.slots.length === 1 ? (e.currentTarget.dataset.name ?? `Slot ${drag.slots[0]}`) : `${drag.slots.length} slots`;
  const collection = drag.kind === "local" ? useLibrary.getState().collections.find((c) => c.id === drag.preset.collectionId)?.title : null;
  const el = ghost(e.currentTarget, title, drag.kind === "local" ? `From ${collection ?? "this computer"}` : "From the GP-5. Alt copies");
  e.dataTransfer.setDragImage(el, 16, 16);
  setTimeout(() => el.remove(), 0);
  useLibrary.setState({ drag });
}

export function endDrag() {
  useLibrary.setState({ drag: null });
}
