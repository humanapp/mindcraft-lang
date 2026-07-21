import type { LiteralDisplayFormat } from "@mindcraft-lang/core/brain";
import type { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { DisplayFormatPicker } from "./DisplayFormatPicker";

interface EditLiteralFormatDialogProps {
  isOpen: boolean;
  literalDef: BrainTileLiteralDef;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newFormat: LiteralDisplayFormat) => void;
}

/** Dialog that edits the {@link LiteralDisplayFormat} of an existing literal tile. */
export function EditLiteralFormatDialog({ isOpen, literalDef, onOpenChange, onSubmit }: EditLiteralFormatDialogProps) {
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
      <DialogContent className="sm:max-w-106.25 bg-popover border-2 border-border rounded-2xl">
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
