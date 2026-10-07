import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { modelTitle } from "@/components/gear";
import { useDevice } from "@/state/device";
import type { BlockState } from "@/state/device-types";
import { copyBlock, pasteBlock } from "./clipboard";
import { editEnabled, editOrder, resetToDefaults, toggleFootswitch } from "./edits";
import { isMovable, nudge } from "./order";
import { useRig } from "./rig-store";

/** Right-click menu of a pedal: on/off, change model, copy/paste settings, FS1/FS2, move, reset. */
export function BlockMenu({ block, readOnly, children }: { block: BlockState; readOnly: boolean; children: ReactNode }) {
  const fs = useDevice((s) => s.preset?.footswitches);
  const order = useDevice((s) => s.preset?.order);
  const clip = useRig((s) => s.clipboard);
  const canPaste = !!clip && clip.code === block.code && !readOnly;
  const left = order && nudge(order, block.index, -1);
  const right = order && nudge(order, block.index, 1);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={readOnly} onSelect={() => editEnabled(block.index, !block.enabled)}>
          {block.enabled ? "Turn off" : "Turn on"}
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={readOnly}
          onSelect={() => {
            useRig.getState().select(block.index);
            useRig.getState().openPicker({ block: block.index });
          }}
        >
          Change model…
          <ContextMenuShortcut>M</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyBlock(block)}>Copy settings</ContextMenuItem>
        <ContextMenuItem disabled={!canPaste} onSelect={() => void pasteBlock(block.index)}>
          {clip && clip.code === block.code ? `Paste ${clip.title} settings` : "Paste settings"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem disabled={readOnly} checked={!!fs?.fs1.includes(block.index)} onCheckedChange={() => toggleFootswitch("fs1", block.index)}>
          Assign to FS1
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem disabled={readOnly} checked={!!fs?.fs2.includes(block.index)} onCheckedChange={() => toggleFootswitch("fs2", block.index)}>
          Assign to FS2
        </ContextMenuCheckboxItem>
        {isMovable(block.index) && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly || !left} onSelect={() => left && editOrder(left)}>
              Move earlier in the chain
              <ContextMenuShortcut>Alt ←</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly || !right} onSelect={() => right && editOrder(right)}>
              Move later in the chain
              <ContextMenuShortcut>Alt →</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={readOnly || !block.model} onSelect={() => void resetToDefaults(block)}>
          Reset {block.model ? modelTitle(block) : "model"} to defaults
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
