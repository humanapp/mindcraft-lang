import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

interface CreateVariableDialogProps {
  isOpen: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (variableName: string) => void;
}

/** Dialog that prompts for a new variable name and submits the trimmed value via `onSubmit`. */
export function CreateVariableDialog({ isOpen, title, onOpenChange, onSubmit }: CreateVariableDialogProps) {
  const [variableName, setVariableName] = useState("");

  const handleSubmit = () => {
    const varName = variableName.trim();
    setVariableName(varName);
    if (varName) {
      onSubmit(varName);
      setVariableName("");
    }
  };

  const handleCancel = () => {
    setVariableName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-106.25 bg-popover border-2 border-border rounded-2xl">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-foreground font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">Enter a name for the new variable.</DialogDescription>
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
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel creating variable">
            Cancel
          </Button>
          <Button className="rounded-lg" onClick={handleSubmit} disabled={!variableName} aria-label="Create variable">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
