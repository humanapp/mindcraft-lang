import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CreateVariableDialogProps {
  isOpen: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (variableName: string) => void;
}

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
      <DialogContent className="sm:max-w-106.25 bg-slate-50 border-2 border-slate-300 rounded-2xl">
        <DialogHeader className="border-b border-slate-200 pb-4">
          <DialogTitle className="text-slate-800 font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-slate-600">Enter a name for the new variable.</DialogDescription>
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
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel creating variable">
            Cancel
          </Button>
          <Button
            className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white"
            onClick={handleSubmit}
            disabled={!variableName}
            aria-label="Create variable"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
