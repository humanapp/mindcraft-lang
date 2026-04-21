import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@mindcraft-lang/ui";
import { useEffect, useRef, useState } from "react";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
  defaultName: string;
}

export function NewProjectDialog({ open, onOpenChange, onConfirm, defaultName }: NewProjectDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, defaultName]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onConfirm(trimmed);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm bg-slate-100 border-2 border-slate-300 rounded-2xl text-slate-900">
        <DialogHeader className="border-b border-slate-200 pb-3">
          <DialogTitle className="text-lg font-semibold">New Project</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">Enter a name for your new project.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Input
            ref={inputRef}
            value={name}
            className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleConfirm();
              }
            }}
            placeholder="Project name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="cancel" onClick={() => onOpenChange(false)} className="rounded-lg">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!name.trim()}
            className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
