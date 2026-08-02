import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { kStripPopupAttribute } from "./BrainCandidateStrip";

interface RenameVariableDialogProps {
  isOpen: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newName: string) => void;
}

/**
 * Dialog that prompts for a new name for an existing variable and submits via
 * `onSubmit`. Its content carries {@link kStripPopupAttribute}, so the keyboard
 * landing in it counts as staying in the candidate strip the tile's menu was
 * opened from.
 */
export function RenameVariableDialog({ isOpen, initialName, onOpenChange, onSubmit }: RenameVariableDialogProps) {
  const [variableName, setVariableName] = useState(initialName);

  useEffect(() => {
    if (isOpen) {
      setVariableName(initialName);
    }
  }, [isOpen, initialName]);

  const handleSubmit = () => {
    const newName = variableName.trim();
    setVariableName(newName);
    if (newName) {
      onSubmit(newName);
    }
  };

  const handleCancel = () => {
    setVariableName(initialName);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-106.25 bg-popover border-2 border-border rounded-2xl"
        {...{ [kStripPopupAttribute]: "" }}
      >
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-foreground font-semibold">Rename Variable</DialogTitle>
          <DialogDescription className="text-muted-foreground">Enter a new name for the variable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="variableName" className="text-right text-foreground font-medium">
              Name
            </label>
            <Input
              id="variableName"
              value={variableName}
              onChange={(e) => setVariableName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="col-span-3"
              placeholder="myVariable"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter className="gap-2 pt-4 border-t border-border">
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel renaming variable">
            Cancel
          </Button>
          <Button
            className="rounded-lg"
            onClick={handleSubmit}
            disabled={!variableName.trim() || variableName.trim() === initialName}
            aria-label="Rename variable"
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
