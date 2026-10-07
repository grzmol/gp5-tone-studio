import { notifySuccess } from "@/app/notify";
import { modelTitle } from "@/components/gear";
import { useDevice } from "@/state/device";
import type { BlockState } from "@/state/device-types";
import { editBlock, snapshot } from "./edits";
import { useRig } from "./rig-store";

/** Copy a block's model and settings (in-app clipboard; pasting works on the same block type). */
export function copyBlock(block: BlockState) {
  useRig.setState({ clipboard: { ...snapshot(block), code: block.code, title: modelTitle(block) } });
  notifySuccess(`Copied ${modelTitle(block)} settings`, `Paste them onto a ${block.code} block from its right-click menu.`);
}

/** Paste the copied model and settings onto `index` (same block type only); keeps its on/off state. */
export async function pasteBlock(index: number) {
  const clip = useRig.getState().clipboard;
  const target = useDevice.getState().preset?.blocks[index];
  if (!clip || !target || clip.code !== target.code) return;
  await editBlock(`Paste ${clip.title}`, { index, fxid: clip.fxid, params: clip.params, enabled: target.enabled });
}
