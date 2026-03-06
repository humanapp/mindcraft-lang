import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

interface RenameVariableDialogProps {
  isOpen: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newName: string) => void;
}

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
      <DialogContent className="sm:max-w-106.25 bg-slate-50 border-2 border-slate-300 rounded-2xl">
        <DialogHeader className="border-b border-slate-200 pb-4">
          <DialogTitle className="text-slate-800 font-semibold">Rename Variable</DialogTitle>
          <DialogDescription className="text-slate-600">Enter a new name for the variable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="variableName" className="text-right text-slate-700 font-medium">
              Name
            </label>
            <input
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
              className="col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="myVariable"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter className="gap-2 pt-4 border-t border-slate-200">
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel renaming variable">
            Cancel
          </Button>
          <Button
            className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white"
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
