import type { LiteralDisplayFormat } from "@wendoo-lang/core/brain";
import type { BrainTileLiteralDef } from "@wendoo-lang/core/brain/tiles";
import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { kStripPopupAttribute } from "./BrainCandidateStrip";
import { DisplayFormatPicker } from "./DisplayFormatPicker";

interface EditLiteralFormatDialogProps {
  isOpen: boolean;
  literalDef: BrainTileLiteralDef;
  onOpenChange: (open: boolean) => void;
  /**
   * Called as the dialog closes, before the keyboard is handed back to the
   * element that held it when the dialog opened. Calling `preventDefault` on the
   * event leaves that hand-back to the caller.
   */
  onCloseAutoFocus?: (event: Event) => void;
  onSubmit: (newFormat: LiteralDisplayFormat) => void;
}

/**
 * Dialog that edits the {@link LiteralDisplayFormat} of an existing literal
 * tile. Its content carries {@link kStripPopupAttribute}, so the keyboard
 * landing in it counts as staying in the candidate strip the tile's menu was
 * opened from.
 */
export function EditLiteralFormatDialog({
  isOpen,
  literalDef,
  onOpenChange,
  onCloseAutoFocus,
  onSubmit,
}: EditLiteralFormatDialogProps) {
  const [displayFormat, setDisplayFormat] = useState<LiteralDisplayFormat>(literalDef.displayFormat);

  const handleSubmit = () => {
    onSubmit(displayFormat);
  };

  const handleCancel = () => {
    setDisplayFormat(literalDef.displayFormat);
    onOpenChange(false);
  };

  const hasChanged = displayFormat !== literalDef.displayFormat;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-106.25 bg-popover border-2 border-border rounded-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
        {...{ [kStripPopupAttribute]: "" }}
      >
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-foreground font-semibold">Edit Display Format</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Change how the value {String(literalDef.value)} is displayed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <DisplayFormatPicker value={displayFormat} onChange={setDisplayFormat} />
        </div>
        <DialogFooter className="gap-2 pt-4 border-t border-border">
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel editing format">
            Cancel
          </Button>
          <Button
            className="rounded-lg"
            onClick={handleSubmit}
            disabled={!hasChanged}
            aria-label="Apply display format"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
